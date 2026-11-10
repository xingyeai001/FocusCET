#!/usr/bin/env node
// 开发启动器 —— 所有启动方式（bat / npm start / 自动化测试）都走这里，
// 好处是环境变量只在 Node 里拼一次，不用去写一堆 Windows 的 set 语法。

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const argv = process.argv.slice(2);
const has = (...names) => names.some((n) => argv.includes(n));
const pick = (name) => {
  const hit = argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.split('=').slice(1).join('=') : '';
};

const sandbox = has('--sandbox', '--test');
const fresh = has('--fresh', '--clean');
const devtools = has('--devtools');
const view = pick('view');
const port = pick('port') || (sandbox ? '9333' : '9222');

const root = path.join(__dirname, '..');

/* 找 Electron 可执行文件。npm 的 postinstall 有时会被跳过，
 * 那就退回 node_modules/electron/dist 里那份，别让人卡在"装不上"这一步 */
function resolveElectron() {
  try {
    const p = require('electron');
    if (typeof p === 'string' && fs.existsSync(p)) return p;
  } catch (e) { /* 继续找 */ }
  const guesses = [
    path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(root, 'node_modules', 'electron', 'dist', 'electron')
  ];
  const hit = guesses.find((p) => fs.existsSync(p));
  if (hit) return hit;
  console.error('找不到 Electron，请先在项目目录执行：npm install');
  process.exit(1);
}

const exe = resolveElectron();

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.CET4_ENV = sandbox ? 'test' : 'dev';
env.CET4_DEBUG_PORT = port;
env.CET4_SPAWNER = '1';   // 告诉主进程：重启时交给我，别自己 relaunch
if (fresh) env.CET4_FRESH = '1';
if (devtools) env.CET4_DEVTOOLS = '1';
if (view) env.CET4_VIEW = view;

const sandboxRoot = path.join(os.tmpdir(), 'focuscet-sandbox');

console.log('');
console.log(sandbox ? '  ▸ 沙盒测试模式' : '  ▸ 开发模式');
console.log('  ─────────────────────────────────────────────');
if (sandbox) {
  console.log('  数据目录   ' + sandboxRoot);
  console.log('             （临时目录，删掉等于恢复出厂）');
  console.log('  真实数据   完全不会被写入');
} else {
  console.log('  数据目录   ' + path.join(process.env.APPDATA || '', 'FocusCET'));
}
console.log('  调试端口   ' + port + '   （自动化脚本用这个连）');
console.log('');
console.log('  F12 开发者工具   Ctrl+R 重载   改界面自动刷新');
console.log('  关掉窗口即退出，不会缩到托盘');
console.log('  ─────────────────────────────────────────────');
console.log('');

let child = null;
let restarts = [];

function launch() {
  child = spawn(exe, ['.'], { cwd: root, env, stdio: 'inherit' });

  child.on('exit', (code) => {
    // 66 = 主进程要求重启（改了 main.js / preload.js / src）
    if (code === 66) {
      const now = Date.now();
      restarts = restarts.filter((t) => now - t < 10000);
      restarts.push(now);
      // 语法错误会导致"起来就重启"的死循环，掐掉
      if (restarts.length > 6) {
        console.error('\n  10 秒内重启了 6 次，多半是 main.js 有语法错误。已停下，请检查上面的报错。\n');
        process.exit(1);
      }
      console.log('[hot] 应用重启中…\n');
      setTimeout(launch, 200);
      return;
    }
    process.exit(typeof code === 'number' ? code : 0);
  });

  child.on('error', (e) => {
    console.error('启动失败：', e.message);
    process.exit(1);
  });
}

launch();

['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => { try { if (child) child.kill(); } catch (e) { /* ignore */ } process.exit(0); });
});
