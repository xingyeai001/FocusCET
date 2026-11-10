// FocusCET —— 主进程
// 计时器放在这里而不是界面里：窗口最小化、收进托盘、切到别的页面时，
// 倒计时都必须继续走，托盘还要实时显示剩余时间。渲染进程会被节流，靠不住。

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage, Notification, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

/* ---------------- 运行环境 ----------------
 * dev  ：日常开发。数据落在真实 userData，和正式使用一致
 * test ：沙盒。配置、缓存、日志、Cookie 全部改道到系统临时目录，
 *        在这里怎么造脏数据、怎么删库都不会碰到真实进度
 * prod ：打包后。没有开发者工具，没有热重载
 */
const ENV = (function () {
  if (process.env.CET4_ENV) return process.env.CET4_ENV;
  return app.isPackaged ? 'prod' : 'dev';
})();
const IS_DEV = ENV !== 'prod';

const SANDBOX_ROOT = path.join(os.tmpdir(), 'focuscet-sandbox');

/* ---------------- 数据目录与改名迁移 ----------------
 * 2026-11 之前这个应用叫「番茄四六级」，userData 目录是 cet4-pomodoro。
 * 改名成 FocusCET 之后目录也跟着换，但老用户攒的卡片和记录不能就此消失：
 * 新目录还没有 config.json 时，把旧目录里的配置和自定义铃声复制过来。
 * 只复制、不删除 —— 旧目录原样留着当保险，用户自己确认没问题了再删。
 */
const DATA_DIR = 'FocusCET';
const LEGACY_DIR = 'cet4-pomodoro';

function migrateLegacyData(dir) {
  if (fs.existsSync(path.join(dir, 'config.json'))) return false;          // 新目录已有数据，一律不动
  const legacy = path.join(app.getPath('appData'), LEGACY_DIR);
  if (!fs.existsSync(path.join(legacy, 'config.json'))) return false;     // 没有旧数据，正常首次启动
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ['config.json', 'config.bak.json']) {
      const from = path.join(legacy, f);
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, f));
    }
    const sounds = path.join(legacy, 'sounds');
    if (fs.existsSync(sounds)) fs.cpSync(sounds, path.join(dir, 'sounds'), { recursive: true });
    console.log('[migrate] 已从旧目录 ' + legacy + ' 复制数据');
    return true;
  } catch (e) {
    console.error('旧数据迁移失败（不影响启动，只是看不到以前的进度）', e);
    return false;
  }
}

if (ENV === 'test') {
  // --fresh 表示每次从一张白纸开始，用来复现"第一次打开"的效果
  if (process.env.CET4_FRESH === '1') {
    try { fs.rmSync(SANDBOX_ROOT, { recursive: true, force: true }); } catch (e) { /* 文件被占用就跳过 */ }
  }
  const dirs = {
    userData: path.join(SANDBOX_ROOT, 'userData'),
    sessionData: path.join(SANDBOX_ROOT, 'sessionData'),
    crashDumps: path.join(SANDBOX_ROOT, 'crashDumps'),
    temp: path.join(SANDBOX_ROOT, 'temp')
  };
  Object.keys(dirs).forEach((k) => {
    try { fs.mkdirSync(dirs[k], { recursive: true }); } catch (e) { /* ignore */ }
    try { app.setPath(k, dirs[k]); } catch (e) { /* 个别路径 ready 后才能设 */ }
  });
} else {
  // 固定英文 userData 目录：默认会用 productName，路径里带空格/非 ASCII 在部分工具下会出问题
  const dataDir = path.join(app.getPath('appData'), DATA_DIR);
  migrateLegacyData(dataDir);
  app.setPath('userData', dataDir);
}
app.setAppUserModelId('com.focuscet.app');

// 调试端口：dev 和 test 用不同端口，两个实例可以同时开着互不干扰
if (process.env.CET4_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', String(process.env.CET4_DEBUG_PORT));
}

const store = require('./src/store');
const S = require('./src/schedule');
const L = require('./src/lifetime');
const { TASK_LIB, STAGES, parseBuiltin, wordPool, poolStats, normLevel } = require('./src/data');
const TTS = require('./src/tts');

/* ---------------- 落盘日志 ----------------
 * 打包后 exe 是 GUI 子系统，没有 stdout，console.log 全部丢失。
 * 启动阶段一旦抛异常，用户看到的就是"双击没反应"，这边什么线索都没有。
 */
