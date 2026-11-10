// 通过调试协议给窗口截图（不受遮挡影响）
// 用法：node build/snap.js 输出文件.png

const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');

const out = process.argv[2] || 'snap.png';
const PORT = Number(process.env.CET4_DEBUG_PORT || 9333);

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/json', timeout: 2000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  const targets = await getTargets();
  const page = targets.find((t) => t.type === 'page');
  if (!page) { console.error('没有页面'); process.exit(2); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });

  ws.on('open', async () => {
    await send('Page.enable');
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    if (r.result && r.result.data) {
      fs.writeFileSync(out, Buffer.from(r.result.data, 'base64'));
      console.log('SAVED', out);
    } else {
      console.error('FAIL', JSON.stringify(r).slice(0, 300));
    }
    ws.close();
    process.exit(0);
  });
})();
