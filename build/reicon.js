// 从 build/icon.png（512 的母图）生成界面实际引用的两张小图：
//   assets/icon.png  窗口 / 任务栏图标，256
//   assets/tray.png  托盘图标，32（先裁掉透明外边距，小尺寸下图形才够大）
//
// 换图标时只要替换 build/icon.png 再跑一次本脚本，不用改主进程：
//   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe build/reicon.js
// 打包用的 build/icon.ico 是另一份文件（多尺寸 ico），由设计稿直接导出，不经这里。

const { app, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(() => {
  const src = path.join(__dirname, 'icon.png');
  const img = nativeImage.createFromPath(src);
  const { width: W, height: H } = img.getSize();
  if (!W || !H) { console.error('读不出 build/icon.png'); app.exit(1); return; }

  // 找出真正有像素的范围：母图四周可能是透明留白，
  // 直接缩到 32 会让图形只剩中间一小块，托盘里看着像个点。
  const bmp = img.toBitmap();               // BGRA
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (bmp[(y * W + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const hasAlpha = x1 >= 0 && (x1 - x0 + 1) < W;
  if (!hasAlpha) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; }
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;

  const write = (file, image, note) => {
    fs.writeFileSync(file, image.toPNG());
    const s = image.getSize();
    console.log('  ' + path.basename(file).padEnd(10) + s.width + '×' + s.height +
      '  ' + String(Math.round(fs.statSync(file).size / 102.4) / 10) + ' KB   ' + note);
  };

  const assets = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(assets, { recursive: true });

  const big = img.resize({ width: 256, height: 256, quality: 'best' });
  write(path.join(assets, 'icon.png'), big, '窗口 / 任务栏');

  // 托盘：裁到内容区再缩。保留图标本身的深色底板 —— 试过把底板键成透明，
  // C 周围那圈辉光会留下来变成一块发灰的方块，反而更脏；深色底板贴在深色
  // 任务栏上本来就接近隐形，真正看得见的是那个亮环，够用。
  const cropped = img.crop({ x: x0, y: y0, width: cw, height: ch });
  const tray = cropped.resize({ width: 64, height: 64, quality: 'best' });
  write(path.join(assets, 'tray.png'), tray, '托盘');

  console.log('  母图 ' + W + '×' + H + '，内容区 ' + cw + '×' + ch + '（起点 ' + x0 + ',' + y0 + '）' + (hasAlpha ? '，已裁掉透明边' : '，无透明边'));
  app.exit(0);
});
