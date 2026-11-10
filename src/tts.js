/* ---------------- 单词发音：内置离线神经语音 ----------------
 *
 * 为什么不直接用 window.speechSynthesis：
 *   Windows 上有两套语音库 —— 老的 SAPI5（HKLM\SOFTWARE\Microsoft\Speech）
 *   和新的 OneCore（HKLM\SOFTWARE\Microsoft\Speech_OneCore）。
 *   Chromium 只枚举 OneCore 那一套，而中文版 Windows 的 OneCore 里
 *   只有 Huihui / Kangkang / Yaoyao 三个中文音，没有英文。
 *   于是 speechSynthesis 一个英文音都拿不到，只能干瞪眼。
 *   装英文语音包要管理员权限 + 系统更新，不适合当成使用前提。
 *
 * 所以自带一个引擎：Piper（MIT 许可），espeak-ng 做音素化，
 * ONNX 模型做声码合成。纯离线、不需要管理员、不需要联网，
 * 音质比系统自带的 Zira 更自然。
 *
 * 速度：一个进程加载模型约 0.25 秒，合一个词约 0.05 秒。
 * 所以不逐词起进程，而是把一批词用 JSON 一次性喂给同一个进程。
 * 合成结果按「词 + 语速」哈希后落盘缓存，第二次点是瞬间出声。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

/* 引擎目录：开发时在项目里，打包后在 resources/engine
 * （package.json 的 extraResources 把它整个搬过去，不进 asar ——
 *   asar 里的 exe 没法直接执行，模型也没法 mmap） */
function resolveEngineDir() {
  try {
    const { app } = require('electron');
    if (app && app.isPackaged) return path.join(process.resourcesPath, 'engine');
  } catch (e) { /* 纯 Node 环境跑测试时没有 electron */ }
  return path.join(__dirname, '..', 'engine');
}

const ENGINE_DIR = resolveEngineDir();
const PIPER = path.join(ENGINE_DIR, 'piper', 'piper.exe');
const VOICE_DIR = path.join(ENGINE_DIR, 'voices');

/* 语速：length_scale 是音素时长倍率，越大越慢。
 * 默认 1.15 —— 比正常语速慢一点，初学者才听得清尾音（-ed / -s）。 */
const PACE = {
  slow: 1.35,
  normal: 1.15,
  fast: 1.0
};

let cacheDir = '';
let paceKey = 'normal';

/* 缓存键的版本号。合成参数（语速对照表、引擎参数、模型文件）一改，就该让旧缓存失效 ——
 * 否则磁盘上那份按老参数合成的 wav 会被一直命中，表现是"改了参数没效果"。
 * 改参数时把这里加一，比手动清目录可靠。 */
const CACHE_VER = 'v2';

/* 串行队列：piper 一次只跑一个进程。
 * 否则连点五个词会同时起五个 piper，每个 60MB 模型，内存直接炸。
 *
 * 但队列要能插队：预热 400 个词要十几秒，用户点一个词不该排在后面等。
 * 所以分两档优先级，预热还切成小批 —— 点在预热中间也只是等一小批。 */
let running = false;
let batchBusy = false;
const queue = [];

function init(userDataDir, pace) {
  cacheDir = path.join(userDataDir, 'tts');
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (e) { /* 目录已存在 */ }
  setPace(pace);
}

function setPace(pace) {
  paceKey = PACE[pace] ? pace : 'normal';
}

function lengthScale() {
  return PACE[paceKey] || PACE.normal;
}

function engineReady() {
  try {
    return fs.existsSync(PIPER) && !!currentModel();
  } catch (e) {
    return false;
  }
}

/* 支持往 engine/voices 里丢别的 .onnx 音色，用 settings.voiceModel 指定。
 * 默认取目录里第一个 —— 也就是随包带的 lessac。 */
function voiceFiles() {
  try {
    return fs.readdirSync(VOICE_DIR).filter((f) => f.endsWith('.onnx'));
  } catch (e) {
    return [];
  }
}

let modelCache = null;

function currentModel(name) {
  if (name) {
    const p = path.join(VOICE_DIR, name);
    return fs.existsSync(p) ? p : null;
  }
  if (modelCache && fs.existsSync(modelCache)) return modelCache;
  const list = voiceFiles();
  modelCache = list.length ? path.join(VOICE_DIR, list[0]) : null;
  return modelCache;
}

function cacheFile(text) {
  const k = crypto.createHash('sha1')
    .update(String(text).trim().toLowerCase() + '|' + lengthScale() + '|' + CACHE_VER)
    .digest('hex')
    .slice(0, 20);
  return path.join(cacheDir, k + '.wav');
}

function cached(text) {
  const f = cacheFile(text);
  try {
    return fs.existsSync(f) && fs.statSync(f).size > 2000;
  } catch (e) {
    return false;
  }
}

/* ---------------- 批量合成 ----------------
 * 用 --json-input，每行 {"text":..., "output_file":...}
 * 这样输出文件名由我们指定，能和单词一一对上。
 * （普通文本模式的输出名是时间戳，拿不回来是哪個词的）
 */
