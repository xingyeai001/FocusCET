// 验证铃声"真的出声"：不是看代码有没有调用，而是在音频输出链上插一个分析器，
// 测量真实的波形 RMS。peak > 0 才证明扬声器那头确实有信号。
const http = require('http');
const WebSocket = require('ws');
const PORT = Number(process.env.CET4_DEBUG_PORT || 9333);

const PROBE = `
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

const MEASURE = `
const an = window.__probe;
if (!an) return { err: '输出链上没抓到分析器' };
const buf = new Float32Array(an.fftSize);
let peak = 0, frames = 0;
for (let i = 0; i < 30; i++) {
  an.getFloatTimeDomainData(buf);
  let s = 0;
  for (let k = 0; k < buf.length; k++) s += buf[k] * buf[k];
  const rms = Math.sqrt(s / buf.length);
  if (rms > peak) peak = rms;
  if (rms > 0.0005) frames++;
  await new Promise(r => setTimeout(r, 40));
}
return { state: Bell.state(), peak: +peak.toFixed(5), frames, id: window.__probeId };
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

  const evaluate = async (expr) => {
    const res = await send('Runtime.evaluate', {
      expression: `(async () => { ${expr} })()`,
      awaitPromise: true,
      returnByValue: true
    });
    const d = res.result && res.result.exceptionDetails;
    if (d) throw new Error(d.exception ? d.exception.description : 'eval error');
    return res.result && res.result.result ? res.result.result.value : null;
  };

  const out = {};

  // 1. 挂钩分析器
  out.hook = await evaluate(PROBE);

  // 2. 逐个音色响一遍，量峰值（带参数时只测指定的那个 id）
  const only = process.argv[2];
  const ids = only ? [only] : await evaluate('return Bell.recipes().map(r => r.id)');
  out.bells = {};
  for (const bid of ids) {
    await evaluate(`Bell.play({ id: '${bid}', vol: 85, times: 1 }); return 1`);
    const m = await evaluate(MEASURE);
    out.bells[bid] = m.peak;
    // 等上一声衰减完再测下一个，避免串音
    await evaluate('await new Promise(r => setTimeout(r, 900)); return 1');
  }

  // 3. 音量 0 时应该完全没有声音（证明音量真的起作用）
  await evaluate(`Bell.play({ id: 'tomato', vol: 0, times: 1 }); return 1`);
  out.zeroVol = (await evaluate(MEASURE)).peak;

  ws.close();
  console.log(JSON.stringify(out, null, 2));
}

run().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
