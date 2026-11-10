// 验证「到点真的响铃」这条完整链路：
// 主进程计时结束 → 推送 bell:ring → 界面合成声音 → 音频输出链上有波形
// 用 dev:fastForward 把 25 分钟压成 2 秒，否则验一次要真等。
const http = require('http');
const WebSocket = require('ws');
const PORT = Number(process.env.CET4_DEBUG_PORT || 9333);

const HOOK = `
const orig = AudioNode.prototype.connect;
AudioNode.prototype.connect = function (dest) {
  const name = dest && dest.constructor ? dest.constructor.name : '';
  if (name === 'AudioDestinationNode') {
    const an = this.context.createAnalyser();
    an.fftSize = 2048;
    orig.call(this, an);
    orig.call(an, dest);
    window.__probe = an;
    return dest;
  }
  return orig.apply(this, arguments);
};
return 'hooked';
`;

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/json', timeout: 2000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function run() {
  const targets = await getTargets();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('没有页面 target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await new Promise((r) => ws.on('open', r));

  const ev = async (expr) => {
    const res = await send('Runtime.evaluate', {
      expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true
    });
    const d = res.result && res.result.exceptionDetails;
    if (d) throw new Error(d.exception ? d.exception.description : 'eval error');
    return res.result && res.result.result ? res.result.result.value : null;
  };

  const out = {};

  // 没有现成的分析器就挂一个
  if (!(await ev('return !!window.__probe'))) await ev(HOOK);

  // 用当前选中的铃声，音量拉满，只响一声，便于测量
  await ev(`api.setSettings({ sound: true, soundVol: 90, bellTimes: 1 });
            await new Promise(r => setTimeout(r, 300)); return 1`);

  out.before = await ev('return { bell: ST.settings.bell, state: ST.timer.state }');

  // 起一个 25 分钟的任务，然后立刻把结束时间拉到 2 秒后
  await ev(`await api.startTimer({ name: '响铃测试', cat: '词汇', minutes: 25 }, -1);
            await new Promise(r => setTimeout(r, 600)); return 1`);
  out.started = await ev('return { state: ST.timer.state, remain: ST.timer.remain }');

  out.ff = await ev('return await api.devFastForward(2)');

  // 边等边采样，铃声是衰减的，取峰值
  let peak = 0, frames = 0;
  for (let i = 0; i < 45; i++) {
    const s = await ev(`
      const an = window.__probe;
      if (!an) return { err: 'no probe' };
      const b = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(b);
      let sum = 0;
      for (let k = 0; k < b.length; k++) sum += b[k] * b[k];
      return { rms: Math.sqrt(sum / b.length) };
    `);
    if (s && s.rms > peak) peak = s.rms;
    if (s && s.rms > 0.0005) frames++;
    if (i === 44) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  out.peak = +peak.toFixed(5);
  out.sounded = peak > 0.005;
  out.frames = frames;

  out.after = await ev('return { state: ST.timer.state, remain: ST.timer.remain, name: ST.timer.name }');
  out.grid = await ev(`return [...document.querySelectorAll('#todayGrid .snum')].map(x => x.textContent)`);

  // 收尾：把休息段放弃掉，别留在沙盒里
  await ev(`await api.abortTimer(); return 1`);

  ws.close();
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.sounded ? 0 : 1);
}

run().catch((e) => { console.error('FAIL', e.message); process.exit(2); });
