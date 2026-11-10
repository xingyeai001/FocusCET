// 通过 Chrome DevTools 协议操作渲染进程，用于自动化验证
// 用法：node build/cdp.js "JS 表达式"
// 前提：应用以 --remote-debugging-port=9223 启动

const http = require('http');
const WebSocket = require('ws');

const expr = process.argv[2] || '1+1';
const PORT = Number(process.env.CET4_DEBUG_PORT || 9333);

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/json', timeout: 2000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

(async () => {
  let targets;
  for (let i = 0; i < 20; i++) {
    try { targets = await getTargets(); break; } catch (e) { await new Promise((r) => setTimeout(r, 500)); }
  }
  if (!targets) { console.error('连不上调试端口'); process.exit(2); }

  const page = targets.find((t) => t.type === 'page');
  if (!page) { console.error('没有页面 target'); process.exit(2); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();

  const send = (method, params) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });

  ws.on('open', async () => {
    const res = await send('Runtime.evaluate', {
      expression: `(async () => { ${expr} })()`,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.result && res.result.exceptionDetails) {
      console.error('EVAL-ERROR', JSON.stringify(res.result.exceptionDetails.exception && res.result.exceptionDetails.exception.description));
    } else {
      console.log(JSON.stringify(res.result && res.result.result ? res.result.result.value : null));
    }
    ws.close();
    process.exit(0);
  });

  ws.on('error', (e) => { console.error('WS-ERROR', e.message); process.exit(2); });
})();
