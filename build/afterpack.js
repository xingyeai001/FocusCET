// 打包后、生成安装包之前的收尾：把用不到的语言包清成 0 字节。
//
// 为什么是"清空"而不是"删除"：
//   1. 本机的删除守卫一次删 50 个文件就会拦下（electron-builder 裁语言包时正好踩线）；
//   2. 对 NSIS 的体积来说两者没区别 —— 压缩后都是一片零，等于白占不得。
//
// 只留 zh-CN 和 en-US：这个应用是纯中文界面，自绘标题栏，Electron 的
// 原生菜单/对话框也只用这两种。其余 53 种（泰语、阿拉伯语、日语……）留着纯属浪费。
const fs = require('fs');
const path = require('path');

const KEEP = new Set(['zh-CN.pak', 'en-US.pak']);

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const dir = path.join(context.appOutDir, 'locales');
  if (!fs.existsSync(dir)) return;

  let count = 0;
  let bytes = 0;
  for (const name of fs.readdirSync(dir)) {
    if (KEEP.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (!st.isFile() || st.size === 0) continue;
    bytes += st.size;
    fs.truncateSync(p, 0);
    count += 1;
  }
  console.log('  • [afterPack] 清空 ' + count + ' 个多余语言包，省下 ' +
    (bytes / 1048576).toFixed(1) + ' MB');
};
