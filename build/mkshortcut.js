// 生成桌面快捷方式（开发期用，未打包时指向本地 Electron + 项目目录）
// 为什么要走 Electron 而不是 PowerShell：本机安全策略禁止创建 WScript.Shell 之类的 COM 对象，
// 而 Electron 的 shell.writeShortcutLink 是内置的 C++ 实现（IShellLink），不需要我们实例化 COM。
//
// 用法：env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe build/mkshortcut.js

const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const exe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
/* 快捷方式指向 FocusCET.ico，而不是打包用的 icon.ico。
 * 原因：Explorer 按「图标文件路径 + 索引」缓存图标，换了 ico 的内容但路径没变，
 * 桌面那边会一直显示旧的番茄图 —— 换路径是最省事的破缓存办法。 */
const icon = path.join(root, 'build', 'FocusCET.ico');

app.whenReady().then(() => {
  const desktop = app.getPath('desktop');
  const link = path.join(desktop, 'FocusCET.lnk');

  if (!fs.existsSync(exe)) {
    console.error('找不到 Electron：' + exe);
    app.exit(2);
    return;
  }

  const ok = shell.writeShortcutLink(link, 'create', {
    target: exe,
    args: '"' + root + '"',          // electron.exe <项目目录>
    cwd: root,
    description: 'FocusCET —— 四六级备考 + 番茄钟',
    icon: fs.existsSync(icon) ? icon : exe,
    iconIndex: 0,
    appUserModelId: 'com.focuscet.app'
  });

  if (ok) {
    const kb = (fs.statSync(link).size / 1024).toFixed(1);
    console.log('OK  ' + link + '  (' + kb + ' KB)');
  } else {
    console.error('FAIL 写入快捷方式失败：' + link);
  }
  app.exit(ok ? 0 : 1);
});