const LOG_FILE = path.join(app.getPath('userData'), 'main.log');
(function teeConsole() {
  const fmt = (a) => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack || a.message;
    try { return JSON.stringify(a); } catch (e) { return String(a); }
  };
  const write = (level, args) => {
    try {
      fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
      if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 512 * 1024) {
        try { fs.renameSync(LOG_FILE, LOG_FILE + '.1'); } catch (e) { /* 占用中就算了 */ }
      }
      fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} [${level}] ${args.map(fmt).join(' ')}\n`);
    } catch (e) { /* 日志写不进去也不能影响功能 */ }
  };
  /* stdout 是会断的：命令行里接了 `| head`、终端被关掉、从某个启动器以管道方式
   * 拉起后父进程先退出 —— 这些情况下往 stdout 写会抛 EPIPE，而这个异常是在
   * console.log 内部同步抛出来的，一条日志就能把整个主进程带崩、弹一个红框。
   * 打包后 GUI 子系统本来就没有 stdout，这类异常纯属噪声。
   * 所以两边都堵上：console 包一层 try/catch，stdout/stderr 再挂 error 监听。 */
  ['log', 'error', 'warn'].forEach((k) => {
    const orig = console[k].bind(console);
    console[k] = (...args) => {
      try { orig(...args); } catch (e) { /* 输出管道断了，不影响功能 */ }
      write(k, args);
    };
  });
  const onPipeError = (e) => {
    if (e && e.code === 'EPIPE') return;
    write('error', ['stdout/stderr 异常', e]);
  };
  try { process.stdout.on('error', onPipeError); } catch (e) { /* ignore */ }
  try { process.stderr.on('error', onPipeError); } catch (e) { /* ignore */ }
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `\n===== 启动 ${new Date().toISOString()} =====\n`
      + `版本 ${app.getVersion()}  打包=${app.isPackaged}  userData=${app.getPath('userData')}\n`);
  } catch (e) { /* ignore */ }
})();

let win = null;
let tray = null;
let cfg = null;
let quitting = false;
let trayTimer = null;
let lastTrayText = '';

/* ---------------- 计时器 ---------------- */
const T = {
  state: 'idle',        // idle | focus | break
  paused: false,
  total: 0,             // 秒
  remain: 0,
  endAt: 0,
  lastTickAt: 0,        // 上一次 tick 的墙钟时间，用来发现睡眠断档
  sentLeft: -1,         // 上一次发出去的秒数，避免 500ms 一次的无用 IPC
  startedAt: 0,
  name: '',
  cat: '',
  interruptions: [],
  checkpoints: [],
  fired: [],
  planIdx: -1,
  handle: null
};

function clearTick() {
  if (T.handle) { clearInterval(T.handle); T.handle = null; }
}

function tickOn() {
  clearTick();
  // 每次启动定时器都重设断档基准：暂停很久之后恢复，不能把暂停那段算成"睡眠"
  T.lastTickAt = Date.now();
  T.handle = setInterval(tick, 500);
  tick();
}

function timerView() {
  return {
    state: T.state,
    paused: T.paused,
    total: T.total,
    remain: T.remain,
    name: T.name,
    cat: T.cat,
    intervals: T.interruptions.length,
    interruptionList: T.interruptions.slice(-4).map((x) => x.reason),
    planIdx: T.planIdx
  };
}

function tick() {
  if (T.state === 'idle' || T.paused) return;

  /* 合盖睡眠时 setInterval 不跑，但 endAt 是墙钟时间。
   * 不合眼回来，一个"25 分钟"的番茄会被整段睡掉，还照满额记进账 —— 那这本账就是假的。
   * 所以两次 tick 之间隔了超过一分钟，就把 endAt 往后推同样长，等于自动顺延，
   * 睡过去的时间既不算专注、也不作废。阈值 60s：正常负载下 tick 只会晚几十毫秒。
   */
  const now = Date.now();
  let slept = 0;
  if (T.lastTickAt && now - T.lastTickAt > 60000) {
    slept = now - T.lastTickAt;
    T.endAt += slept;
  }
  T.lastTickAt = now;

  const left = Math.max(0, Math.round((T.endAt - now) / 1000));
  T.remain = left;

  if (slept && T.state === 'focus') {
    // 不响铃：人刚醒，先别吓一跳
    notify('电脑睡了一觉', '睡过去的 ' + Math.round(slept / 60000) + ' 分钟不算进番茄，已顺延，还剩 '
      + fmtClock(left) + '。');
  }

  if (T.state === 'focus') {
    const passed = T.total - left;
    T.checkpoints.forEach((cp, i) => {
      if (passed >= cp && !T.fired[i]) {
        T.fired[i] = true;
        notify('已经连续专注 ' + Math.round(cp / 60) + ' 分钟', '这场考试中途不休息，建议把这一整块撑完', 'tick-warn');
      }
    });
  }

  /* 倒计时只显示到秒，但 tick 是 500ms 一次。以前每 tick 都发一条 IPC，
   * 一场 130 分钟的模考就是一万五千多条无用消息，笔记本上纯耗电。
   * 只在整秒真的变了才发；托盘那边 updateTray 本来就有文本去重。
   * 状态变化（暂停/恢复/结束）走 broadcast，不靠这条通道。 */
  if (left !== T.sentLeft) {
    T.sentLeft = left;
    if (win && !win.isDestroyed()) {
      win.webContents.send('timer:tick', {
        state: T.state, paused: T.paused, total: T.total, remain: left
      });
    }
  }
  updateTray(false);

  if (left <= 0) finishSegment();
}

function startFocus(item, idx) {
  if (T.state === 'focus' && !T.paused) return { ok: false, msg: '先处理完当前这一段' };

  /* 暂停中点了另一个任务的 ▶：以前整个 T 被覆盖，旧番茄既不作废也不记录，账上凭空少一段。
   * 一个番茄只能做一件事，那就按"放弃"记一笔，至少会话记录里对得上。 */
  if (T.state === 'focus' && T.paused) recordSession('abort');

  const minutes = Math.max(1, Math.round(item.minutes || cfg.settings.pomo));
  T.state = 'focus';
  T.paused = false;
  T.total = minutes * 60;
  T.remain = T.total;
  T.endAt = Date.now() + T.total * 1000;
  T.startedAt = Date.now();
  T.name = item.name || '自定义任务';
  T.cat = item.cat || '综合';
  T.interruptions = [];
  T.checkpoints = [];
  T.fired = [];
  T.planIdx = typeof idx === 'number' ? idx : -1;
  T.sentLeft = -1;
  for (let m = 25; m < minutes; m += 25) T.checkpoints.push(m * 60);

  tickOn();
  broadcast();
  return { ok: true };
}

function togglePause() {
  if (T.state === 'idle') return;
  if (!T.paused) {
    T.remain = Math.max(0, Math.round((T.endAt - Date.now()) / 1000));
    T.paused = true;
    clearTick();
  } else {
    T.paused = false;
    T.endAt = Date.now() + T.remain * 1000;
    tickOn();
  }
  broadcast();
}

/* 当天的对象本来在 5 个地方各写一遍字面量，字段还不完全一致
 * （发牌那条路径多了 newCards，评卡那条没有）。靠 `d.newCards || 0` 兜着不会出事，
 * 但将来给 day 加字段，很容易漏掉其中一处。统一在这里构造。 */
function ensureDay(key) {
  if (!cfg.days[key]) {
    cfg.days[key] = { plan: [], sessions: 0, minutes: 0, cards: 0, built: false, newCards: 0 };
  }
  const d = cfg.days[key];
  if (typeof d.newCards !== 'number') d.newCards = 0;
  return d;
}

function recordSession(status) {
  const planned = Math.round(T.total / 60);
  const elapsed = Math.max(0, Math.round((T.total - T.remain) / 60));
  const entry = {
    id: 's' + Date.now().toString(36),
    name: T.name,
    cat: T.cat,
    minutes: status === 'done' ? planned : elapsed,
    planned,
    startedAt: T.startedAt,
    endedAt: Date.now(),
    status,
    interruptions: T.interruptions.slice()
  };
  cfg.sessions.unshift(entry);
  /* 明细只留最近 2000 条；被裁掉的老记录不是消失，而是折进 lifetime 账本，
   * 所以「累计番茄 / 累计分钟」不会因为裁剪往回退。逻辑在 src/lifetime.js，
   * 那边能脱离窗口单测（selftest 有一节专门盯着它）。 */
  L.trimSessions(cfg);

  if (status === 'done') {
    const key = S.dayKey();
    const d = ensureDay(key);
    d.sessions = (d.sessions || 0) + 1;
    d.minutes = (d.minutes || 0) + planned;
    if (T.planIdx >= 0 && d.plan[T.planIdx]) d.plan[T.planIdx].done = true;
  }
  store.save();
}

/* ---------------- 记录明细的删改 ----------------
 * 删除只针对「明细」里的那 2000 条。更老的记录已经折进 lifetime 账本，
 * 只剩累计数字、没有单条可删的东西 ——「全部记录」里也看不到它们。
 *
 * 删一条要动三个地方，漏一个统计就对不上：
 *   1. cfg.sessions（列表本身）
 *   2. cfg.days[那天的 key]（今日番茄数、近 7 天柱状图、连续天数都看这里）
 *   3. 累计数不用管，它每次都由「账本 + 明细」现算（src/lifetime.js）
 * 计划的勾选状态不回退：那条记录代表"做过"，删掉记录不等于把任务打回未做。
 */
function removeSession(id) {
  if (!id) return null;
  const i = cfg.sessions.findIndex((s) => s.id === id);
  if (i < 0) return null;
  const entry = cfg.sessions.splice(i, 1)[0];
  if (entry.status === 'done') {
    const d = cfg.days[S.dayKey(new Date(entry.endedAt))];
    if (d) {
      d.sessions = Math.max(0, (d.sessions || 0) - 1);
      d.minutes = Math.max(0, (d.minutes || 0) - (entry.minutes || 0));
    }
  }
  store.save();
  broadcast();
  return entry;
}

/* 误删恢复：把整条原始记录按时间插回原位，并把那天的人数补回去。
 * 走的是同一个 days 口径，所以删除 → 撤销之后统计回到删除前的样子。
 *
 * 注意入参是从渲染进程绕回来的（弹层里的撤销按钮），不能当自己人：
 * 只认白名单里的字段，逐项转类型，别让一段乱数据混进 config.json。 */
function restoreSession(entry) {
  if (!entry || !entry.id) return false;
  const endedAt = Number(entry.endedAt);
  if (!Number.isFinite(endedAt)) return false;
  const clean = {
    id: String(entry.id),
    name: String(entry.name || '未命名'),
    cat: String(entry.cat || ''),
    minutes: Math.max(0, Number(entry.minutes) || 0),
    planned: Math.max(0, Number(entry.planned) || 0),
    startedAt: Number(entry.startedAt) || endedAt,
    endedAt,
    status: entry.status === 'done' ? 'done' : 'abort',
    interruptions: Array.isArray(entry.interruptions) ? entry.interruptions.slice(0, 50) : []
  };
  if (cfg.sessions.some((s) => s.id === clean.id)) return false;   // 已经有了，别插重
  let at = cfg.sessions.findIndex((s) => s.endedAt < clean.endedAt);
  if (at < 0) at = cfg.sessions.length;
  cfg.sessions.splice(at, 0, clean);
  if (clean.status === 'done') {
    const d = ensureDay(S.dayKey(new Date(clean.endedAt)));
    d.sessions = (d.sessions || 0) + 1;
    d.minutes = (d.minutes || 0) + clean.minutes;
  }
  store.save();
  broadcast();
  return true;
}

function finishSegment() {
  clearTick();

  if (T.state === 'break') {
    T.state = 'idle'; T.paused = false; T.total = 0; T.remain = 0;
    notify('休息结束', '可以开始下一个了', 'break-end');
    broadcast();
    return;
  }

  const name = T.name;
  recordSession('done');

  if (cfg.settings.autoBreak) {
    const bm = Math.max(1, cfg.settings.breakMin || 5);
    T.state = 'break';
    T.paused = false;
    T.total = bm * 60;
    T.remain = bm * 60;
    T.endAt = Date.now() + bm * 60 * 1000;
    T.startedAt = Date.now();
    T.name = '休息';
    T.cat = '';
    T.sentLeft = -1;
    T.interruptions = [];
    T.checkpoints = [];
    T.fired = [];
    T.planIdx = -1;
    tickOn();
    notify('「' + name + '」完成', '休息 ' + bm + ' 分钟，离开屏幕，别刷手机', 'focus-end');
  } else {
    T.state = 'idle'; T.paused = false; T.total = 0; T.remain = 0;
    notify('「' + name + '」完成', '按自己的节奏继续', 'focus-end');
  }
  broadcast();
}

function abortFocus() {
  if (T.state === 'idle') return;
  recordSession('abort');
  clearTick();
  const wasBreak = T.state === 'break';
  T.state = 'idle'; T.paused = false; T.total = 0; T.remain = 0;
  broadcast();
  return { ok: true, wasBreak };
}

function skipBreak() {
  if (T.state !== 'break') return;
  clearTick();
  T.state = 'idle'; T.paused = false; T.total = 0; T.remain = 0;
  broadcast();
}

/* 铃声交给界面层的 Web Audio 合成。主进程只负责"该响了"这个信号，
 * 因为计时器活在主进程，窗口最小化/进托盘时它照样在走。 */
function ringBell(kind) {
  if (!cfg.settings.sound) return;
  try {
    if (win && !win.isDestroyed()) {
      win.webContents.send('bell:ring', {
        id: cfg.settings.bell || 'tomato',
        kind,
        vol: cfg.settings.soundVol,
        // 久坐提醒只是"提一句"，连着响三遍就成打断了
        times: kind === 'tick-warn' ? 1 : cfg.settings.bellTimes
      });
    }
  } catch (e) {
    console.error('铃声下发失败', e);
  }
}

function notify(title, body, bellKind) {
  if (bellKind) ringBell(bellKind);
  if (!cfg.settings.notify) return;
  try {
    if (!Notification.isSupported()) return;
    // 自己响铃时把系统通知音静音，两个叠在一起很吵；
    // 铃声关掉时反过来，让系统通知音充当兜底
    new Notification({ title, body, silent: !!cfg.settings.sound }).show();
  } catch (e) {
    console.error('通知失败', e);
  }
}

/* ---------------- 词池 ----------------
 * 词池是只读的四/六级全表，cfg.cards 只存"手上正在学的"。
 *
 * 为什么不把整表铺进 cards：每张卡约 200 字节，4500 张就是 900KB，
 * 而 store.save() 每次都要重写整个 config.json 并留一份 .bak ——
 * 每完成一个番茄就要写两遍 2MB，磁盘写入会被这个放大几百倍。
 * 所以改成按需发牌：每天最多 N 个新词，学完一批才发下一批。
 */

// 当前考哪一级。存的值脏了（手改文件、老版本升级）就退回四级，
// 否则 wordPool 拿到 undefined 会静默给四级池，误差比报错更难查
function curLevel() {
  return normLevel(cfg.settings.level);
}

function today() {
  const key = S.dayKey();
  ensureDay(key);
  if (typeof cfg.days[key].newCards !== 'number') cfg.days[key].newCards = 0;
  return cfg.days[key];
}

function ensureNewCards() {
  const d = today();
  const limit = Math.max(5, Math.min(50, cfg.settings.dailyNew || 10));
  const issued = d.newCards || 0;
  // 手上还没看完的新词也算占位，避免一天之内越攒越多
  const pending = cfg.cards.filter((c) => c.reps === 0).length;
  const need = Math.min(limit - issued, limit - pending);
  if (need <= 0) return 0;

  const known = new Set(cfg.cards.map((c) => c.front.toLowerCase()));
  const pool = wordPool(curLevel());
  let added = 0;
  for (let i = 0; i < pool.length && added < need; i++) {
    const w = pool[i];
    const k = w.front.toLowerCase();
    if (known.has(k)) continue;
    cfg.cards.push(S.makeCard(w));
    known.add(k);
    added++;
  }
  if (added) {
    d.newCards = issued + added;
    store.save();
  }
  return added;
}

/* 词池与备考节奏：还剩多少词、离考试多少天、按现在的速度够不够。
 * 这里故意把"够不够"算出来告诉用户 —— 词库有 6000 多词，一天发 10 个
 * 要背两年，那不是备考，是慢性自杀。 */
function poolView() {
  const p = wordPool(curLevel());
  const st = poolStats(curLevel());
  const have = new Set(cfg.cards.map((c) => c.front.toLowerCase()));
  const left = p.filter((w) => !have.has(w.front.toLowerCase())).length;
  const perDay = Math.max(5, Math.min(50, cfg.settings.dailyNew || 10));

  // 六级新增词（六级表里有、四级表里没有的那 2118 个）单独算一份
  const only6Pool = p.filter((w) => w.lvl === 'cet6');
  const only6Left = only6Pool.filter((w) => !have.has(w.front.toLowerCase())).length;

  let days = null;
  const raw = String(cfg.settings.examDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const t = new Date(raw + 'T00:00:00').getTime();
    if (Number.isFinite(t)) {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      // 不夹到 0：考试当天 = 0、已经过了 < 0，界面要能分清这两种
      days = Math.ceil((t - now.getTime()) / S.DAY);
    }
  }

  const canCover = days == null ? null : days * perDay;
  const needPerDay = days && days > 0 ? Math.ceil(left / days) : null;
  const needPerDay6 = days && days > 0 ? Math.ceil(only6Left / days) : null;

  return {
    level: st.level,
    levelName: st.levelName,
    total: p.length,
    inHand: cfg.cards.length,
    left,
    cet4: st.cet4,
    cet6: st.cet6,
    only6: st.only6,
    only6Left,
    examDate: raw,
    days,
    perDay,
    canCover,
    needPerDay,
    needPerDay6,
    enough: days == null ? null : canCover >= left
  };
}

/* ---------------- 快照：主进程算好，界面只负责画 ---------------- */
function snapshot() {
  const key = S.dayKey();
  const stage = S.resolveStage(cfg.settings, cfg);
  S.buildPlan(cfg, stage, false);
  const d = ensureDay(key);

  /* 「累计番茄 / 累计分钟 / 时间花在哪」统一走一条口径：账本 + 明细
   * （src/lifetime.js）。别在这里另算一遍，否则裁剪之后两个数字会对不上。 */
  const sum = L.totalsOf(cfg);

  // 近 7 天
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date();
    dt.setDate(dt.getDate() - i);
    const k = S.dayKey(dt);
    week.push({
      key: k,
      label: i === 0 ? '今天' : (dt.getMonth() + 1) + '/' + dt.getDate(),
      min: cfg.days[k] ? (cfg.days[k].minutes || 0) : 0,
      today: i === 0
    });
  }

  // 题型分布：口径同上，账本里已经裁掉的老记录也算进来，否则用得越久这张图越偏
  const cats = Object.entries(sum.byCat)
    .filter(([, m]) => m > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  // 最长连续
  const keys = Object.keys(cfg.days)
    .filter((k) => cfg.days[k] && (cfg.days[k].sessions > 0 || cfg.days[k].cards > 0))
    .sort();
  let best = 0, run = 0, prev = null;
  keys.forEach((k) => {
    const t = new Date(k + 'T00:00:00').getTime();
    run = (prev !== null && t - prev === S.DAY) ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  });

  const todaySessions = cfg.sessions.filter((s) => S.dayKey(new Date(s.endedAt)) === key);
  const todayInterruptions = todaySessions.reduce((n, s) => n + (s.interruptions ? s.interruptions.length : 0), 0);

  const allDue = S.dueCards(cfg.cards);
  const freshDue = Math.min(10, allDue.filter((c) => c.reps === 0).length);
  const reviewDue = allDue.filter((c) => c.reps > 0).length;

  // 「学 N 个新词」里的 N 每次推送都按当前设置重算。
  // 直接改存储里的 plan 会连勾选状态一起重置，所以这里只改发出去的那份
  const dailyNew = Math.max(5, Math.min(50, cfg.settings.dailyNew || 10));
  const planOut = (d.plan || []).map((p) => (
    p.libId === 'vocab-new'
      ? Object.assign({}, p, { name: `学 ${dailyNew} 个新词` })
      : p
  ));

  return {
    settings: cfg.settings,
    timer: timerView(),
    stage,
    stageName: STAGES[stage].name,
    stageHint: STAGES[stage].hint,
    streak: S.streakDays(cfg),
    due: freshDue + reviewDue,
    dueNew: freshDue,
    dueReview: reviewDue,
    mastered: S.masteredCount(cfg.cards),
    totalCards: cfg.cards.length,
    pool: poolView(),
    today: {
      plan: planOut,
      sessions: d.sessions || 0,
      minutes: d.minutes || 0,
      cards: d.cards || 0,
      interruptions: todayInterruptions
    },
    totals: {
      pomodoros: sum.pomodoros,
      minutes: sum.minutes,
      best
    },
    week,
    cats,
    logs: cfg.sessions.slice(0, 20),
    curve: S.curvePoints(),
    taskLib: TASK_LIB,
    taskDone: d.plan.filter((p) => p.done).length,
    taskTotal: d.plan.length,
    // 界面要据此把「亚克力 / 云母」两档置灰，而不是让人选了没反应
    materialOk: materialSupported()
  };
}

function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send('state:changed', snapshot());
  updateTrayMenu();
}

/* ---------------- 托盘 ---------------- */
function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
}

function trayImage() {
  const p = path.join(__dirname, 'assets', 'tray.png');
  if (fs.existsSync(p)) {
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) return img;
  }
  return nativeImage.createEmpty();
}

function updateTray(force) {
  if (!tray) return;
  let text = 'FocusCET';
  if (T.state === 'focus') {
    text = (T.paused ? '已暂停 ' : '') + fmtClock(T.remain) + '  ' + T.name;
  } else if (T.state === 'break') {
    text = '休息 ' + fmtClock(T.remain);
  }
  if (!force && text === lastTrayText) return;
  lastTrayText = text;
  try { tray.setToolTip(text); } catch (e) { /* ignore */ }
}

function updateTrayMenu() {
  if (!tray) return;
  const items = [
    { label: '打开 FocusCET', click: () => showWin() },
    { type: 'separator' }
  ];

  if (T.state === 'focus') {
    items.push({ label: T.paused ? '继续' : '暂停', click: () => togglePause() });
    items.push({ label: '记一次干扰', click: () => { showWin(); } });
    items.push({ label: '放弃当前番茄', click: () => abortFocus() });
  } else if (T.state === 'break') {
    items.push({ label: '跳过休息', click: () => skipBreak() });
  } else {
    items.push({ label: '选任务开始', click: () => showWin() });
  }

  items.push({ type: 'separator' });
  items.push({ label: '退出', click: () => { quitting = true; app.quit(); } });

  try { tray.setContextMenu(Menu.buildFromTemplate(items)); } catch (e) { /* ignore */ }
  updateTray(true);
}

function createTray() {
  try {
    tray = new Tray(trayImage());
    tray.on('click', () => showWin());
    tray.on('double-click', () => showWin());
    updateTrayMenu();
  } catch (e) {
    console.error('托盘创建失败（不影响主功能）', e);
  }
}

/* ---------------- 窗口 ---------------- */
/* 亚克力 / 云母（DWMWA_SYSTEMBACKDROP_TYPE）要 Win11 22H2（build 22621）起。
 * 拿不到版本号就当作不支持 —— 宁可让用户看到纯色，也别给一块没有毛玻璃的
 * 半透明窗口（字直接压在他桌面壁纸上，没法看）。 */
function materialSupported() {
  if (process.platform !== 'win32') return false;
  try {
    const build = parseInt(String(os.release()).split('.')[2] || '0', 10);
    return build >= 22621;
  } catch (e) { return false; }
}

/* 材质画在窗口表面**后面**，所以窗口底色必须是全透明，否则永远透不出来。
 * 这句是从 ZeroDesk 的踩坑记录里学来的：只把 body 透明了没用，html 那层
 * 实色背景堵着，看起来就是"选了没反应"。渲染层对应的是 html:has(body.mat) 。
 *
 * 三档的区别（DWMWA_SYSTEMBACKDROP_TYPE）：
 *   acrylic → DWMSBT_TRANSIENTWINDOW  桌面亚克力，糊得最狠，但它本来是给
 *             弹出层/右键菜单这种"瞬态表面"用的，**窗口一失焦 DWM 就不画了**，
 *             背景会退回清晰。这是系统行为，改不了（见 README 材质那节）。
 *   mica    → DWMSBT_MAINWINDOW       云母，给长生存期窗口用的，失焦照样在。
 *   tabbed  → DWMSBT_TABBEDWINDOW     云母 Alt，同样长生存期，透感比云母强一档。 */
function applyMaterial() {
  if (!win || win.isDestroyed()) return;
  const m = cfg.settings.material || 'solid';
  if (typeof win.setBackgroundMaterial !== 'function') return;
  // 老版本 Electron 的枚举里没有 tabbed，逐级退，别让整个材质掉成"没有"
  const chain = (m !== 'solid' && materialSupported())
    ? (m === 'tabbed' ? ['tabbed', 'mica'] : [m])
    : ['none'];
  for (const t of chain) {
    try {
      win.setBackgroundMaterial(t);
      if (IS_DEV) console.log('[material] ' + t + '（设置值 ' + m + '）');
      return;
    } catch (e) { /* 这个值不认，试下一个 */ }
  }
}

/* Mica / Acrylic 的明暗跟的是**窗口的暗色标记**，不是我们页面的配色。
 * 不设这一句的话：系统是浅色主题、应用选了深色 → DWM 给一块浅材质，
 * 深色界面浮在浅底上，字全糊。nativeTheme.themeSource 会顺手把
 * DWMWA_USE_IMMERSIVE_DARK_MODE 一起改掉，材质才会跟着变深。 */
function applyThemeMode() {
  try {
    nativeTheme.themeSource = cfg.settings.theme === 'light' ? 'light' : 'dark';
  } catch (e) { /* 老版本没有这个属性，忽略 */ }
}


function showWin() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  const b = cfg.win || {};
  const bounds = {
    width: Math.max(760, b.width || 900),
    height: Math.max(560, b.height || 700)
  };
  if (Number.isFinite(b.x) && Number.isFinite(b.y)) { bounds.x = b.x; bounds.y = b.y; }

  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const winIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();

  win = new BrowserWindow({
    ...bounds,
    minWidth: 760,
    minHeight: 560,
    frame: false,
    roundedCorners: true,
    // 全透明底：材质画在窗口表面后面，这里不透明就永远透不出来。
    // 纯色模式下渲染层的 body 会铺实色，观感跟以前一样。
    backgroundColor: '#00000000',
    icon: winIcon.isEmpty() ? undefined : winIcon,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // 切到别的窗口/最小化时不能被节流，否则到点铃声发不出来
      backgroundThrottling: false
    }
  });

  applyThemeMode();
  applyMaterial();
  win.setAlwaysOnTop(!!cfg.settings.alwaysOnTop);
  // CET4_VIEW 仅供开发期验证：启动时直接落到某个页面
  const devView = process.env.CET4_VIEW;
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), devView ? { hash: devView } : undefined);

  /* 开发期快捷键。无边框窗口没有菜单栏，Ctrl+R / F12 默认都不生效，得自己接 */
  if (IS_DEV) {
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      const k = String(input.key || '').toLowerCase();
      const ctrl = input.control || input.meta;
      if (k === 'f12' || (ctrl && input.shift && k === 'i')) {
        win.webContents.toggleDevTools();
        e.preventDefault();
        return;
      }
      if (ctrl && k === 'r') {
        win.webContents.reloadIgnoringCache();
        e.preventDefault();
        return;
      }
      if (k === 'f5') {
        win.webContents.reloadIgnoringCache();
        e.preventDefault();
      }
    });
    if (process.env.CET4_DEVTOOLS === '1') {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  }

  // 渲染进程的报错要能被这边看到：打包后没有 devtools，界面白屏时只能靠日志定位
  win.webContents.on('console-message', (...args) => {
    try {
      const d = args[1];
      if (d && typeof d === 'object') {
        if (d.level === 'error' || d.level === 'warning') {
          console.error('[renderer:' + d.level + ']', d.message, d.sourceId + ':' + d.lineNumber);
        }
      } else if (args[1] >= 2) {
        console.error('[renderer]', args[2], args[4] + ':' + args[3]);
      }
    } catch (e) { /* ignore */ }
  });
  win.webContents.on('render-process-gone', (e, details) => {
    console.error('渲染进程崩了', JSON.stringify(details));
  });

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
    if (store.getBrokenBackup()) {
      dialog.showMessageBox(win, {
        type: 'warning',
        title: '配置文件出过问题',
        message: '上次的数据文件读取失败，残骸已备份。',
        detail: store.getBrokenBackup() + '\n\n程序已尽量抢救出能用的部分。',
        buttons: ['知道了']
      });
    }
  });

  // 窗口尺寸记忆：拖动时 moved 会连续触发几十次，防抖到 400ms
  let rememberTimer = null;
  const rememberNow = () => {
    if (!win || win.isDestroyed() || win.isMaximized() || win.isMinimized()) return;
    const bb = win.getBounds();
    if (!Number.isFinite(bb.width) || !Number.isFinite(bb.height)) return;
    cfg.win = { width: bb.width, height: bb.height, x: bb.x, y: bb.y };
    store.save();
  };
  const remember = () => { clearTimeout(rememberTimer); rememberTimer = setTimeout(rememberNow, 400); };
  win.on('resize', remember);
  win.on('move', remember);

  const sendMax = () => { if (win && !win.isDestroyed()) win.webContents.send('window:maximized', win.isMaximized()); };
  win.on('maximize', sendMax);
  win.on('unmaximize', sendMax);

  win.on('close', (e) => {
    if (quitting) return;
    // 开发/测试模式下关窗口就退出，不收托盘。
    // 否则每次关掉窗口都得去右下角把图标捞回来，调界面时极其烦人
    if (IS_DEV && T.state !== 'focus') {
      quitting = true;
      app.quit();
      return;
    }
    if (cfg.settings.closeToTray) {
      e.preventDefault();
      win.hide();
      notifyOnce();
      return;
    }
    if (T.state === 'focus' && !T.paused) {
      const r = dialog.showMessageBoxSync(win, {
        type: 'question',
        title: '当前番茄还没结束',
        message: '关掉窗口，这个番茄会作废。',
        detail: '还剩 ' + fmtClock(T.remain) + '。也可以收进托盘，让它继续走。',
        buttons: ['作废并退出', '收进托盘继续', '取消'],
        defaultId: 1,
        cancelId: 2
      });
      if (r === 2) { e.preventDefault(); return; }
      if (r === 1) { e.preventDefault(); win.hide(); return; }
    }
  });

  win.on('closed', () => { win = null; });
}

let trayHinted = false;
function notifyOnce() {
  if (trayHinted) return;
  trayHinted = true;
  notify('FocusCET 还在后台', '点右下角托盘图标可以随时叫回来');
}

/* ---------------- IPC ---------------- */
function registerIpc() {
  ipcMain.handle('state:get', () => snapshot());

  ipcMain.handle('timer:start', (e, payload) => {
    const item = payload && payload.item ? payload.item : null;
    if (!item) return { ok: false, msg: '没有任务' };
    return startFocus(item, payload.idx);
  });

  ipcMain.handle('timer:toggle', () => { togglePause(); return { ok: true }; });
  ipcMain.handle('timer:abort', () => abortFocus());
  ipcMain.handle('timer:skipBreak', () => { skipBreak(); return { ok: true }; });

  ipcMain.handle('timer:interrupt', (e, reason) => {
    if (T.state !== 'focus') return { ok: false };
    T.interruptions.push({ at: Date.now(), reason: (reason || '').trim() || '未说明' });
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('plan:toggle', (e, idx) => {
    const d = cfg.days[S.dayKey()];
    if (!d || !d.plan[idx]) return { ok: false };
    d.plan[idx].done = !d.plan[idx].done;
    store.save();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('plan:add', (e, item) => {
    const d = cfg.days[S.dayKey()];
    if (!d) return { ok: false };
    d.plan.push({
      libId: 'custom',
      name: String(item.name || '').slice(0, 40) || '自定义任务',
      cat: item.cat || '综合',
      minutes: Math.max(5, Math.min(180, Math.round(item.minutes || cfg.settings.pomo))),
      desc: '自定义任务',
      done: false
    });
    store.save();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('plan:remove', (e, idx) => {
    const d = cfg.days[S.dayKey()];
    if (!d || !d.plan[idx]) return { ok: false };
    // 把删掉的东西原样带回去，界面用它做撤销
    const item = d.plan.splice(idx, 1)[0];
    store.save();
    broadcast();
    return { ok: true, item, idx };
  });

  // 撤销删除：插回原来的位置，而不是追加到末尾
  ipcMain.handle('plan:restore', (e, payload) => {
    const d = cfg.days[S.dayKey()];
    if (!d || !payload || !payload.item) return { ok: false };
    const at = Math.min(Math.max(0, payload.idx | 0), d.plan.length);
    d.plan.splice(at, 0, payload.item);
    store.save();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('plan:rebuild', () => {
    const stage = S.resolveStage(cfg.settings, cfg);
    S.buildPlan(cfg, stage, true);
    store.save();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('card:due', (e, limit) => {
    ensureNewCards();
    const now = Date.now();
    const all = cfg.cards.filter((c) => c.due <= now);
    // 没见过的新词单独限量：一天最多铺 10 个，堆太多等于没学
    const fresh = all.filter((c) => c.reps === 0).slice(0, 10);
    const review = all.filter((c) => c.reps > 0).sort((a, b) => a.due - b.due).slice(0, 40);
    const list = fresh.concat(review).slice(0, Math.min(60, limit || 40));
    return list.map((c) => ({
      id: c.id, front: c.front, back: c.back, ex: c.ex,
      iv: c.iv, group: c.group, reps: c.reps
    }));
  });

  ipcMain.handle('card:learned', (e, id) => {
    const card = cfg.cards.find((c) => c.id === id);
    if (!card) return { ok: false };
    S.markLearned(card);
    const key = S.dayKey();
    const d = ensureDay(key);
    d.cards = (d.cards || 0) + 1;
    store.save();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('card:rate', (e, { id, rating }) => {
    const card = cfg.cards.find((c) => c.id === id);
    if (!card) return { ok: false };
    S.rateCard(card, rating);
    const key = S.dayKey();
    const d = ensureDay(key);
    d.cards = (d.cards || 0) + 1;
    store.save();
    broadcast();
    return { ok: true };
  });

  /* 只在沙盒里挂的测试钩子：造出"已学过且已到期"的卡片。
   * 队列里新词优先级更高，所以顺手把其余新词推到后面，否则测验卡永远排不上队。
   * 正式环境不存在这个接口。 */
  if (ENV === 'test') {
    ipcMain.handle('dev:makeDue', (e, count) => {
      const n = Math.max(1, Math.min(20, count || 5));
      const later = Date.now() + 7 * S.DAY;
      let touched = 0;
      cfg.cards.forEach((c) => {
        if (c.reps > 0) return;
        if (touched < n) {
          c.reps = 1;
          c.iv = 0;
          c.due = Date.now() - 1000;
          touched++;
        } else {
          c.due = later;
        }
      });
      store.save();
      broadcast();
      return touched;
    });

    /* 把当前这段计时的结束时间拉近，用来秒级验证"到点→响铃→进休息"整条链路。
     * 否则验一次要真等 25 分钟。正式环境不存在。 */
    ipcMain.handle('dev:fastForward', (e, seconds) => {
      if (T.state === 'idle') return { ok: false, why: '没有在跑的计时' };
      const s = Math.max(1, Math.min(600, seconds || 2));
      T.endAt = Date.now() + s * 1000;
      T.remain = s;
      T.total = Math.max(T.total, s);
      return { ok: true, state: T.state, remain: s };
    });
  }

  ipcMain.handle('card:import', (e, raw) => {
    const exist = new Set(cfg.cards.map((c) => c.front.toLowerCase()));
    let added = 0;
    String(raw || '').split('\n').forEach((line) => {
      line = line.trim();
      if (!line) return;
      const p = line.split('|');
      if (p.length < 2 || !p[0].trim() || !p[1].trim()) return;
      if (exist.has(p[0].trim().toLowerCase())) return;
      cfg.cards.push(S.makeCard({ front: p[0].trim(), back: p[1].trim(), ex: (p[2] || '').trim(), group: '自定义' }));
      added++;
    });
    store.save();
    broadcast();
    return { ok: true, added };
  });

  ipcMain.handle('card:seed', () => {
    // 手动加牌：无视今天剩下的配额，但一次最多 20 个，别一口气塞爆
    const known = new Set(cfg.cards.map((c) => c.front.toLowerCase()));
    const pool = wordPool(curLevel());
    let added = 0;
    for (let i = 0; i < pool.length && added < 20; i++) {
      const k = pool[i].front.toLowerCase();
      if (known.has(k)) continue;
      cfg.cards.push(S.makeCard(pool[i]));
      known.add(k);
      added++;
    }
    if (added) store.save();
    broadcast();
    return { ok: true, added };
  });

  ipcMain.handle('settings:set', (e, patch) => {
    const p = Object.assign({}, patch || {});
    let msg = '';
    // 级别只认 cet4 / cet6；存进来的脏值一律退回四级，
    // 不然 wordPool 拿到不认识的值会悄悄给四级池，界面却显示"六级"
    if ('level' in p) p.level = normLevel(p.level);
    // 考试日期只认 YYYY-MM-DD。填错就清空，别在界面上挂一个错的倒计时
    if ('examDate' in p) {
      const v = String(p.examDate || '').trim();
      p.examDate = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
    }
    /* 数值范围在主进程再钳一次。界面上每个输入框都有 min/max，但那是"正常路径"；
     * 用 CDP 直连主进程、或者以后写自动化脚本时，一条 settings:set 就能把
     * dailyNew 写成 99999，第二天的发牌逻辑会照做。这里兜住，成本几行。 */
    const num = (v, lo, hi, dflt) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
    };
    if ('daily' in p) p.daily = num(p.daily, 20, 360, 60);
    if ('pomo' in p) p.pomo = num(p.pomo, 10, 60, 25);
    if ('breakMin' in p) p.breakMin = num(p.breakMin, 1, 30, 5);
    if ('dailyNew' in p) p.dailyNew = num(p.dailyNew, 5, 50, 10);
    if ('soundVol' in p) p.soundVol = num(p.soundVol, 0, 100, 70);
    if ('bellTimes' in p) {
      const t = Number(p.bellTimes);
      p.bellTimes = (t === 1 || t === 3 || t === 6) ? t : 3;
    }
    if ('material' in p) {
      const want = ['solid', 'acrylic', 'mica', 'tabbed'].includes(p.material) ? p.material : 'solid';
      if (want !== 'solid' && !materialSupported()) {
        // 不支持时别把半透明皮肤留下：窗口会透出桌面却没有任何毛玻璃
        p.material = 'solid';
        msg = '这个系统还不支持亚克力 / 云母（要 Win11 22H2 以上），先用纯色';
      } else {
        p.material = want;
      }
    }

    cfg.settings = Object.assign({}, cfg.settings, p);
    if ('material' in p) applyMaterial();
    // 换深浅色不只是换 CSS 变量：材质的明暗也跟着窗口的暗色标记走
    if ('theme' in p) { applyThemeMode(); applyMaterial(); }
    if ('alwaysOnTop' in p && win && !win.isDestroyed()) {
      win.setAlwaysOnTop(!!cfg.settings.alwaysOnTop);
    }
    if ('stage' in p) {
      const stage = S.resolveStage(cfg.settings, cfg);
      S.buildPlan(cfg, stage, true);
    }
    // 换语速等于换了一套缓存键，新语速的音频要重新合
    if ('voicePace' in p) TTS.setPace(cfg.settings.voicePace);
    store.save();
    broadcast();
    return { ok: true, level: curLevel(), msg: msg };
  });

  /* 打开 Windows 的语音设置页。装英文发音不用去翻菜单，
   * 从应用里点一下直接跳过去，这是"朗读功能坏了"最省事的补救路径。 */
  ipcMain.handle('sys:voiceSettings', () => {
    shell.openExternal('ms-settings:speech').catch(() => {
      shell.openExternal('ms-settings:regionlanguage').catch(() => {});
    });
    return { ok: true };
  });

  /* ---------------- 铃声文件 ----------------
   * 内置音色是界面层现场合成的，不落盘；这里只管用户上传的。
   * 文件放在 userData/sounds/，跟着数据目录走，沙盒模式下自动隔离。
   */
  const soundsDir = () => path.join(app.getPath('userData'), 'sounds');
  /* 只认文件名，把路径分隔符和 .. 全切掉。customSounds 只由本程序写入，
   * 正常不会有脏值；但用户手改 config.json 时，file 里写个 ../../ 就能让
   * sound:get 读走任意文件。一行成本，堵住。 */
  const soundPath = (file) => path.join(soundsDir(), path.basename(String(file || '')));

  ipcMain.handle('sound:list', () => {
    // 清理被手动删掉文件的记录，别在界面上留一个点了没反应的选项
    const alive = [];
    (cfg.settings.customSounds || []).forEach((s) => {
      if (fs.existsSync(soundPath(s.file))) alive.push(s);
    });
    if (alive.length !== (cfg.settings.customSounds || []).length) {
      cfg.settings.customSounds = alive;
      store.save();
    }
    return alive.map((s) => ({ id: s.id, name: s.name, builtin: false }));
  });

  ipcMain.handle('sound:upload', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '选一个铃声文件',
      properties: ['openFile'],
      filters: [{ name: '音频', extensions: ['wav', 'mp3', 'ogg', 'm4a', 'aac', 'flac'] }]
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };

    const src = r.filePaths[0];
    try {
      const st = fs.statSync(src);
      // 铃声就是个几秒的提示音，给上限是防止把一整首歌拖进来
      if (st.size > 2 * 1024 * 1024) {
        return { ok: false, why: '文件超过 2MB 了。铃声几秒钟就够，太大加载会卡' };
      }
      const dir = soundsDir();
      fs.mkdirSync(dir, { recursive: true });
      const ext = (path.extname(src) || '.wav').toLowerCase();
      const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const file = id + ext;
      fs.copyFileSync(src, path.join(dir, file));

      const name = path.basename(src, path.extname(src)).slice(0, 20) || '我的铃声';
      cfg.settings.customSounds = (cfg.settings.customSounds || []).concat({ id, name, file });
      cfg.settings.bell = id;           // 传完直接切过去，省得再选一次
      store.save();
      broadcast();
      return { ok: true, id, name };
    } catch (err) {
      return { ok: false, why: '复制失败：' + err.message };
    }
  });

  ipcMain.handle('sound:remove', (e, id) => {
    const list = cfg.settings.customSounds || [];
    const item = list.find((s) => s.id === id);
    if (!item) return { ok: false };
    try { fs.unlinkSync(soundPath(item.file)); } catch (err) { /* 文件没了也无所谓 */ }
    cfg.settings.customSounds = list.filter((s) => s.id !== id);
    if (cfg.settings.bell === id) cfg.settings.bell = 'tomato';   // 删掉正在用的，退回默认
    store.save();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('sound:get', (e, id) => {
    const item = (cfg.settings.customSounds || []).find((s) => s.id === id);
    if (!item) return { ok: false, why: '找不到这个铃声' };
    try {
      const buf = fs.readFileSync(soundPath(item.file));
      return { ok: true, data: buf.toString('base64') };
    } catch (err) {
      return { ok: false, why: '读不到文件：' + err.message };
    }
  });

  /* ---------------- 单词发音（内置离线神经语音） ----------------
   * 全部在主进程做：渲染进程拿不到 child_process，
   * 而且合成要读 60MB 模型，放在界面线程里会把界面卡住。 */
  ipcMain.handle('tts:status', () => TTS.status());
  ipcMain.handle('tts:say', (e, text) => TTS.say(text));
  ipcMain.handle('tts:clear', () => TTS.clearCache());
  ipcMain.handle('tts:prefetch', (e, words) => {
    // 预热是后台活，不卡界面：立刻返回，合成完只写日志
    TTS.prefetch(words).then((r) => {
      if (r && r.ok && r.made) console.log('[tts] 预热 ' + r.made + ' 个词');
    }).catch((err) => console.warn('[tts] 预热失败 ' + err.message));
    return { ok: true };
  });

  /* 「全部记录」：一次拿全，弹层自己按月分组。
   * 只给界面要用的字段，2000 条整包也就 200KB 上下，比来回分页省事得多。 */
  ipcMain.handle('data:allLogs', () => ({
    logs: cfg.sessions.map((s) => ({
      id: s.id,
      name: s.name,
      cat: s.cat,
      minutes: s.minutes,
      planned: s.planned,
      endedAt: s.endedAt,
      status: s.status,
      interruptions: Array.isArray(s.interruptions) ? s.interruptions.length : 0
    })),
    archived: cfg.lifetime.pomodoros,   // 已经被裁进账本、只剩累计的老记录数
    limit: L.LIMIT
  }));

  ipcMain.handle('data:deleteSession', (e, id) => {
    const entry = removeSession(id);
    return entry ? { ok: true, entry } : { ok: false, msg: '这条记录已经不在了' };
  });

  ipcMain.handle('data:restoreSession', (e, entry) => ({ ok: restoreSession(entry) }));

  ipcMain.handle('data:export', async () => {
    const r = await dialog.showSaveDialog(win, {
      title: '导出备份',
      defaultPath: 'FocusCET备份-' + S.dayKey() + '.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false };
    try {
      fs.writeFileSync(r.filePath, JSON.stringify(cfg, null, 2), 'utf8');
      return { ok: true, path: r.filePath };
    } catch (err) {
      return { ok: false, msg: err.message };
    }
  });

  ipcMain.handle('data:import', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择备份文件',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths.length) return { ok: false };
    try {
      const raw = fs.readFileSync(r.filePaths[0], 'utf8');
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || !data.settings) throw new Error('不是本应用的备份文件');
      store.replace(data);
      cfg = store.get();
      broadcast();
      return { ok: true };
    } catch (err) {
      return { ok: false, msg: err.message };
    }
  });

  ipcMain.handle('data:reveal', () => {
    shell.showItemInFolder(path.join(app.getPath('userData'), 'config.json'));
    return { ok: true };
  });

  /* 清空重来。
   * 之前只有「导出 / 恢复」——恢复得先有一份导出的文件，等于从来没导出过的人
   * 一旦数据脏了就无路可退。这里补上真正的"从零开始"，但不做直接抹掉：
   * 1) 先落一份备份到用户目录，抹错了还能捞；
   * 2) 正在跑的番茄先中止，否则清完还挂着一个指向旧计划的计时器；
   * 3) 清完立刻重新铺今天的安排和第一批新词，别让人对着空页面发呆。
   * learn 只清学习数据（番茄 / 卡片 / 安排），设置保留；
   * all 连设置一起回出厂，但窗口位置尺寸留着，否则会跳回屏幕中间。 */
  ipcMain.handle('data:reset', (e, mode) => {
    const scope = mode === 'all' ? 'all' : 'learn';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const bakPath = path.join(app.getPath('userData'), '重置前备份-' + stamp + '.json');

    try {
      fs.writeFileSync(bakPath, JSON.stringify(cfg, null, 2), 'utf8');
    } catch (err) {
      return { ok: false, msg: '备份没写成，已取消清空：' + err.message };
    }

    if (T.state !== 'idle') abortFocus();

    const keepWin = cfg.win;
    cfg.days = {};
    cfg.sessions = [];
    cfg.cards = [];
    // 账本也要一起清，否则"重新开始"之后累计番茄数还挂着上一份人生
    cfg.lifetime = { pomodoros: 0, minutes: 0, byCat: {} };
    cfg.createdAt = Date.now();
    if (scope === 'all') {
      const d = store.DEFAULTS();
      cfg.settings = d.settings;
      TTS.setPace(cfg.settings.voicePace);
      if (win && !win.isDestroyed()) win.setAlwaysOnTop(!!cfg.settings.alwaysOnTop);
    }
    cfg.win = keepWin;

    const stage = S.resolveStage(cfg.settings, cfg);
    S.buildPlan(cfg, stage, true);
    ensureNewCards();
    store.save();
    broadcast();
    return { ok: true, scope: scope, backup: bakPath, cards: cfg.cards.length };
  });

  ipcMain.handle('window:minimize', () => { if (win) win.minimize(); });
  ipcMain.handle('window:toggleMaximize', () => {
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
    return win.isMaximized();
  });
  ipcMain.handle('window:close', () => { if (win) win.close(); });
  ipcMain.handle('app:quit', () => { quitting = true; app.quit(); });
}

/* ---------------- 热更新（仅开发/测试） ----------------
 * 界面文件改了 → 刷新页面（保留数据，因为你改的只是画法）
 * 主进程 / src 里的模块改了 → 整个应用重启
 * 两者分得清，改 CSS 时不会把你的计时器打断
 */
function startHotReload() {
  if (!IS_DEV) return;
  const rendererDir = path.join(__dirname, 'renderer');
  const srcDir = path.join(__dirname, 'src');

  let reloadTimer = null;
  let restartTimer = null;

  const reloadPage = () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      if (win && !win.isDestroyed()) {
        win.webContents.reloadIgnoringCache();
        console.log('[hot] 界面已刷新');
      }
    }, 200);
  };

  const restartApp = () => {
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      console.log('[hot] 主进程代码有变化，正在重启…');
      quitting = true;
      /* 注意不能 app.relaunch() + app.exit()：
       * exit 是立即终止，relaunch 安排的拉起根本来不及执行，进程就没了。
       * 有启动器时交给它重启（退出码 66），控制台和日志都能接上；
       * 直接 electron . 启动时退回 relaunch + quit。 */
      if (process.env.CET4_SPAWNER === '1') {
        app.exit(66);
      } else {
        app.relaunch();
        app.quit();
      }
    }, 300);
  };

  const watch = (dir, handler) => {
    try {
      fs.watch(dir, { recursive: true }, (evt, name) => {
        if (!name) return;
        if (/\.(js|css|html)$/i.test(name)) handler();
      });
      console.log('[hot] 监听中', dir);
    } catch (e) {
      console.error('[hot] 监听失败', dir, e.message);
    }
  };

  watch(rendererDir, reloadPage);
  watch(srcDir, restartApp);

  /* 监听单个文件。注意不能用裸的 fs.watchFile：
   * 它第一次建立快照时必然上报一次 change，结果是应用刚启动就自杀重启，
   * 重启后又误判，一路抽风到所有进程退出。这里先记下基准 mtime，只认真正的变化 */
  const watchFileStable = (file, cb) => {
    let base = null;
    try { base = fs.statSync(file).mtimeMs; } catch (e) { /* 文件还没生成 */ }
    try {
      fs.watchFile(file, { interval: 700 }, (curr) => {
        if (!curr || !curr.mtimeMs) return;
        if (base === null) { base = curr.mtimeMs; return; }
        if (curr.mtimeMs === base) return;
        base = curr.mtimeMs;
        cb();
      });
    } catch (e) { /* ignore */ }
  };

  // main.js 自己改了也要重启，不然改了等于没改
  watchFileStable(path.join(__dirname, 'main.js'), restartApp);
  watchFileStable(path.join(__dirname, 'preload.js'), restartApp);
}

/* ---------------- 启动 ---------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { showWin(); });

  app.whenReady().then(() => {
    cfg = store.init();
    TTS.init(app.getPath('userData'), cfg.settings.voicePace);
    const ts = TTS.status();
    console.log('[tts] ' + (ts.ok ? '离线语音就绪 · ' + (ts.voices[0] || '?') : '离线语音不可用，将退回系统语音')
      + '  引擎=' + ts.engineDir);

    // 词库不再预铺：整表塞进 config.json 会让每次保存写将近 1MB。
    // 现在改成按需发牌（ensureNewCards），cards 里只有手上正在学的那些。
    if (!cfg.seeded) {
      cfg.seeded = true;
      store.save();
      console.log('首次启动，' + (curLevel() === 'cet6' ? '六级' : '四级') + '词池 '
        + wordPool(curLevel()).length + ' 词就绪（按需发牌）');
    }

    // 一开机就把今天该发的牌发出来。原来只在打开复习页时才发，
    // 结果设置页里写着"手上 0 张"，看着像坏了
    const issued = ensureNewCards();
    if (issued) console.log('今天发了 ' + issued + ' 个新词');

    registerIpc();
    createWindow();
    createTray();
    startHotReload();
    console.log(`[env] ${ENV}  userData=${app.getPath('userData')}`);
  });

  app.on('window-all-closed', () => {
    // 有托盘就常驻；没托盘才跟着窗口退出
    if (!tray || process.platform === 'darwin') app.quit();
  });

  app.on('before-quit', () => { quitting = true; clearTick(); });

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}