function runBatch(words) {
  const jobs = words.map((w) => ({ text: w, file: cacheFile(w) }));
  const lines = jobs.map((j) => JSON.stringify({
    text: j.text,
    output_file: j.file.replace(/\\/g, '/')
  }));

  return new Promise((resolve) => {
    const args = ['--model', currentModel(), '--json-input', '-q',
      '--length_scale', String(lengthScale())];
    const p = spawn(PIPER, args, { cwd: ENGINE_DIR, windowsHide: true });

    let err = '';
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      resolve(r);
    };

    /* 硬超时。piper 正常合成一批 12 个词约 1 秒，加载模型 0.5 秒；
     * 但进程被挂住（模型文件损坏、被安全软件锁住、杀进程软件误伤）时它既不退出
     * 也不报错，Promise 永不 resolve —— 之后 running 一直是 true，所有朗读静默失效，
     * 用户只会看到"点了没反应"。30 秒兜底，杀掉重来。
     */
    const guard = setTimeout(() => {
      try { p.kill(); } catch (e) { /* 已经退了 */ }
      finish({ ok: false, why: '语音引擎 30 秒没响应，已强杀重来' });
    }, 30000);

    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', (e) => finish({ ok: false, why: '起不来语音引擎：' + e.message }));
    p.on('close', (code) => {
      if (code !== 0) return finish({ ok: false, why: '引擎退出码 ' + code + ' ' + err.slice(0, 200) });
      const made = jobs.filter((j) => fs.existsSync(j.file)).length;
      finish({ ok: true, made, total: jobs.length });
    });

    // 引擎不读 stdin 就退出时会 EPIPE，别让它把主进程带崩
    p.stdin.on('error', () => {});
    try {
      p.stdin.write(lines.join('\n') + '\n');
      p.stdin.end();
    } catch (e) {
      finish({ ok: false, why: e.message });
    }
  });
}

/* 高优先级（用户点的）排在前面；同一档内先来先做 */
function push(words, high) {
  return new Promise((resolve) => {
    queue.push({ words, high: !!high, resolve });
    queue.sort((a, b) => (b.high ? 1 : 0) - (a.high ? 1 : 0));
    pump();
  });
}

async function pump() {
  if (running) return;
  running = true;
  batchBusy = true;
  while (queue.length) {
    const job = queue.shift();
    let r;
    try {
      r = await runBatch(job.words);
    } catch (e) {
      r = { ok: false, why: e.message };
    }
    job.resolve(r);
  }
  batchBusy = false;
  running = false;
}

const CHUNK = 12;   // 预热一批最多 12 个词，约 1 秒

function enqueue(words, high) {
  const list = (words || []).filter(Boolean);
  if (!list.length) return Promise.resolve({ ok: true, made: 0 });
  if (high || list.length <= CHUNK) return push(list, high);

  // 大堆预热切成小批，依次入队；全部做完再一起返回
  const parts = [];
  for (let i = 0; i < list.length; i += CHUNK) parts.push(list.slice(i, i + CHUNK));
  return parts.reduce(
    (acc, part) => acc.then(() => push(part, false)),
    Promise.resolve({ ok: true, made: 0 })
  );
}

/* 发音：命中缓存立刻返回，没命中就现合一个 */
async function say(text) {
  const t = String(text || '').trim();
  if (!t) return { ok: false, why: '没有要读的内容' };
  if (!engineReady()) return { ok: false, why: 'no-engine' };

  const f = cacheFile(t);
  if (cached(t)) {
    try {
      return { ok: true, data: fs.readFileSync(f).toString('base64'), hit: true };
    } catch (e) { /* 落到下面重合成 */ }
  }

  const r = await enqueue([t], true);
  if (!r.ok) return { ok: false, why: r.why };
  if (!cached(t)) return { ok: false, why: '合成完没找到音频文件' };
  return { ok: true, data: fs.readFileSync(f).toString('base64'), hit: false };
}

/* 预热：把今天手上这些词的音频先合出来，点的时候就不用等 */
function prefetch(words) {
  if (!engineReady()) return Promise.resolve({ ok: false, why: 'no-engine' });
  const seen = new Set();
  const todo = [];
  (words || []).forEach((w) => {
    const t = String(w || '').trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    if (!cached(t)) todo.push(t);
  });
  if (!todo.length) return Promise.resolve({ ok: true, made: 0 });
  return enqueue(todo.slice(0, 400));
}

function status() {
  const voices = voiceFiles();
  return {
    ok: engineReady(),
    piper: fs.existsSync(PIPER),
    engineDir: ENGINE_DIR,
    voices,
    pace: paceKey,
    lengthScale: lengthScale(),
    busy: batchBusy,
    cacheDir
  };
}

/* 缓存清理：换语速后旧文件就没用了 */
function clearCache() {
  let n = 0;
  try {
    fs.readdirSync(cacheDir).forEach((f) => {
      if (!f.endsWith('.wav')) return;
      try { fs.unlinkSync(path.join(cacheDir, f)); n++; } catch (e) { /* 占用中跳过 */ }
    });
  } catch (e) { /* 目录不存在 */ }
  return { ok: true, removed: n };
}

module.exports = { init, say, prefetch, status, clearCache, setPace, engineReady };
