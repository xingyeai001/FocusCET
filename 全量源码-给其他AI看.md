# 番茄四六级 · 全量源码

> 生成于 2026-11-07。这是一份**完整源码**，不含依赖包和二进制资源，可直接通读。
> 代码规模：20 个源文件，6708 行。

---

## 0. 先说清楚这是什么，以及不用建议什么

**是什么**：一个给单人长期使用的 Windows 桌面备考工具，Electron 45 + 纯原生 HTML/CSS/JS。
把番茄工作法和英语四六级背单词绑在一起：计时器按题型给自然时长（精听 25 分钟、阅读套题 40 分钟、
整卷模考 130 分钟），复习侧用艾宾浩斯排程发词，内置离线神经语音（Piper）朗读单词。

**谁用**：作者本人一个人，零基础学编程，2026 年 12 月考试，每天开着它学。
按当前进度，实际每天大约点 30–60 次、停留 1–3 小时。

**不用建议的方向**（这些是有意识的取舍，不是没考虑）：

- 不建议改用 React / Vue / TypeScript / 加构建链。渲染层就 4 个文件、1100 行 JS，
  引入框架后构建、热更新、打包复杂度会翻几倍，收益为零。
- 不建议引入 Tailwind / UI 组件库。样式 658 行，改一个值直接改，不需要设计系统。
- 不建议做多用户、云同步、账号体系。
- 不建议把它重写成 Web 应用。它必须能离线、能收进托盘继续计时、不依赖浏览器权限。

**想看什么**：见第 6 节的编号问题。布局占大头，代码结构问题也欢迎。

---

## 0.5 上一轮外部审阅的处理结果

这一节是给已经看过上一版的读者，避免重复提已经处理过的点。

**修掉的（真 Bug）**

| 问题 | 处理 |
|---|---|
| 电脑睡眠会把番茄整段记成完成 | `tick` 里比对 `lastTickAt`，断档 > 60s 就把 `endAt` 顺延 |
| 暂停中的番茄被另一个任务顶掉、静默消失 | 主进程 `startFocus` 里先记一条 `abort`（界面层本来就有前置拦截，这是兜底） |
| 复习页空状态指向一个不存在的按钮 | 文案改成「设置 → 导入与数据 → 再发 20 个新词」 |
| 考试当天显示"这个日期已经过了" | `days` 不再 clamp 到 0：0 = 今天考，负数 = 已过 |
| 两栏方案留下的废弃 DOM 与死渲染函数 | `.today-grid` / `.stats-grid` / `.review-side` / `renderReviewSide` / `.rs-*` 样式全删 |
| `ttsprobe.js` 里硬编码的 Edge token | 文件删除 |

**加固的**

- TTS 批次 30 秒硬超时（以前 piper 挂死会让朗读永久静默，界面只一直转圈）
- `curvePoints` memoize（纯常量，每次评卡都重算 602 个采样点）
- 设置数值在主进程再钳一次；铃声文件路径走 `basename`
- 隐藏视图不重绘；`tick` 只在整秒变化时发 IPC；day 对象统一由 `ensureDay` 构造；发音探测加 60 秒 TTL
- TTS 缓存键加版本号（改过合成参数后，磁盘上的旧音频不会再被误命中 —— 这次就踩到了）

**新增的**

- 「清空重来」：设置 → 导入与数据 → 清理学习记录。以前只有「导出 / 恢复」，
  等于从没导出过的人数据脏了就无路可退。现在清空前自动落一份
  `重置前备份-<时间>.json`，确认框要求亲手打出「清空」两个字；
  `learn` 清学习数据、`all` 连设置回出厂（窗口位置尺寸保留）。

- 「界面材质」：外观里多了纯色 / 亚克力 / 云母三档。毛玻璃交给 Windows 的
  `setBackgroundMaterial`，代码只负责把 html / body / 面板的实色让开；系统低于
  Win11 22H2 时两档置灰并说明原因，不留"透了桌面却没有毛玻璃"的半截状态。

**明确否掉的**

- **"睡眠番茄直接作废"** → 改成顺延。合盖去接杯水就把番茄判死是冤枉人；顺延既不记账、也不打断。
- **引入 CSS 方法论 / 拆 `main.js` / 改 IPC 命名空间** → 同意不必做，保持现状。
- **"遗忘曲线坐标只有 7.5px"** → 那是两栏时期的数字。现在 780 单列下 SVG 放大约 1.1 倍，实测 11px，已提到 12.1px。

---

## 1. 硬规格（评估布局时按这个算，不要假设是网页）

| 项 | 值 |
|---|---|
| 运行环境 | Electron 45（Chromium 156），Windows 10/11 桌面窗口 |
| 默认窗口 | **900 × 700** |
| 最小窗口 | **760 × 560**（`minWidth` / `minHeight`） |
| 实际常用窗口 | 作者笔记本最大化后 **1707 × 1066**（这是最需要好看的尺寸） |
| 基准字号 | **13.5px**，全站用 px，不用 rem / em |
| 系统缩放 | 100%（不是 125%） |
| 滚动容器 | 只有 `.body` 一个，`#app` 固定高度，页眉不滚 |
| 主题 | 暗 / 亮两套，用 `[data-theme]` 切换 CSS 变量 |
| 视图 | 四个：今日 / 复习 / 记录 / 设置，同一时刻只显示一个（`.view.on`） |
| 框架 | 无。原生 DOM，`innerHTML` 拼字符串 |
| 字体 | 系统栈：`"Segoe UI", "Microsoft YaHei", system-ui` |

**没有一个页面是"文档流"**。它是工具型界面：左边计时器、右边列表；
设置页是一堆"标签 ……… 控件"的行；记录页是几张图表卡片。

---

## 2. 目录与文件清单

```
番茄四六级/
├── main.js                 主进程（1286 行）
├── preload.js              contextBridge 通道（63 行）
├── package.json            应用清单
├── src/
│   ├── store.js            持久化：原子写 + 备份 + 抢救（114 行）
│   ├── schedule.js         艾宾浩斯调度 / 计划生成 / 统计（179 行）
│   ├── data.js             任务库 / 阶段 / 词池 / 词频排序（377 行）
│   ├── tts.js              Piper 合成 + 缓存 + 预热（284 行）
│   ├── word-freq.json      6635 个词的频次排名（100KB，未附）
│   ├── cet4-words.txt      四级词表 4543 词（未附）
│   └── cet6-words.txt      六级词表 3991 词（未附）
├── renderer/
│   ├── index.html          四个视图骨架（296 行）
│   ├── style.css           全部样式（595 行）
│   ├── app.js              界面逻辑（1170 行）
│   └── bell.js             铃声合成（227 行）
├── engine/                 离线语音引擎 + 63MB 模型（未附，二进制）
├── build/                  启动器、CDP 工具、e2e 测试（未附亦可）
└── assets/                 图标
```

**关键一点**：`index.html` 里 `#planList`、`#todayGrid`、`#curveCard`、`#reviewBody`、
`#setMain` 这些容器**初始是空的**，内容全部由 `renderer/app.js` 在运行时拼字符串注入。
只看 HTML 会严重低估内容量。第 5 节给了实测的条目数和高度。

---

## 3. 进程边界与数据流

```
主进程 main.js
  ├── 计时状态机（唯一真相：stage / left / taskId / rounds）
  │     窗口最小化、切页面、收托盘时都必须继续走 —— 所以不放渲染层
  ├── 持久化 src/store.js → %APPDATA%\cet4-pomodoro\config.json
  │     原子写（临时文件 + rename）、覆盖前留 .bak、坏文件先抢救再丢弃
  ├── TTS src/tts.js → 子进程 piper.exe，按「词 + 语速」哈希落盘缓存
  └── 托盘图标上的倒计时文字
        ↕ IPC（40 个通道，preload.js 里 contextBridge 白名单）
渲染层 renderer/
  ├── app.js    视图切换 / 渲染 / 复习流程 / 设置表单 / 设置页滚动导航
  ├── bell.js   Web Audio 现场合成 8 种音色，AnalyserNode 量波形自检
  └── style.css 780 单列 + 双主题 + 设置页导航
```

数据规模：词池是**只读文本文件**（4543 / 3991 词），`cards` 里只放"手上正在学的"
（默认每天发 10 个），所以 `config.json` 冷启动时只有 4.5KB。
六千多张卡全塞进 JSON 的话每次保存要重写 1.3MB 并留备份，磁盘写入放大几百倍。

---

## 4. 布局现状

### 4.1 一行数字

| 项 | 值 |
|---|---|
| 窗口（作者常用，笔记本最大化） | **1707 × 1066**（可视内容高 1018） |
| 今日 / 复习 / 记录 三页内容列 | **780 固定居中**，两侧各空 **464** |
| 设置页 | **1040**（160 左导航 + 28 间距 + 852 内容），两侧各空 333 |
| 计划行 | 728 宽 = 勾选 18 + 标题区 528 + 右侧元信息 135 |

**前三页不随窗口宽度变形**，这是刻意定的，不是没做响应式。

### 4.2 试过的四种宽度，各自的问题

| 做法 | 1707 下内容列 | 两侧各空 | 结果 |
|---|---|---|---|
| **固定 780 单列（当前）** | 780 | 464 | 行内距离舒服，留白大 |
| 单列 1140 | 1140 | 283 | 计划行「词汇」到「12 分钟」空出 700px |
| 两栏 1140（`372 | 1fr`） | 1140 | 283 | 左计时器右列表；记录页 7 根柱摊在 806 里 |
| 铺满（`max-width: none`） | 1643 | 26 | 行内两端拉到 900px，柱状图散架 |

算术很直白：`列宽 × 列数 = 可用宽度`，而每行内容量固定。
**只拉宽容器、不加列，等于只拉长行内两端点的距离。**

作者的态度：**"两边空"能忍，"行内散"不能忍** —— 所以退回 780。

### 4.3 讨论过但没采纳的

- **方案 B：限宽 1320 + 整体放大一档（13.5 → 15px，行高间距同比放大）**。
  担心"字大而空"，且一改字号四个页面都要重新核对。
- **方案 C：限宽 + 控件左对齐**（设置行控件跟着标签走、固定 24px 间距）。
  治标：右侧空白没消失，只是从行内挪到行尾。
- **方案 A：铺满 + 加列**（今日三栏、记录三等分、设置页卡片网格）。
  要挪 DOM，改动面大，没把握出来后是否真好看。

---

## 5. 运行时内容量（评估时必须按这个算）

HTML 里那些容器初始是空的，真实条目如下（1707 窗口、780 单列实测）：

| 容器 | 内容 | 条目数 | 实测高度 |
|---|---|---|---|
| 今日页 | 计时器 + 今日安排 + 今天的账 | 4 条计划 | **881px**（可视 1018，不用滚） |
| `#view-review` | 一张卡 + 一个按钮，卡 500 宽居中 | 1 | **1018px**（正好一整屏） |
| `#view-stats` | 累计 / 近 7 天 / 时间分布 / 遗忘曲线 / 最近记录 | 5 张卡 | **886px** |
| 记录页柱状图 | 7 根柱，卡 728 宽，柱间 64px | 7 | 约 130px |
| `#setMain` | 设置分组 | **7 组、19 个设置行** | 约 1890px（852 宽时） |

设置页 7 组：备考 / 番茄钟 / 提醒 / 铃声 / 发音 / 外观 / 导入与数据。

---

## 6. 想请你回答的问题

### 布局（主要）

1. **1707×1066 的窗口里，780 宽的内容列居中、两侧各空 464（内容只占窗口 46%）。这个留白怎么处理才不显得空？**
   见过的做法：加背景纹理 / 径向渐变、内容左对齐而不居中、加一条常驻侧栏（放统计或图表）、
   把基准字号放大到 15px 让 780 显得合理、干脆接受。哪种在桌面工具上真的有效？

2. **桌面工具的内容列一般多宽？** VS Code 编辑区、Notion 正文、Linear、Things、Obsidian，
   它们在大屏上的正文 / 列表宽度通常是多少？780 是不是偏窄？有没有公开规范可引用？

3. **设置页 1040 比前三页宽 260，切页时内容宽度会跳。** 这算问题吗？
   还是应该把设置页也压到 780（内容列只剩 592，19 个设置行会更挤）？

4. **计划行 728 宽：标题区 528 + 右侧元信息 135，中间仍有约 450px 空白（标题文字只有 70px）。**
   列表行这种"标题靠左、元信息靠右"的结构，在宽行里怎么处理才不空？加一列说明？还是元信息跟标题左对齐？

5. **记录页柱状图：7 根柱摊在 728 宽卡片里，柱间 64px。** 这个比例合适吗？
   图表卡片有没有"超过多少宽就该补数据或换图型"的经验值？

6. **13.5px 基准字号在 780 列宽下是否合适？** 这是长期盯着看的备考工具，每天 1–3 小时。

7. **复习页整屏只有一张 500 宽的卡片，两侧各空 600。**
   这是刻意做成"专注一张卡"的（类似 Anki）。这种场景下大片留白是优点还是缺点？

8. **内容贴顶排，底部空一截（今日页 881 高，可视 1018）。** 要不要垂直居中？
   之前试过 `justify-content: safe center`，感觉"内容浮在中间"。

### 代码（次要，但也想知道）

9. `main.js` 1222 行、`renderer/app.js` 1153 行，都在一个文件里。
   对这种单人维护、不打算长期扩展的项目，拆文件是否值得？拆的边界在哪？

10. 渲染层用 `innerHTML` 拼字符串、每次状态变化重渲染整个区块。
   数据量很小（十几条），我没有做 diff。这种做法在什么规模下会出问题？

11. IPC 有 40 个通道，全部白名单挂在 `preload.js`。有没有更好的组织方式？

12. CSS 658 行，选择器基本是"块名 + 短横线"（`.srow`、`.pitem`、`.set-nav`），
    没有 BEM、没有工具类。这种规模下需要引入方法论吗？

---

## 7. 全部源码


### 入口与清单

#### `package.json` — 79 行

应用清单：Electron 版本、extraResources（引擎不打进 asar）、打包配置

```json
{
  "name": "cet4-pomodoro",
  "productName": "番茄四六级",
  "version": "0.1.0",
  "description": "番茄四六级 —— 把番茄工作法和四六级备考绑在一起的本地学习台",
  "main": "main.js",
  "license": "MIT",
  "scripts": {
    "start": "node build/dev.js",
    "dev": "node build/dev.js",
    "sandbox": "node build/dev.js --sandbox",
    "sandbox:fresh": "node build/dev.js --sandbox --fresh",
    "e2e": "node build/e2e.js",
    "test:sound": "node build/audiotest.js",
    "test:bell": "node build/belltest.js",
    "dist:dir": "electron-builder --win dir --x64",
    "dist:setup": "electron-builder --win nsis --x64"
  },
  "devDependencies": {
    "electron": "^45.2.1",
    "electron-builder": "^26.18.0"
  },
  "build": {
    "appId": "com.cet4pomodoro.app",
    "productName": "番茄四六级",
    "directories": {
      "output": "dist",
      "buildResources": "build"
    },
    "files": [
      "main.js",
      "preload.js",
      "src/**/*",
      "renderer/**/*",
      "assets/**/*",
      "!**/*.md"
    ],
    "asar": true,
    "compression": "maximum",
    "win": {
      "icon": "build/icon.ico",
      "executableName": "CETPomodoro",
      "target": [
        {
          "target": "dir",
          "arch": [
            "x64"
          ]
        },
        {
          "target": "nsis",
          "arch": [
            "x64"
          ]
        }
      ]
    },
    "nsis": {
      "oneClick": false,
      "perMachine": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "番茄四六级",
      "artifactName": "CETPomodoro-Setup-${version}.${ext}",
      "deleteAppDataOnUninstall": false
    },
    "electronDownload": {
      "mirror": "https://npmmirror.com/mirrors/electron/"
    },
    "extraResources": [
      {
        "from": "engine",
        "to": "engine"
      }
    ]
  }
}
```

#### `main.js` — 1384 行

主进程：窗口、托盘、计时状态机（含睡眠断档顺延）、JSON 持久化、TTS、通知、IPC

```js
// 番茄四六级 —— 主进程
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

const SANDBOX_ROOT = path.join(os.tmpdir(), 'cet4-pomodoro-sandbox');

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
  // 固定英文 userData 目录：默认会用中文 productName，路径里带中文在部分工具下会出问题
  app.setPath('userData', path.join(app.getPath('appData'), 'cet4-pomodoro'));
}
app.setAppUserModelId('com.cet4pomodoro.app');

// 调试端口：dev 和 test 用不同端口，两个实例可以同时开着互不干扰
if (process.env.CET4_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', String(process.env.CET4_DEBUG_PORT));
}

const store = require('./src/store');
const S = require('./src/schedule');
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
  if (cfg.sessions.length > 2000) cfg.sessions.length = 2000;

  if (status === 'done') {
    const key = S.dayKey();
    const d = ensureDay(key);
    d.sessions = (d.sessions || 0) + 1;
    d.minutes = (d.minutes || 0) + planned;
    if (T.planIdx >= 0 && d.plan[T.planIdx]) d.plan[T.planIdx].done = true;
  }
  store.save();
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

  const done = cfg.sessions.filter((s) => s.status === 'done');
  const totalMin = done.reduce((n, s) => n + s.minutes, 0);

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

  // 题型分布
  const byCat = {};
  done.forEach((s) => { byCat[s.cat] = (byCat[s.cat] || 0) + s.minutes; });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 6);

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
      pomodoros: done.length,
      minutes: totalMin,
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
  let text = '番茄四六级';
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
    { label: '打开番茄四六级', click: () => showWin() },
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
 * 实色背景堵着，看起来就是"选了没反应"。渲染层对应的是 html:has(body.mat)。 */
function applyMaterial() {
  if (!win || win.isDestroyed()) return;
  const m = cfg.settings.material || 'solid';
  if (typeof win.setBackgroundMaterial !== 'function') return;
  try {
    const effective = (m !== 'solid' && materialSupported()) ? m : 'none';
    win.setBackgroundMaterial(effective);
    if (IS_DEV) console.log('[material] ' + effective + '（设置值 ' + m + '）');
  } catch (e) { /* 老系统不支持就静默回退，界面那边会显示成纯色 */ }
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
  notify('番茄四六级还在后台', '点右下角托盘图标可以随时叫回来');
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
      const want = ['solid', 'acrylic', 'mica'].includes(p.material) ? p.material : 'solid';
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

  ipcMain.handle('data:export', async () => {    const r = await dialog.showSaveDialog(win, {
      title: '导出备份',
      defaultPath: '番茄四六级备份-' + S.dayKey() + '.json',
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
```

#### `preload.js` — 64 行

contextBridge 暴露给渲染层的唯一通道（40 个接口）

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),

  // 计时
  startTimer: (item, idx) => ipcRenderer.invoke('timer:start', { item, idx }),
  toggleTimer: () => ipcRenderer.invoke('timer:toggle'),
  abortTimer: () => ipcRenderer.invoke('timer:abort'),
  skipBreak: () => ipcRenderer.invoke('timer:skipBreak'),
  interrupt: (reason) => ipcRenderer.invoke('timer:interrupt', reason),

  // 今日计划
  togglePlan: (idx) => ipcRenderer.invoke('plan:toggle', idx),
  addPlan: (item) => ipcRenderer.invoke('plan:add', item),
  removePlan: (idx) => ipcRenderer.invoke('plan:remove', idx),
  restorePlan: (item, idx) => ipcRenderer.invoke('plan:restore', { item, idx }),
  rebuildPlan: () => ipcRenderer.invoke('plan:rebuild'),

  // 卡片
  dueCards: (limit) => ipcRenderer.invoke('card:due', limit),
  learnCard: (id) => ipcRenderer.invoke('card:learned', id),
  rateCard: (id, rating) => ipcRenderer.invoke('card:rate', { id, rating }),
  importCards: (raw) => ipcRenderer.invoke('card:import', raw),
  seedCards: () => ipcRenderer.invoke('card:seed'),

  // 铃声
  listSounds: () => ipcRenderer.invoke('sound:list'),
  uploadSound: () => ipcRenderer.invoke('sound:upload'),
  removeSound: (id) => ipcRenderer.invoke('sound:remove', id),
  getSound: (id) => ipcRenderer.invoke('sound:get', id),
  // 仅沙盒环境存在，正式版调用会报错
  devFastForward: (s) => ipcRenderer.invoke('dev:fastForward', s),

  // 发声：内置离线神经语音（Piper），返回 base64 WAV
  sayWord: (text) => ipcRenderer.invoke('tts:say', text),
  prefetchWords: (words) => ipcRenderer.invoke('tts:prefetch', words),
  ttsStatus: () => ipcRenderer.invoke('tts:status'),
  ttsClear: () => ipcRenderer.invoke('tts:clear'),

  // 设置与数据
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),
  revealData: () => ipcRenderer.invoke('data:reveal'),
  resetData: (mode) => ipcRenderer.invoke('data:reset', mode),
  // 打开系统「语音」设置页，用来装英文发音
  openVoiceSettings: () => ipcRenderer.invoke('sys:voiceSettings'),

  // 窗口
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  close: () => ipcRenderer.invoke('window:close'),
  quit: () => ipcRenderer.invoke('app:quit'),

  onState: (cb) => ipcRenderer.on('state:changed', (e, s) => cb(s)),
  onTick: (cb) => ipcRenderer.on('timer:tick', (e, t) => cb(t)),
  onBell: (cb) => ipcRenderer.on('bell:ring', (e, o) => cb(o)),
  onMaximize: (cb) => ipcRenderer.on('window:maximized', (e, v) => cb(v)),

  // 仅沙盒环境存在（主进程是否注册取决于 CET4_ENV=test）。
  // 用来把卡片直接改成"已到期"，省掉等 10 分钟才能测评分界面
  devMakeDue: (n) => ipcRenderer.invoke('dev:makeDue', n)
});
```

### 纯逻辑层（无 DOM，可单独测）

#### `src/store.js` — 115 行

数据持久化：原子写 + 备份 + 坏文件抢救

```js
// 数据持久化：写入 userData/config.json
// 学习数据是每天一点点攒的，丢了补不回来，所以这里做得比普通配置更谨慎：
// 1) 原子写入（先写 tmp 再 rename），防止进程被强杀时写出半截 JSON
// 2) 读到坏文件先备份残骸，再让程序以空数据启动 —— 绝不让 save() 覆盖掉还能救的东西
// 3) 每次保存前留一份滚动备份（config.bak.json），覆盖一次就有一份可回退

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

let file = '';
let bakFile = '';
let data = null;
let brokenBackup = '';

const DEFAULTS = () => ({
  version: 1,
  createdAt: Date.now(),
  settings: {
    daily: 60,          // 每日目标分钟
    pomo: 25,           // 标准番茄长度
    stage: 'auto',      // auto | base | build | boost | mock
    autoBreak: true,    // 铃响后自动进入休息
    breakMin: 5,
    material: 'solid',  // 界面材质：solid 纯色 | acrylic 亚克力 | mica 云母（Win11 22H2+）
    theme: 'dark',      // dark | light
    alwaysOnTop: false,
    closeToTray: true,
    notify: true,
    sound: true,       // 到点响铃
    soundVol: 70,      // 铃声音量 0-100
    bellTimes: 3,      // 连响几声（不在电脑前时多响几下才听得见）
    bell: 'tomato',    // 铃声：内置音色 id，或用户上传的音色 id
    customSounds: [],  // [{ id, name, file }] 用户上传的，文件在 userData/sounds/
    dailyNew: 10,      // 每天发几个新词。发出去的才会成卡，词池本身有四/六级全表
    level: 'cet4',     // 考哪一级：cet4 | cet6。只影响发新词从哪个池子里取
    examDate: '',      // 考试日期 YYYY-MM-DD，用来倒推每天该发多少词
    voicePace: 'normal' // 单词朗读语速：slow | normal | fast
  },
  win: { width: 900, height: 700, x: null, y: null },
  seeded: false,        // 内置词库是否已铺过（用户清空后不再自动补）
  days: {},
  sessions: [],
  cards: []
});

function init() {
  file = path.join(app.getPath('userData'), 'config.json');
  bakFile = path.join(app.getPath('userData'), 'config.bak.json');
  brokenBackup = '';

  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (file && fs.existsSync(file)) {
      brokenBackup = file + '.broken-' + Date.now();
      try { fs.copyFileSync(file, brokenBackup); } catch (e2) { brokenBackup = ''; }
      console.error('配置文件解析失败，残骸已备份：', brokenBackup);
      // 残骸救得了就先用残骸里的数据，别直接给空表
      try {
        const raw = fs.readFileSync(file, 'utf8');
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) data = JSON.parse(m[0]);
      } catch (e3) { /* 救不回来就用默认值 */ }
    }
    if (!data || typeof data !== 'object') data = null;
  }

  if (!data || typeof data !== 'object') data = DEFAULTS();

  const d = DEFAULTS();
  data = Object.assign({}, d, data);
  data.settings = Object.assign({}, d.settings, data.settings || {});
  data.win = Object.assign({}, d.win, data.win || {});
  if (!Array.isArray(data.sessions)) data.sessions = [];
  if (!Array.isArray(data.cards)) data.cards = [];
  if (!data.days || typeof data.days !== 'object') data.days = {};

  if (!brokenBackup) save();
  return data;
}

function getBrokenBackup() { return brokenBackup; }

function save() {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // 覆盖前先把上一版挪成 .bak，写坏了还能回退一步
    if (fs.existsSync(file)) {
      try { fs.copyFileSync(file, bakFile); } catch (e) { /* 备份失败不阻塞主流程 */ }
    }
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    console.error('保存配置失败', e);
  }
}

function get() { return data; }

function replace(next) {
  if (!next || typeof next !== 'object') return false;
  const d = DEFAULTS();
  data = Object.assign({}, d, next);
  data.settings = Object.assign({}, d.settings, next.settings || {});
  data.win = Object.assign({}, d.win, next.win || {});
  if (!Array.isArray(data.sessions)) data.sessions = [];
  if (!Array.isArray(data.cards)) data.cards = [];
  if (!data.days || typeof data.days !== 'object') data.days = {};
  save();
  return true;
}

module.exports = { init, save, get, replace, DEFAULTS, getBrokenBackup };
```

#### `src/schedule.js` — 179 行

艾宾浩斯调度、计划生成、统计聚合、curvePoints（带缓存）

```js
// 复习调度与每日计划生成 —— 纯逻辑，不碰窗口和 IPC，方便单独验证

const { TASK_LIB } = require('./data');

// 艾宾浩斯复习阶梯（天）。第一档 0.007 天约等于 10 分钟，用于当天巩固
const EBB = [0.007, 1, 2, 4, 7, 15, 30, 60];
const EBB_LABEL = ['10 分钟', '1 天', '2 天', '4 天', '7 天', '15 天', '30 天', '60 天'];
const DAY = 86400000;

function pad2(n) { return String(n).padStart(2, '0'); }

function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function makeCard(w) {
  return {
    id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    front: w.front,
    back: w.back,
    ex: w.ex || '',
    group: w.group || '自定义',
    iv: 0,
    due: Date.now(),   // 新词立即可学，学完才会被推到 10 分钟后
    reps: 0,
    lapses: 0,
    learnedAt: Date.now(),
    lastRating: null
  };
}

/* rating: 0 忘了 / 1 模糊 / 2 记得 */
function rateCard(card, rating) {
  if (rating === 0) {
    card.lapses++;
    card.iv = 0;
    card.due = Date.now() + EBB[0] * DAY;
  } else if (rating === 1) {
    card.iv = Math.max(0, card.iv - 1);
    card.due = Date.now() + EBB[card.iv] * DAY;
  } else {
    card.iv = Math.min(EBB.length - 1, card.iv + 1);
    card.due = Date.now() + EBB[card.iv] * DAY;
  }
  card.reps++;
  card.lastRating = rating;
  return card;
}

/* 新词第一次出现：只看不考，看完直接排到 10 分钟后 */
function markLearned(card) {
  card.reps = 1;
  card.iv = 0;
  card.due = Date.now() + EBB[0] * DAY;
  card.lastRating = 2;
  return card;
}

function dueCards(cards) {
  const now = Date.now();
  return cards.filter((c) => c.due <= now);
}

// 推到 7 天档以上算记住
function masteredCount(cards) {
  return cards.filter((c) => c.iv >= 4).length;
}

function totalMinutes(sessions) {
  return sessions.reduce((n, s) => n + (s.status === 'done' ? s.minutes : 0), 0);
}

function resolveStage(cfg, state) {
  if (cfg.stage && cfg.stage !== 'auto') return cfg.stage;
  const m = masteredCount(state.cards);
  const t = totalMinutes(state.sessions);
  if (m >= 40 || t >= 1200) return 'boost';
  if (m >= 10 || t >= 300) return 'build';
  return 'base';
}

function makePlanItem(t, state) {
  // 「学 10 个新词」里的数字跟着设置走。配速调到 50 了，任务名还写 10 就自相矛盾
  const name = (t.id === 'vocab-new' && state)
    ? `学 ${Math.max(5, Math.min(50, state.settings.dailyNew || 10))} 个新词`
    : t.name;
  return { libId: t.id, name, cat: t.cat, minutes: t.min, desc: t.desc, done: false };
}

function buildPlan(state, stage, force) {
  const key = dayKey();
  if (!state.days[key]) state.days[key] = { plan: [], sessions: 0, minutes: 0, cards: 0, built: false };
  const d = state.days[key];
  if (d.built && !force) return d;

  const pool = TASK_LIB.filter((t) => t.stages.includes(stage));
  const target = state.settings.daily;
  const plan = [];
  let total = 0;

  if (dueCards(state.cards).length > 0) {
    const t = TASK_LIB.find((x) => x.id === 'vocab-review');
    if (t) { plan.push(makePlanItem(t, state)); total += t.min; }
  }

  const dayNum = Math.floor(Date.now() / DAY);
  let idx = dayNum % pool.length;
  let guard = 0;
  while (total < target * 0.85 && guard < pool.length * 3) {
    const t = pool[idx % pool.length];
    if (!plan.some((p) => p.libId === t.id)) {
      plan.push(makePlanItem(t, state));
      total += t.min;
    }
    idx++; guard++;
  }

  if (plan.length < 2 && pool.length) {
    const extra = pool[(dayNum + 1) % pool.length];
    if (!plan.some((p) => p.libId === extra.id)) plan.push(makePlanItem(extra, state));
  }

  d.plan = plan;
  d.built = true;
  return d;
}

// 保持率：e^(-t/S)，S 随复习次数增长
function retention(dayOff, reviewCount) {
  const S = 0.92 * (1 + 0.8 * reviewCount);
  return Math.exp(-dayOff / S);
}

/* 生成两条曲线上的采样点，供界面画图。
 * 纯常量：不依赖任何状态，参数固定时输出永远是同一份 602 个点。
 * 而 snapshot() 每次评卡都会调它（一批 50 张卡就是 50 次），所以算一次就存着。
 * 键带上参数，将来有人传别的 maxDay/step 也不会拿到错的缓存。 */
const curveCache = new Map();
function curvePoints(maxDay = 30, step = 0.1) {
  const ck = maxDay + '|' + step;
  if (curveCache.has(ck)) return curveCache.get(ck);

  const raw = [];
  for (let t = 0; t <= maxDay; t += step) {
    raw.push([t, Math.max(0.05, retention(t, 0))]);
  }

  const REV = [1, 2, 4, 7, 15, 30];
  const rev = [];
  let y = 1, n = 0, ri = 0;
  for (let t = 0; t <= maxDay; t += step) {
    if (ri < REV.length && t >= REV[ri]) { y = 1; n++; ri++; }
    rev.push([t, y]);
    y *= Math.exp(-step / (0.92 * (1 + 0.8 * n)));
  }
  // 只读对象：界面那边是按点遍历画线，不会改它
  const out = { raw, rev, reviews: REV };
  curveCache.set(ck, out);
  return out;
}

/* 连续天数：今天没学也算，只要昨天学了就延续 */
function streakDays(state) {
  let n = 0;
  const d = new Date();
  for (let i = 0; i < 400; i++) {
    const key = dayKey(d);
    const day = state.days[key];
    if (day && (day.sessions > 0 || day.cards > 0)) n++;
    else if (i > 0) break;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

module.exports = {
  EBB, EBB_LABEL, DAY, pad2, dayKey, makeCard, markLearned, rateCard, dueCards,
  masteredCount, totalMinutes, resolveStage, buildPlan, curvePoints, streakDays
};
```

#### `src/data.js` — 377 行

任务库、阶段定义、词池加载（四级/六级）+ 词频分层排序

```js
// 静态数据：内置词库、任务库、阶段定义
// 词库每行格式：单词 | 释义 | 例句；# 开头是分组标记

const BUILTIN_RAW = `
#核心动词
achieve|v. 达到，实现|She worked hard to achieve her goal.
acquire|v. 获得，习得|Children acquire language quickly.
adapt|v. 适应；改编|It takes time to adapt to a new city.
adjust|v. 调整，适应|You can adjust the seat height.
adopt|v. 采用；收养|The school adopted a new rule.
affect|v. 影响|Lack of sleep affects your memory.
apply|v. 申请；应用|He applied for a scholarship.
appreciate|v. 感激；欣赏|I really appreciate your help.
approach|v. 接近；着手 n. 方法|We need a new approach to this problem.
argue|v. 争论；主张|They argued about the price.
arrange|v. 安排，整理|She arranged the meeting for Friday.
assess|v. 评估|Teachers assess students progress.
assume|v. 假设；承担|Do not assume everyone agrees with you.
attempt|v. 尝试 n. 努力|He attempted to fix the machine.
attract|v. 吸引|The city attracts many tourists.
avoid|v. 避免|Try to avoid making the same mistake.
compare|v. 比较|Compare the two answers carefully.
complete|v. 完成 adj. 完整的|Please complete the form.
consider|v. 考虑；认为|We are considering moving abroad.
contain|v. 包含，容纳|This box contains old photos.
contribute|v. 贡献；促成|Everyone contributed to the project.
create|v. 创造|The app creates a daily plan for you.
decrease|v. 减少|Sales decreased last month.
define|v. 定义|How do you define success?
depend|v. 依靠，取决于|It depends on the weather.
develop|v. 发展；开发|They developed a new product.
discover|v. 发现|Scientists discovered a new species.
discuss|v. 讨论|Let us discuss it tomorrow.
determine|v. 决定；确定|The result determines your grade.
deliver|v. 递送；发表|He delivered a short speech.
#学术高频
analysis|n. 分析|The analysis shows a clear trend.
aspect|n. 方面|Consider every aspect of the plan.
attitude|n. 态度|Her attitude towards work changed.
authority|n. 权威；当局|The local authority approved it.
benefit|n. 好处 v. 有益于|Exercise benefits both body and mind.
capacity|n. 容量；能力|The hall has a capacity of 500.
category|n. 类别|Books are sorted into categories.
circumstance|n. 情况，环境|Under no circumstances should you quit.
conclusion|n. 结论|We reached the same conclusion.
consequence|n. 后果|Every choice has consequences.
contrast|n. 对比 v. 对照|The contrast between the two is obvious.
criterion|n. 标准（复 criteria）|Price is not the only criterion.
data|n. 数据|The data supports this view.
definition|n. 定义|The definition is too vague.
evidence|n. 证据|There is little evidence for that claim.
factor|n. 因素|Cost is a major factor.
function|n. 功能 v. 运转|The function of this key is to save.
impact|n. 影响|The policy had a huge impact.
individual|n. 个人 adj. 个别的|Each individual learns differently.
method|n. 方法|This method saves a lot of time.
principle|n. 原则，原理|He sticks to his principles.
process|n. 过程 v. 加工|Learning is a slow process.
purpose|n. 目的|What is the purpose of this test?
research|n. 研究 v. 调查|She is doing research on memory.
resource|n. 资源|Time is our scarcest resource.
result|n. 结果 v. 导致|The result was better than expected.
structure|n. 结构|The essay has a clear structure.
theory|n. 理论|The theory has been tested for years.
trend|n. 趋势|There is a growing trend of remote work.
task|n. 任务|Break the task into small steps.
#形容词
accurate|adj. 准确的|The clock is very accurate.
actual|adj. 实际的|The actual cost was higher.
adequate|adj. 足够的|We have adequate time.
apparent|adj. 明显的|It soon became apparent that he lied.
appropriate|adj. 合适的|Wear appropriate clothes for the interview.
available|adj. 可获得的；有空的|The room is available after six.
aware|adj. 意识到的|Are you aware of the risk?
complex|adj. 复杂的|This is a complex problem.
considerable|adj. 相当大的|It took a considerable amount of time.
constant|adj. 持续的；不变的|The constant noise annoyed him.
crucial|adj. 关键的|Sleep is crucial for memory.
current|adj. 当前的|The current situation is stable.
efficient|adj. 高效的|This method is more efficient.
essential|adj. 必要的|Water is essential to life.
evident|adj. 明显的|His effort was evident.
flexible|adj. 灵活的|Our schedule is flexible.
frequent|adj. 频繁的|Frequent breaks help concentration.
fundamental|adj. 根本的|Reading is a fundamental skill.
gradual|adj. 逐渐的|There was a gradual improvement.
immediate|adj. 立即的|We need an immediate answer.
inevitable|adj. 不可避免的|Mistakes are inevitable when learning.
major|adj. 主要的 n. 专业|The major cause is lack of sleep.
minor|adj. 次要的|It is only a minor problem.
obvious|adj. 明显的|The answer is obvious.
potential|adj. 潜在的 n. 潜力|She has great potential.
precise|adj. 精确的|Give me a precise number.
previous|adj. 以前的|The previous owner kept it clean.
primary|adj. 首要的|Our primary goal is to finish on time.
relevant|adj. 相关的|Only relevant details are needed.
significant|adj. 显著的；重要的|There was a significant rise in sales.
#逻辑连接
however|adv. 然而|It rained; however, we went out.
therefore|adv. 因此|He was late; therefore he missed the bus.
moreover|adv. 而且|The plan is cheap; moreover, it works.
whereas|conj. 而，然而|He likes tea, whereas she prefers coffee.
despite|prep. 尽管|Despite the rain, they kept walking.
consequently|adv. 结果，因此|He overslept; consequently he was late.
furthermore|adv. 此外|Furthermore, the cost is too high.
nevertheless|adv. 然而|It was hard; nevertheless, we finished.
regarding|prep. 关于|He asked a question regarding the schedule.
eventually|adv. 最终|She eventually found the answer.
`;

// 每个题型有它自己的自然时长 —— 这是本应用和普通番茄钟的根本区别
const TASK_LIB = [
  { id: 'vocab-review',     cat: '词汇', name: '过一遍卡片',     min: 12,  desc: '到期的先复习，没见过的先看一遍', stages: ['base', 'build', 'boost', 'mock'] },
  { id: 'vocab-new',        cat: '词汇', name: '学 10 个新词',   min: 15,  desc: '新词当天必须再过一次',   stages: ['base', 'build', 'boost'] },
  { id: 'listen-sound',     cat: '听力', name: '听音辨词 10 个', min: 10,  desc: '听发音写单词，练耳朵',   stages: ['base'] },
  { id: 'listen-intensive', cat: '听力', name: '精听短文 1 篇',  min: 25,  desc: '盲听、看稿、复述各一遍', stages: ['base', 'build', 'boost'] },
  { id: 'listen-dictation', cat: '听力', name: '听写 5 句',      min: 20,  desc: '一句一句写，写完对答案', stages: ['build', 'boost'] },
  { id: 'read-passage',     cat: '阅读', name: '精读 1 篇',      min: 30,  desc: '查生词、拆长句，不求快', stages: ['build', 'boost'] },
  { id: 'read-set',         cat: '阅读', name: '限时阅读套题',   min: 40,  desc: '一次做完，中途不休息',   stages: ['boost', 'mock'] },
  { id: 'translate',        cat: '翻译', name: '翻译 1 段',      min: 30,  desc: '闭卷写完再对照答案',     stages: ['boost', 'mock'] },
  { id: 'write',            cat: '写作', name: '写作 1 篇',      min: 35,  desc: '闭卷写完，不查词典',     stages: ['boost', 'mock'] },
  { id: 'exam-half',        cat: '综合', name: '半套限时',       min: 65,  desc: '听力加阅读，按考试节奏', stages: ['mock'] },
  { id: 'exam-full',        cat: '综合', name: '整卷模考',       min: 130, desc: '连续作答，不用番茄',     stages: ['mock'] }
];

const STAGES = {
  base:  { name: '基础期', hint: '先把每天坐下来变成习惯' },
  build: { name: '积累期', hint: '加阅读和听写，开始有量' },
  boost: { name: '强化期', hint: '全题型上场，开始限时' },
  mock:  { name: '模拟期', hint: '整卷模考，停用番茄' }
};

function parseBuiltin() {
  const out = [];
  let group = '';
  BUILTIN_RAW.split('\n').forEach((line) => {
    line = line.trim();
    if (!line) return;
    if (line.startsWith('#')) { group = line.slice(1).trim(); return; }
    const p = line.split('|');
    if (p.length >= 2) {
      out.push({ front: p[0].trim(), back: p[1].trim(), ex: (p[2] || '').trim(), group });
    }
  });
  return out;
}

/* ---------------- 四六级全表 ----------------
 * 数据来源：KyleBing/english-vocabulary（BSD-3-Clause）
 *   四级 7508 行里有 2965 个重复词条，去重后 4543，和四级大纲的 4500 词对得上
 *   六级 5651 行同样有重复，去重后 3991，其中 1873 个四级表里已有，六级独有 2118
 * 只含"单词 + 释义"，没有例句没有音标：原表就没有，音标改用朗读代替（比看符号有用）。
 */
const LEVEL_INFO = {
  cet4: { name: '四级', file: 'cet4-words.txt' },
  cet6: { name: '六级', file: 'cet6-words.txt' }
};

const levelCache = new Map();

function normLevel(level) {
  return LEVEL_INFO[level] ? level : 'cet4';
}

function loadLevel(level) {
  const key = normLevel(level);
  if (levelCache.has(key)) return levelCache.get(key);
  const info = LEVEL_INFO[key];
  let out = [];
  try {
    // 延迟 require，让这个文件在纯逻辑测试里也能被 require 而不依赖 fs 路径
    const fs = require('fs');
    const path = require('path');
    const raw = fs.readFileSync(path.join(__dirname, info.file), 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      if (!line.trim()) return;
      const i = line.indexOf('\t');
      if (i < 1) return;
      const front = line.slice(0, i).trim();
      // 原表里 "青年， 年轻人" 这种逗号后带空格的地方不少，压成一个空格清爽些
      const back = line.slice(i + 1).replace(/[ \t]+/g, ' ').trim();
      if (front && back) out.push({ front, back, ex: '', group: info.name + '全表', lvl: key });
    });
  } catch (e) {
    console.error(info.name + '词表读取失败：', e.message);
    out = [];
  }
  levelCache.set(key, out);
  return out;
}

// 老调用方还在用这个名字
function loadCet4() { return loadLevel('cet4'); }
function loadCet6() { return loadLevel('cet6'); }

/* ---------------- 词频排序 ----------------
 * 原表是乱序的（KyleBing 那两份词表本身被洗过牌），所以"核心 100 之后
 * 下一个学什么"完全随机：可能今天发 access，明天发 equivalence，
 * 难度和常用度参差不齐，等于把每天那 10 个名额交给运气。
 *
 * 现在按 Google Web Trillion 语料的词频排名排（build/reorder.js 生成
 * src/word-freq.json，源表 227,031 条，四六级词表覆盖 99.6%）。
 *
 * 但不能纯按频次升序：四级词表里排最前的 40 个是 of / and / a / in / for /
 * on / by / i / it / not ... —— 这些是小学词，占名额等于浪费时间。
 * 所以分三层，层内再按"频次 + 词长"打分排序：
 *
 *   第 0 层 主体词：不满足下面两条的，真正该花时间学的
 *   第 1 层 基础词：排名 ≤ 2000 且不超过 7 个字母（of / page / nature / foot /
 *                  king / copy），大概率已会，放到主体词之后兜底
 *   第 2 层 生僻词：词频表里查不到（aviate / impermanency 这类），排最末
 *   另加一条：首字母大写（China / Monday / European）一律降到第 1 层，专有名词不背
 *
 * 实测出来的曲线（四级主体段前 N 个的平均频次排名）：
 *   前 100 → 735    前 500 → 1910    前 1000 → 2661
 *   前 2000 → 4315  全程 3566 → 11103
 * 单调递增，说明确实是从常用往生僻走的。前 100 个里最生的词 rank 1754，
 * 没有出现"生僻长词被词长修正顶上来"的情况。
 *
 * 代价要说清楚：growth / income / although / drug 这类"高频但偏短"的词会
 * 被一起后置（它们在 1001–2000 且 ≤7 字母）。这类词约几十个，真要学可以用
 * 「+ 加牌」手动拿。用它们换掉近千个已会词的名额，划算。
 */
const BASIC_RANK = 2000;

let FREQ = {};
try {
  FREQ = require('./word-freq.json');
} catch (e) {
  // 词频表缺失就退化成原表顺序，不能因为这个把整个应用拖崩
  console.error('词频表读取失败，退回原表顺序：', e.message);
}

function freqRank(word) {
  const r = FREQ[String(word).toLowerCase()];
  return typeof r === 'number' ? r : Infinity;
}

/* 专有名词不占学习名额。
 * 四级词表里有 59 个首字母大写的词（China / Monday / European / January /
 * English / God ...），全是国名、月份、星期、语言、宗教 —— 认得，但不用背。
 * 不降级的话前 10 个名额会被 Africa / Monday / European 吃掉。 */
function isProper(word) {
  return /^[A-Z]/.test(String(word));
}

function letters(word) {
  return String(word).replace(/[^A-Za-z]/g, '').length;
}

/* 又高频又短 = 大概率已会。
 *
 * 只看频次会误判：international 排名 700，纯按"rank ≤ 2000"就会被当成基础词
 * 扔到 3455 位之后 —— 可它是四级阅读里处处都有的词，必须早学。
 * 同理 information / education / development 这些 -tion/-ment 长词的频次都极高。
 * 加一个"短"的条件（≤ 7 字母）就能把它们分开：of / page / nature / foot /
 * king / copy 是短的高频词（已会），international / education / employment
 * 是长的高频词（该学）。 */
const BASIC_LEN = 7;

function tierOf(word) {
  if (isProper(word)) return 1;
  const r = freqRank(word);
  if (r === Infinity) return 2;
  return r <= BASIC_RANK && letters(word) <= BASIC_LEN ? 1 : 0;
}

function byFreq(a, b) {
  return scoreOf(a.front) - scoreOf(b.front);
}

/* 排序分：频次排名，按词长修正 —— 每多一个字母，相当于排名往前挪 200 位。
 *
 * 为什么需要这一刀：纯按频次排，六级池第一个发出去的是 "bug"（rank 2001，
 * 3 个字母），而 "religion"（2021，8 个字母）排在它后面 —— 但 bug 是小学词。
 * 英语里短词基本都是基础词（count / foot / mass / king / heat / miss），
 * 词长是"要不要背"的可靠代理。
 *
 * 系数 200 的含义：一个 8 字母词即使比某个 5 字母词低频 600 名，也该先学它。
 * 取 200 是因为四六级词的平均长度约 7–8，这个量级刚好能把 bug/count 这类
 * 短词压到同频次段的后半，又不会把大量低频长词顶到最前面。 */
function scoreOf(word) {
  const r = freqRank(word);
  if (r === Infinity) return Infinity;
  return r - (letters(word) - 5) * 200;
}

/* 把一段词拆成「主体 / 基础 / 生僻」三堆，每堆内部按频次从高到低 */
function splitByTier(list) {
  const main = [];
  const basic = [];
  const unknown = [];
  list.forEach((w) => {
    const t = tierOf(w.front);
    if (t === 0) main.push(w);
    else if (t === 1) basic.push(w);
    else unknown.push(w);
  });
  main.sort(byFreq);
  basic.sort(byFreq);
  unknown.sort(byFreq);
  return { main, basic, unknown };
}

/* 学习用的词池。
 *
 * 四级池 = 核心100（手工顺序不动）→ 四级主体词 → 四级基础词 → 生僻词
 * 六级池 = 核心100 → 六级新增主体 → 四级主体 → 基础词（两段合并按频次）→ 生僻词
 *
 * 核心 100 为什么不参与重排：它们是带例句的精讲卡，按"高频动词 → 学术名词 →
 * 写作连接词"编组，主题成组更好记。它们的频次分布在 131（data）到 16742
 * （gradual），本来就都算高频，排最前面不违和。
 *
 * 六级为什么把"新增词"排在前面：六级卷子真正拉开差距的就是这 2118 个词，
 * 四级那 4500 个是基础。但基础词仍然留在池子里 —— 没过四级的人不能跳过它们。
 */
const poolCache = new Map();

function wordPool(level) {
  const key = normLevel(level);
  if (poolCache.has(key)) return poolCache.get(key);

  const seen = new Set();
  const out = [];
  const push = (w) => {
    const k = w.front.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(w);
  };

  parseBuiltin().forEach((w) => push(Object.assign({ lvl: 'core' }, w)));

  if (key === 'cet6') {
    const c4 = loadLevel('cet4');
    const c6 = loadLevel('cet6');
    const has4 = new Set(c4.map((w) => w.front.toLowerCase()));
    const six = splitByTier(c6.filter((w) => !has4.has(w.front.toLowerCase())));
    const four = splitByTier(c4);

    six.main.forEach(push);
    four.main.forEach(push);
    six.basic.concat(four.basic).sort(byFreq).forEach(push);
    six.unknown.concat(four.unknown).forEach(push);
  } else {
    const four = splitByTier(loadLevel('cet4'));
    four.main.forEach(push);
    four.basic.forEach(push);
    four.unknown.forEach(push);
  }

  poolCache.set(key, out);
  return out;
}

/* 给界面用的词池规模。
 * 注意 only6 是按"池子里实际有多少个六级新增词"数的，不是按六级表直接减 ——
 * 核心 100 里有极少数词本身就在六级表里，那部分已经被核心占位，
 * 按表直接减会多算一个，界面上写"六级新增 2118"而实际只剩 2117，对不上账。 */
function poolStats(level) {
  const key = normLevel(level);
  const pool = wordPool(key);
  return {
    level: key,
    levelName: LEVEL_INFO[key].name,
    total: pool.length,
    cet4: pool.filter((w) => w.lvl === 'cet4').length,
    cet6: loadLevel('cet6').length,
    only6: pool.filter((w) => w.lvl === 'cet6').length,
    core: pool.filter((w) => w.lvl === 'core').length
  };
}

module.exports = {
  BUILTIN_RAW, TASK_LIB, STAGES, LEVEL_INFO, parseBuiltin,
  loadCet4, loadCet6, loadLevel, wordPool, poolStats, normLevel
};
```

#### `src/tts.js` — 284 行

Piper 离线语音：批量合成（带 30s 超时）、缓存、预热队列、语速

```js
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
```

### 渲染层

#### `renderer/index.html` — 319 行

四个视图的骨架 + 弹窗根节点。列表内容由 JS 运行时填充

```html
<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'">
<link rel="stylesheet" href="style.css">
<title>番茄四六级</title>
</head>
<body>

<header class="titlebar">
  <div class="brand">
    <span class="tomato"></span>
    <span class="bname">番茄四六级</span>
  </div>
  <nav class="tabs">
    <button class="tab on" data-view="today">今日</button>
    <button class="tab" data-view="review">复习<i class="dot" id="dueDot" hidden></i></button>
    <button class="tab" data-view="stats">记录</button>
    <button class="tab" data-view="settings">设置</button>
  </nav>
  <div class="winbtns">
    <button class="wb" id="btnMin" title="最小化">—</button>
    <button class="wb" id="btnMax" title="最大化">▢</button>
    <button class="wb close" id="btnClose" title="关闭">✕</button>
  </div>
</header>

<main class="body">

  <!-- ================= 今日 ================= -->
  <section class="view on" id="view-today">
    <div class="topline">
      <span class="chip stage" id="stageBadge">基础期</span>
      <span class="chip plain" id="streakText">连续 0 天</span>
      <span class="grow"></span>
      <span class="topright" id="todayStat"></span>
    </div>

    <div class="timer-card">
      <div class="tstage" id="timerStage">今天还没开始</div>
      <div class="ringwrap idle" id="ringWrap">
        <svg class="ring" viewBox="0 0 200 200">
          <circle class="rbg" cx="100" cy="100" r="88"></circle>
          <circle class="rfg" id="ringFg" cx="100" cy="100" r="88"></circle>
        </svg>
        <div class="rcenter">
          <div class="tnum" id="timerNum">25:00</div>
          <div class="tsub" id="timerSub">从下面挑一件事开始</div>
        </div>
      </div>
      <div class="tactions" id="timerActions"></div>
      <div class="thint" id="timerHint"></div>
    </div>

    <div class="blockhead">
      <h2>今日安排</h2>
      <span class="sub" id="planSummary"></span>
      <span class="grow"></span>
      <button class="linkbtn" id="btnRebuild" title="按当前阶段重新生成">重新排</button>
      <button class="linkbtn" id="btnAddTask">＋ 自定义任务</button>
    </div>
    <div id="dueBar"></div>
    <div class="planlist" id="planList"></div>

    <div class="blockhead"><h2>今天的账</h2></div>
    <div class="grid4" id="todayGrid"></div>

  </section>

  <!-- ================= 复习 ================= -->
  <section class="view" id="view-review">
    <div id="reviewBody"></div>
  </section>

  <!-- ================= 记录 ================= -->
  <section class="view" id="view-stats">
    <div class="blockhead first"><h2>累计</h2></div>
    <div class="grid4" id="totalGrid"></div>

    <div class="blockhead"><h2>近 7 天专注</h2><span class="grow"></span><span class="sub" id="weekSum"></span></div>
    <div class="card"><div class="bars" id="weekBars"></div></div>

    <div class="blockhead"><h2>时间花在哪</h2></div>
    <div class="card"><div class="catrows" id="catRows"></div></div>

    <div class="blockhead"><h2>遗忘曲线</h2><span class="sub">卡片调度就按这条线走</span></div>
    <div class="card" id="curveCard"></div>

    <div class="blockhead"><h2>最近记录</h2></div>
    <div class="loglist" id="logList"></div>
  </section>

  <!-- ================= 设置 ================= -->
  <section class="view" id="view-settings">
    <div class="set-wrap">

      <nav class="set-nav" id="setNav" aria-label="设置分组">
        <button class="set-link on" data-sec="secPrep">备考</button>
        <button class="set-link" data-sec="secPace">节奏</button>
        <button class="set-link" data-sec="secBell">铃声</button>
        <button class="set-link" data-sec="secBellStyle">铃声样式</button>
        <button class="set-link" data-sec="secWindow">窗口</button>
        <button class="set-link" data-sec="secVoice">单词发音</button>
        <button class="set-link" data-sec="secData">导入与数据</button>
      </nav>

      <div class="set-main">

        <div class="set-sec" id="secPrep">
          <div class="blockhead first"><h2>备考</h2><span class="sub">决定新词从哪个池子里发</span></div>
          <div class="card">
            <div class="srow">
              <div class="sinfo"><div class="st">考哪一级</div><div class="sd" id="levelNote">四级词池</div></div>
              <div class="seg" id="segLevel">
                <button data-v="cet4">四级</button>
                <button data-v="cet6">六级</button>
              </div>
            </div>
            <div class="srow">
              <div class="sinfo"><div class="st">考试日期</div><div class="sd">用来倒推每天该发多少新词，可以空着</div></div>
              <div class="sctrl"><input type="date" id="setExam"></div>
            </div>
            <div class="srow" id="rowPace" hidden>
              <div class="sinfo"><div class="st">照这个速度</div><div class="sd" id="paceText">—</div></div>
              <div class="sctrl"><button class="btn sm" id="btnPaceFix">按考试配速</button></div>
            </div>
          </div>
        </div>

        <div class="set-sec" id="secPace">
          <div class="blockhead"><h2>节奏</h2><span class="sub">改完立刻生效</span></div>
          <div class="card">
            <div class="srow">
              <div class="sinfo"><div class="st">每日目标</div><div class="sd">只用来生成建议安排，不是硬指标</div></div>
              <div class="sctrl"><input type="number" id="setDaily" min="20" max="360" step="10"><span class="unit">分钟</span></div>
            </div>
            <div class="srow">
              <div class="sinfo"><div class="st">标准番茄长度</div><div class="sd">只影响自定义任务，各题型本身有固定时长</div></div>
              <div class="sctrl"><input type="number" id="setPomo" min="10" max="60" step="5"><span class="unit">分钟</span></div>
            </div>
            <div class="srow">
              <div class="sinfo"><div class="st">休息时长</div><div class="sd">一段专注结束后自动进入</div></div>
              <div class="sctrl"><input type="number" id="setBreak" min="1" max="30" step="1"><span class="unit">分钟</span></div>
            </div>
            <div class="srow">
              <div class="sinfo"><div class="st">阶段</div><div class="sd">默认按积累量自动推进，也可以锁定</div></div>
              <div class="sctrl">
                <select id="setStage">
                  <option value="auto">跟随进度</option>
                  <option value="base">基础期</option>
                  <option value="build">积累期</option>
                  <option value="boost">强化期</option>
                  <option value="mock">模拟期</option>
                </select>
              </div>
            </div>
            <div class="srow">
              <div class="sinfo"><div class="st">每天新词</div><div class="sd" id="dailyNewHint">按词频从高到低发，先学最该学的</div></div>
              <div class="sctrl"><input type="number" id="setDailyNew" min="5" max="50" step="5"><span class="unit">个</span></div>
            </div>
            <label class="srow click">
              <div class="sinfo"><div class="st">铃响后自动休息</div><div class="sd">关掉就手动开始休息</div></div>
              <input type="checkbox" id="setAutoBreak" class="sw">
            </label>
          </div>
        </div>

        <div class="set-sec" id="secBell">
          <div class="blockhead"><h2>铃声</h2><span class="sub">到点自己响，不靠系统通知</span></div>
          <div class="card">
            <label class="srow click">
              <div class="sinfo"><div class="st">到点响铃</div><div class="sd">专注结束、休息结束、久坐超时各响一次</div></div>
              <input type="checkbox" id="setSound" class="sw">
            </label>
            <div class="srow" id="rowVol">
              <div class="sinfo"><div class="st">音量</div><div class="sd">调到"隔壁房间听不见、自己听得见"</div></div>
              <div class="sctrl volwrap">
                <input type="range" id="setVol" min="0" max="100" step="5">
                <span class="unit volnum" id="volVal">70</span>
              </div>
            </div>
            <div class="srow" id="rowTimes">
              <div class="sinfo"><div class="st">连响几声</div><div class="sd">人不在电脑前时，多响几下才听得见</div></div>
              <div class="seg" id="segTimes">
                <button data-v="1">1 声</button>
                <button data-v="3">3 声</button>
                <button data-v="6">6 声</button>
              </div>
            </div>
          </div>
        </div>

        <div class="set-sec" id="secBellStyle">
          <div class="blockhead"><h2>铃声样式</h2><span class="sub">点一下就能听</span></div>
          <div class="card pad">
            <div class="bellgrid" id="bellGrid"></div>
            <div class="btnrow bellrow">
              <button class="btn sm" id="bellTest">试听这个</button>
              <button class="btn sm" id="bellUpload">＋ 上传自己的</button>
              <span class="bellnote" id="bellNote"></span>
            </div>
          </div>
        </div>

        <div class="set-sec" id="secWindow">
          <div class="blockhead"><h2>窗口</h2></div>
          <div class="card">
            <label class="srow click">
              <div class="sinfo"><div class="st">窗口置顶</div><div class="sd">压在所有窗口上面，适合边看资料边计时</div></div>
              <input type="checkbox" id="setOnTop" class="sw">
            </label>
            <label class="srow click">
              <div class="sinfo"><div class="st">关闭时收进托盘</div><div class="sd">倒计时继续走，点托盘图标随时叫回来</div></div>
              <input type="checkbox" id="setTray" class="sw">
            </label>
            <label class="srow click">
              <div class="sinfo"><div class="st">系统通知</div><div class="sd">在屏幕角落弹一条提示。开了专注助手时可能被拦掉</div></div>
              <input type="checkbox" id="setNotify" class="sw">
            </label>
            <div class="srow">
              <div class="sinfo"><div class="st">主题</div><div class="sd">深色适合晚上，浅色适合白天</div></div>
              <div class="seg" id="segTheme">
                <button data-v="dark">深色</button>
                <button data-v="light">浅色</button>
              </div>
            </div>
            <div class="srow">
              <div class="sinfo">
                <div class="st">界面材质</div>
                <div class="sd" id="matNote">亚克力和云母会让窗口透出桌面背景，Win11 22H2 以上才支持</div>
              </div>
              <div class="seg" id="segMat">
                <button data-v="solid">纯色</button>
                <button data-v="acrylic">亚克力</button>
                <button data-v="mica">云母</button>
              </div>
            </div>
          </div>
        </div>

        <div class="set-sec" id="secVoice">
          <div class="blockhead"><h2>单词发音</h2><span class="sub">复习卡片上的「朗读」按钮</span></div>
          <div class="card">
            <div class="srow">
              <div class="sinfo">
                <div class="st" id="voiceState">正在检查发音引擎…</div>
                <div class="sd" id="voiceHint">词表本身没有音标，靠内置离线语音把词读出来</div>
              </div>
              <div class="sctrl">
                <button class="btn sm" id="btnVoiceTest">试听</button>
                <button class="btn sm" id="btnVoiceSet" hidden>去装语音</button>
              </div>
            </div>
            <div class="srow">
              <div class="sinfo"><div class="st">语速</div><div class="sd">慢一点才听得清尾音（-ed / -s）</div></div>
              <div class="sctrl">
                <div class="seg" id="segVoicePace">
                  <button data-v="slow">慢</button>
                  <button data-v="normal">正常</button>
                  <button data-v="fast">快</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="set-sec" id="secData">
          <div class="blockhead"><h2>导入与数据</h2><span class="sub">每行一张卡片，竖线分隔 · 数据存在本机不上传</span></div>
          <div class="card pad">
            <div class="poolbar" id="poolBar"></div>
            <textarea id="importArea" placeholder="abandon | v. 放弃，抛弃&#10;adapt | v. 适应；改编 | It takes time to adapt."></textarea>
            <div class="btnrow">
              <button class="btn primary" id="btnImport">导入</button>
              <button class="btn" id="btnSeed">再发 20 个新词</button>
            </div>
          </div>
          <div class="card">
            <div class="srow">
              <div class="sinfo"><div class="st">备份与恢复</div><div class="sd" id="dataPath"></div></div>
              <div class="sctrl">
                <button class="btn sm" id="btnExport">导出</button>
                <button class="btn sm" id="btnImportData">恢复</button>
                <button class="btn sm" id="btnReveal">打开目录</button>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="srow">
              <div class="sinfo">
                <div class="st">重新开始</div>
                <div class="sd">清空番茄记录、卡片进度和今日安排，像刚装上一样。清空前自动备份，后悔了能恢复。</div>
              </div>
              <div class="sctrl">
                <button class="btn sm danger" id="btnReset">清空学习记录</button>
                <button class="btn sm quiet" id="btnResetAll">连设置一起</button>
              </div>
            </div>
          </div>
        </div>

      </div><!-- /set-main -->
    </div><!-- /set-wrap -->

    <div class="footnote">
      番茄四六级 0.1.0 · 本地运行，不联网<br>
      卸载程序不会删除数据，config.json 会留在用户目录里
    </div>
  </section>

</main>

<div id="modalRoot"></div>
<div id="toast"></div>

<script src="bell.js"></script>
<script src="app.js"></script>
</body>
</html>
```

#### `renderer/style.css` — 649 行

全部样式：暗/亮双主题、780 单列、设置页左导航

```css
:root {
  --bg: #0f1115;
  --panel: #161a21;
  --panel2: #1b202a;
  --line: #262c37;
  --line2: #333a47;
  --text: #e8eaf0;
  --dim: #97a0af;
  --faint: #626b79;
  --tomato: #e0543f;
  --tomato-dim: #7a2e22;
  --leaf: #35a884;
  --blue: #5b8def;
  --amber: #d99a3c;
  --radius: 14px;
  --radius-sm: 9px;
  /* 内容列宽度：固定 780，不随窗口变（为什么不再变宽，见文件末尾） */
  --cw: 780px;
  /* 页面左右留白。设置页的吸顶导航要用负 margin 撑满这段留白，所以抽成变量 */
  --padx: 26px;
}
[data-theme="light"] {
  --bg: #f6f6f3;
  --panel: #ffffff;
  --panel2: #fbfbf8;
  --line: #e5e4df;
  --line2: #d5d4ce;
  --text: #1a1c20;
  --dim: #5d636e;
  --faint: #8b919b;
  --tomato: #c8453a;
  --tomato-dim: #f3d3ce;
  --leaf: #1f8a76;
  --blue: #3d6fd4;
  --amber: #a8721a;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 13.5px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  user-select: none;
}

/* 例句和会话记录要能选中复制：查例句里的生词、把句子抄到别处。
 * 这两块之外保持不可选，免得拖窗口时选出一片高亮。 */
.fcback, .fcex, .loglist, .loglist * { user-select: text; }

button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }
input, textarea, select { font: inherit; }
::selection { background: rgba(224, 84, 63, .25); }

/* ---------- 滚动条 ---------- */
.body::-webkit-scrollbar { width: 10px; }
.body::-webkit-scrollbar-track { background: transparent; }
.body::-webkit-scrollbar-thumb { background: var(--line2); border-radius: 6px; border: 3px solid var(--bg); }
.body::-webkit-scrollbar-thumb:hover { background: var(--faint); }

/* ---------- 标题栏 ---------- */
.titlebar {
  height: 48px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 0 0 0 16px;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
  -webkit-app-region: drag;
  position: relative;
  z-index: 20;
}
.brand { display: flex; align-items: center; gap: 8px; flex: none; }
.tomato {
  width: 13px; height: 13px; border-radius: 50%;
  background: var(--tomato);
  box-shadow: inset -2px -2px 0 rgba(0,0,0,.18), 0 0 0 1px rgba(224,84,63,.25);
  position: relative;
}
.tomato::after {
  content: ""; position: absolute; top: -4px; left: 4px;
  width: 5px; height: 5px; border-radius: 1px 3px 1px 3px;
  background: var(--leaf);
  transform: rotate(-18deg);
}
.bname { font-size: 13px; font-weight: 500; letter-spacing: .01em; }

.tabs { display: flex; gap: 2px; -webkit-app-region: no-drag; }
.tab {
  padding: 5px 13px; border-radius: 7px; font-size: 12.5px; color: var(--dim);
  transition: .15s; position: relative;
}
.tab:hover { color: var(--text); background: var(--panel); }
.tab.on { color: var(--text); background: var(--panel2); font-weight: 500; }
.dot {
  position: absolute; top: 4px; right: 5px;
  width: 5px; height: 5px; border-radius: 50%; background: var(--tomato);
}

.winbtns { margin-left: auto; display: flex; height: 100%; -webkit-app-region: no-drag; }
.wb {
  width: 46px; height: 100%; color: var(--dim); font-size: 13px;
  display: flex; align-items: center; justify-content: center;
  transition: .12s;
}
.wb:hover { background: var(--panel2); color: var(--text); }
.wb.close:hover { background: #c0392b; color: #fff; }

/* ---------- 布局 ---------- */
.body { height: calc(100% - 48px); overflow-y: auto; overflow-x: hidden; }
/* 固定 780 的居中列，不跟着窗口变宽。
 * 拉宽解决不了"两侧空"：列表行里左右两端会跟着失去联系，数字见文件末尾。 */
.view { display: none; padding: 20px var(--padx) 40px; max-width: var(--cw); margin: 0 auto; }
.view.on { display: block; animation: fade .2s ease; }
@keyframes fade { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }

.grow { flex: 1; }
.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
}
.card.pad { padding: 14px 16px; }

.blockhead { display: flex; align-items: baseline; gap: 9px; margin: 24px 0 10px; }
.blockhead.first { margin-top: 0; }
.blockhead h2 { font-size: 13px; font-weight: 500; letter-spacing: .01em; }
.blockhead .sub { font-size: 11.5px; color: var(--faint); }
.linkbtn {
  font-size: 11.5px; color: var(--dim); padding: 3px 7px; border-radius: 6px; transition: .15s;
}
.linkbtn:hover { color: var(--text); background: var(--panel); }

/* ---------- 顶部信息条 ---------- */
.topline { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.chip {
  font-size: 11.5px; padding: 3px 9px; border-radius: 20px;
  border: 1px solid var(--line); color: var(--dim); white-space: nowrap;
}
.chip.stage { color: var(--amber); border-color: rgba(217,154,60,.3); background: rgba(217,154,60,.08); }
.topright { font-size: 11.5px; color: var(--faint); }

/* ---------- 计时器 ---------- */
.timer-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 18px 20px 14px;
  text-align: center;
}
.tstage { font-size: 11.5px; color: var(--faint); letter-spacing: .05em; min-height: 16px; margin-bottom: 6px; }
.ringwrap { position: relative; width: 196px; height: 196px; margin: 0 auto; }
.ring { width: 196px; height: 196px; transform: rotate(-90deg); }
.rbg { fill: none; stroke: var(--line); stroke-width: 5; }
.rfg {
  fill: none; stroke: var(--tomato); stroke-width: 5; stroke-linecap: round;
  stroke-dasharray: 552.92; stroke-dashoffset: 0;
  transition: stroke-dashoffset .35s linear, stroke .25s;
  filter: drop-shadow(0 0 6px rgba(224, 84, 63, .28));
}
.ringwrap.idle .rfg { stroke: var(--line2); filter: none; }
.ringwrap.isbreak .rfg { stroke: var(--leaf); filter: drop-shadow(0 0 6px rgba(53, 168, 132, .28)); }
.rcenter { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; }
.tnum {
  font-size: 38px; font-weight: 300; line-height: 1;
  font-variant-numeric: tabular-nums; letter-spacing: -.01em;
}
.tsub { font-size: 11.5px; color: var(--dim); max-width: 150px; line-height: 1.45; }
.tactions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 0; min-height: 0; }
/* 空闲时没有按钮，别留一块空白把卡片撑高 */
.tactions:has(> button) { margin-top: 14px; min-height: 32px; }
.thint { font-size: 11.5px; color: var(--faint); margin-top: 8px; min-height: 16px; line-height: 1.5; }

/* ---------- 按钮 ---------- */
.btn {
  padding: 7px 16px; border-radius: var(--radius-sm); font-size: 12.5px;
  border: 1px solid var(--line); color: var(--dim); transition: .15s; white-space: nowrap;
}
.btn:hover { border-color: var(--line2); color: var(--text); background: var(--panel2); }
.btn:active { transform: scale(.985); }
.btn.primary { background: var(--tomato); border-color: var(--tomato); color: #fff; font-weight: 500; }
.btn.primary:hover { filter: brightness(1.08); }
.btn.blue { background: var(--blue); border-color: var(--blue); color: #fff; }
.btn.sm { padding: 5px 11px; font-size: 11.5px; }
.btn.quiet { border-color: transparent; }
.btn.quiet:hover { color: var(--tomato); background: transparent; }
/* 危险操作：只在边框和字色上做提示，不做成实心红块 ——
 * 实心红太抢眼，会吸引人去点它 */
.btn.danger { border-color: rgba(239, 106, 88, .42); color: var(--tomato); }
.btn.danger:hover { border-color: var(--tomato); background: rgba(239, 106, 88, .1); color: var(--tomato); }
.btnrow { display: flex; gap: 8px; margin-top: 10px; }

/* ---------- 今日安排 ---------- */
.planlist { display: flex; flex-direction: column; gap: 7px; }
.pitem {
  display: flex; align-items: center; gap: 11px;
  background: var(--panel); border: 1px solid var(--line);
  border-radius: 11px; padding: 10px 12px; transition: .15s;
}
.pitem:hover { border-color: var(--line2); background: var(--panel2); }
.pitem.done { opacity: .48; }
.pitem.done .pname { text-decoration: line-through; }
.pitem.playing { border-color: var(--tomato); background: rgba(224,84,63,.06); }
.pcheck {
  width: 18px; height: 18px; flex: none; border-radius: 5px;
  border: 1.5px solid var(--line2); display: flex; align-items: center; justify-content: center;
  font-size: 11px; color: transparent; transition: .15s;
}
.pcheck:hover { border-color: var(--leaf); }
.pitem.done .pcheck { background: var(--leaf); border-color: var(--leaf); color: #fff; }
.pmain { flex: 1; min-width: 0; }
.pname { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pdesc { font-size: 11.5px; color: var(--faint); margin-top: -1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pmeta { display: flex; align-items: center; gap: 8px; flex: none; }
.cattag { font-size: 10.5px; padding: 1px 6px; border-radius: 4px; background: var(--panel2); color: var(--dim); border: 1px solid var(--line); }
.pdur { font-size: 11.5px; color: var(--faint); font-variant-numeric: tabular-nums; min-width: 34px; text-align: right; }
.pplay {
  width: 27px; height: 27px; border-radius: 7px; border: 1px solid var(--line);
  color: var(--dim); display: flex; align-items: center; justify-content: center;
  font-size: 10px; transition: .15s; flex: none;
}
.pplay:hover { border-color: var(--tomato); color: var(--tomato); background: rgba(224,84,63,.08); }
.pdel { color: var(--faint); font-size: 14px; padding: 0 3px; opacity: 0; transition: .15s; }
.pitem:hover .pdel { opacity: 1; }
.pdel:hover { color: var(--tomato); }

/* ---------- 到期提示条 ---------- */
.duebar {
  display: flex; align-items: center; gap: 10px;
  background: rgba(91,141,239,.08); border: 1px solid rgba(91,141,239,.25);
  border-radius: 11px; padding: 10px 13px; margin-bottom: 8px;
}
.duebar .txt { flex: 1; font-size: 12.5px; }
.duebar .txt b { font-weight: 500; color: var(--blue); }
.duebar .txt span { color: var(--faint); font-size: 11.5px; margin-left: 6px; }

/* ---------- 四格统计 ---------- */
.grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 9px; }
.sbox { background: var(--panel); border: 1px solid var(--line); border-radius: 11px; padding: 12px 13px; }
.slabel { font-size: 11px; color: var(--faint); margin-bottom: 4px; }
.snum { font-size: 21px; font-weight: 400; font-variant-numeric: tabular-nums; line-height: 1.15; }
.sunit { font-size: 10.5px; color: var(--faint); margin-left: 2px; font-weight: 400; }

/* ---------- 复习 ---------- */
.fcwrap { max-width: 500px; margin: 0 auto; }

/* 复习页内容不多，让它垂直居中，否则卡片贴顶、下面空一大片 */
#view-review.on {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 100%;
  padding-top: 0;
  padding-bottom: 20px;
}
.fcprog { text-align: center; font-size: 11.5px; color: var(--faint); margin-bottom: 12px; font-variant-numeric: tabular-nums; }
.flashcard {
  background: var(--panel); border: 1px solid var(--line);
  border-radius: 16px; min-height: 220px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 30px 26px; cursor: pointer; transition: .18s; text-align: center;
}
.flashcard:hover { border-color: var(--line2); }
.flashcard.revealed { border-color: var(--line2); }
.fcfront { font-size: 30px; font-weight: 400; letter-spacing: .005em; word-break: break-word; }
.fcback { margin-top: 12px; font-size: 13.5px; color: var(--dim); line-height: 1.65; max-width: 380px; }
.fcex { font-size: 12px; color: var(--faint); margin-top: 8px; font-style: italic; }
.fctip { font-size: 11px; color: var(--faint); margin-top: 16px; }
.fcactions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin-top: 11px; }
.fcactions[hidden] { display: none; }
.rate {
  border: 1px solid var(--line); border-radius: 10px; padding: 9px 4px;
  font-size: 12px; color: var(--dim); transition: .15s; background: var(--panel);
}
.rate small { display: block; font-size: 10px; color: var(--faint); margin-top: 1px; }
.rate:hover { border-color: var(--line2); color: var(--text); background: var(--panel2); }
.rate.again:hover { border-color: var(--tomato); color: var(--tomato); }
.rate.good:hover { border-color: var(--leaf); color: var(--leaf); }

.empty { text-align: center; padding: 64px 20px; }
.empty .et { font-size: 14px; font-weight: 500; margin-bottom: 7px; }
.empty .es { font-size: 12.5px; color: var(--faint); line-height: 1.8; }

/* ---------- 柱状图 ---------- */
.bars { display: flex; align-items: flex-end; gap: 7px; height: 132px; padding: 14px 16px 10px; }
.barcol { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end; }
.barval { font-size: 10px; color: var(--faint); font-variant-numeric: tabular-nums; }
.bar {
  width: 100%; max-width: 36px; border-radius: 4px 4px 2px 2px;
  background: var(--tomato); opacity: .55; min-height: 2px; transition: height .35s;
}
.bar.on { opacity: 1; }
.barlabel { font-size: 10px; color: var(--faint); }

/* ---------- 分类条 ---------- */
.catrows { padding: 14px 16px; display: flex; flex-direction: column; gap: 9px; }
.catrow { display: flex; align-items: center; gap: 9px; font-size: 12px; }
.catrow .n { width: 32px; color: var(--dim); flex: none; }
.catrow .track { flex: 1; height: 5px; background: var(--line); border-radius: 3px; overflow: hidden; }
.catrow .fill { height: 100%; background: var(--blue); border-radius: 3px; transition: width .4s; }
.catrow .v { width: 58px; text-align: right; color: var(--faint); font-variant-numeric: tabular-nums; flex: none; }

/* ---------- 记录列表 ---------- */
.loglist { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
.logrow { display: flex; align-items: center; gap: 10px; padding: 8px 14px; font-size: 12px; border-bottom: 1px solid var(--line); }
.logrow:last-child { border-bottom: none; }
.logrow .t { color: var(--faint); font-variant-numeric: tabular-nums; width: 40px; flex: none; }
.logrow .n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.logrow .m { color: var(--faint); font-variant-numeric: tabular-nums; flex: none; }
.tag { font-size: 10.5px; padding: 1px 6px; border-radius: 4px; flex: none; }
.tag.ok { background: rgba(53,168,132,.15); color: var(--leaf); }
.tag.bad { background: rgba(224,84,63,.15); color: var(--tomato); }

/* ---------- 设置 ---------- */
.srow { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 15px; border-bottom: 1px solid var(--line); }
.srow:last-child { border-bottom: none; }
.srow.click { cursor: pointer; }
.srow.click:hover { background: var(--panel2); }
.sinfo .st { font-size: 12.5px; }
.sinfo .sd { font-size: 11.5px; color: var(--faint); margin-top: 1px; line-height: 1.45; }
.sctrl { display: flex; align-items: center; gap: 6px; flex: none; }
.unit { font-size: 11.5px; color: var(--faint); }

input[type="number"], input[type="text"], textarea, select {
  background: var(--bg); border: 1px solid var(--line); color: var(--text);
  border-radius: 7px; padding: 5px 8px; font-size: 12.5px; outline: none; transition: .15s;
}
input[type="number"] { width: 62px; text-align: center; font-variant-numeric: tabular-nums; }
input[type="date"] {
  background: var(--bg); border: 1px solid var(--line); color: var(--text);
  border-radius: 7px; padding: 4px 8px; font-size: 12.5px; outline: none;
  font-family: inherit; font-variant-numeric: tabular-nums;
}
input[type="date"]:focus { border-color: var(--blue); }
/* 日历图标默认是深色的，深色底上几乎看不见，反一下 */
[data-theme="dark"] input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(.72); }
/* hidden 要压过 .btn 自己的显示方式 */
#btnVoiceSet[hidden], #btnPaceFix[hidden], #rowPace[hidden] { display: none; }
input:focus, textarea:focus, select:focus { border-color: var(--blue); }
textarea { width: 100%; min-height: 96px; resize: vertical; line-height: 1.6; padding: 9px 10px; }
select { padding-right: 6px; }

.sw { width: 34px; height: 19px; appearance: none; background: var(--line2); border-radius: 10px; position: relative; cursor: pointer; transition: .18s; flex: none; }
.sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: 15px; height: 15px; border-radius: 50%; background: #fff; transition: .18s; }
.sw:checked { background: var(--leaf); }
.sw:checked::after { transform: translateX(15px); }

.seg { display: flex; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 2px; gap: 2px; }
.seg button { padding: 4px 12px; border-radius: 6px; font-size: 11.5px; color: var(--dim); transition: .15s; }
.seg button.on { background: var(--panel2); color: var(--text); }

.footnote { text-align: center; font-size: 11px; color: var(--faint); margin-top: 30px; line-height: 1.9; }

/* ---------- 设置：左导航 + 单列 ----------
 * 原来是左右两栏，实测左 1135 / 右 840，差 295px，右栏下面吊着一大块空白；
 * 而且每加一个设置项都要重新盘算怎么分栏。改成锚点导航 + 单列之后，
 * 高度差这个问题直接不存在了，加东西也只是往下长。 */
.set-wrap {
  display: flex;
  gap: 28px;
  align-items: flex-start;
  max-width: 1040px;  /* 160 导航 + 28 间距 + 852 内容 */
  margin: 0 auto;
}
.set-nav {
  width: 160px;
  flex: none;
  position: sticky;   /* .body 是滚动容器，吸的是它的顶 */
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 2px;
}
.set-link {
  text-align: left;
  font-size: 12.5px;
  color: var(--dim);
  padding: 6px 10px;
  border-radius: 8px;
  white-space: nowrap;
  transition: .15s;
}
.set-link:hover { color: var(--text); background: var(--panel); }
.set-link.on { color: var(--text); background: var(--panel2); font-weight: 500; }

/* 内容吃满剩余宽度，不写死：1040 的容器里是 852，1000~1319 的窄屏容器里
 * 自动缩回 640，两边都不用再单独调 */
.set-main { flex: 1; min-width: 0; }
.set-sec { scroll-margin-top: 12px; }
/* 「导入与数据」里两张卡上下相邻，默认会贴成一条线 */
.set-sec .card + .card { margin-top: 9px; }

@media (max-width: 999px) {
  /* align-items 必须从 flex-start 改成 stretch：竖排时 flex-start 会让导航和
   * 内容都缩到内容宽度（实测 900 宽窗口里只有 494），卡片挤成一条、右边空一大片，
   * 导航也撑不满、挡不住从底下滚过去的东西 */
  .set-wrap { flex-direction: column; gap: 0; max-width: none; align-items: stretch; }

  /* 导航改成顶部横向吸顶。
   * 负 margin 是为了撑到 .view 的边框盒——只贴着内容区的话，左右两条
   * padding 会露出从底下滚过的卡片，看着像导航被人从中间剪了一刀。
   * 顶部要让出多少留给 JS 算（单行/两行高度不一样，写死会有一边不对）。 */
  .set-nav {
    width: auto;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 4px;
    margin: 0 calc(-1 * var(--padx));
    padding: 8px var(--padx);
    background: var(--bg);
    /* 用阴影代替 border：不占高度，navOffset 量出来的值不用再补 1px */
    box-shadow: 0 1px 0 var(--line);
    z-index: 5;
  }
  .set-link { padding: 4px 10px; }
  /* .set-main 不用再写：宽屏已经是 flex:1，竖排时自然也吃满 */
}

/* ---------- 弹窗 ---------- */
#modalRoot:empty { display: none; }
.overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.5);
  display: flex; align-items: center; justify-content: center; z-index: 60;
  animation: fade .15s;
}
.modal {
  background: var(--panel); border: 1px solid var(--line2);
  border-radius: 15px; width: min(420px, calc(100% - 48px));
  box-shadow: 0 24px 60px rgba(0,0,0,.45);
  animation: pop .18s ease;
}
@keyframes pop { from { transform: scale(.97); opacity: 0; } to { transform: none; opacity: 1; } }
.mhead { padding: 16px 18px 0; font-size: 14px; font-weight: 500; }
.mbody { padding: 12px 18px 4px; font-size: 12.5px; color: var(--dim); line-height: 1.7; }
.mbody b { color: var(--text); font-weight: 500; }
.mbody p { margin-bottom: 8px; }
.mbody input[type="text"] { width: 100%; margin-top: 4px; }
.mfoot { display: flex; justify-content: flex-end; gap: 7px; padding: 14px 18px 16px; }
.chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.chips button { padding: 4px 10px; border-radius: 6px; border: 1px solid var(--line); font-size: 11.5px; color: var(--dim); transition: .15s; }
.chips button:hover { border-color: var(--line2); color: var(--text); }
.chips button.on { background: rgba(91,141,239,.14); border-color: var(--blue); color: var(--blue); }

/* ---------- Toast ---------- */
#toast {
  /* 原来贴在窗口底部，而首屏内容刚好撑满一屏，6 秒里一直压着「今天的账」。
     改到标题栏下方滑入：那里信息密度最低，也不挡正在操作的地方 */
  position: fixed; left: 50%; top: 56px; transform: translate(-50%, -12px);
  background: var(--panel2); border: 1px solid var(--line2);
  padding: 9px 16px; border-radius: 9px; font-size: 12.5px;
  opacity: 0; pointer-events: none; transition: .22s; z-index: 90;
  box-shadow: 0 10px 30px rgba(0,0,0,.35); max-width: 70vw; text-align: center;
}
#toast.on { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }
#toast .undo {
  margin-left: 10px; padding: 2px 9px; border-radius: 6px;
  border: 1px solid var(--line2); background: transparent;
  color: var(--tomato); font-size: 12px; font-weight: 500; cursor: pointer;
  transition: .15s;
}
#toast .undo:hover { background: var(--panel); border-color: var(--tomato); }

/* 音量滑块：自绘轨道，跟随主题色 */
input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  width: 126px;
  height: 18px;
  background: transparent;
  cursor: pointer;
  outline: none;
}
input[type="range"]::-webkit-slider-runnable-track {
  height: 3px;
  border-radius: 2px;
  background: var(--line2);
}
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 13px;
  height: 13px;
  margin-top: -5px;
  border-radius: 50%;
  border: none;
  background: var(--tomato);
  transition: transform .12s;
}
input[type="range"]:hover::-webkit-slider-thumb { transform: scale(1.12); }
.volwrap { gap: 9px; }
.volnum {
  min-width: 24px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--dim);
}

/* 铃声选择：一格格点着选 */
.bellgrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(146px, 1fr));
  gap: 8px;
}
.bellitem {
  position: relative;
  text-align: left;
  font: inherit;
  color: var(--text);
  background: var(--panel2);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 10px;
  cursor: pointer;
  transition: .15s;
}
.bellitem:hover { border-color: var(--line2); }
.bellitem.on {
  border-color: var(--tomato);
  background: var(--tomato-dim);
}
.bellitem .bn { font-size: 12.5px; display: block; }
.bellitem .bd { font-size: 10.5px; color: var(--faint); margin-top: 2px; line-height: 1.45; display: block; }
.bellitem.on .bd { color: var(--text); opacity: .68; }
.bellitem .bx {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 17px;
  height: 17px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--faint);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: .15s;
}
.bellitem:hover .bx { opacity: 1; }
.bellitem .bx:hover { background: var(--panel); color: var(--tomato); }
.bellrow { align-items: center; margin-top: 13px; }
.bellnote { font-size: 11px; color: var(--faint); margin-left: 2px; }
.bellempty { font-size: 11.5px; color: var(--faint); padding: 6px 2px; }
.srow.muted { opacity: .45; }

/* 词库用量：放在导入框上方，一眼看到还剩多少没学 */
.poolbar {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 11.5px;
  color: var(--faint);
  padding: 2px 2px 10px;
}
.poolbar b { color: var(--text); font-weight: 500; font-variant-numeric: tabular-nums; }

/* 朗读按钮：挂在进度行右侧，不占卡片版面 */
.spk {
  margin-left: 9px;
  padding: 1px 8px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--faint);
  font-size: 10.5px;
  font-family: inherit;
  cursor: pointer;
  vertical-align: 1px;
  transition: .15s;
}
.spk:hover { color: var(--text); border-color: var(--tomato); }

@media (max-width: 820px) {
  :root { --padx: 16px; }
  .view { padding: 16px var(--padx) 32px; }
  .grid4 { grid-template-columns: repeat(2, 1fr); }
}

/* 复习页曾经有一条"本轮队列"侧栏，只有两栏布局时才出现。
 * 两栏方案撤掉之后它就是死的：DOM 删了、渲染函数也删了，这段样式一起清掉。 */

/* ---------- 内容列：单列 780，不随窗口变 ----------
 * 今日 / 复习 / 记录 三页都是同一条 780 的居中列，窗口多大都一样。
 * 中间试过按宽度分三档（1000+ 用 880、1320+ 换两栏 1140），两条路都撞墙：
 * 拉到 1140 两栏之后，计划行里「词汇」到右边「12 分钟」之间空出 900px，
 * 行内两端失去联系；再铺满整个窗口，记录页的柱状图直接摊成一片。
 * 780 的行内距离是舒服的，代价是两侧留白 —— 这个取舍认了，不再按宽度变形。
 *
 * 设置页是唯一例外：左导航 160 + 内容 852 = 1040，加上两侧各 26 留白。
 */
#view-settings { max-width: 1092px; }

/* ---------- 界面材质：亚克力 / 云母 ----------
 * 毛玻璃不在这里画，是主进程 win.setBackgroundMaterial 交给 DWM 的，画在窗口
 * 表面**后面**。所以这里只做两件事：
 *   1. 把挡在前面的实色一层层让开（html → body → 面板），否则材质永远透不出来；
 *   2. 给文字补一点投影，因为透出来的是用户的壁纸，可能是浅色花纹。
 * 「html 那层也得透明」这个坑是照 ZeroDesk 源码抄的：只透明 body 没用，
 * 表现就是选了亚克力、窗口却还是死黑一块。
 *
 * 不全透：留一层压暗（深色 .45 / 浅色 .5），保证亮壁纸下文字照样读得清。
 */
html:has(body.mat) { background: transparent !important; }

body.mat {
  --bg: rgba(13, 15, 19, .45);
  --panel: rgba(26, 31, 40, .6);
  --panel2: rgba(33, 39, 51, .74);
  --line: rgba(255, 255, 255, .085);
  --line2: rgba(255, 255, 255, .16);
}
/* 标题栏在 body 之上再叠一层，同色叠两层会显得比正文黑一块 */
body.mat .titlebar { background: rgba(17, 20, 26, .35); }

[data-theme="light"] body.mat {
  --bg: rgba(246, 246, 243, .5);
  --panel: rgba(255, 255, 255, .64);
  --panel2: rgba(252, 252, 249, .8);
  --line: rgba(0, 0, 0, .085);
  --line2: rgba(0, 0, 0, .15);
}
[data-theme="light"] body.mat .titlebar { background: rgba(255, 255, 255, .4); }

/* 直接坐在底色上的字补投影；卡片里的字有自己的底，不用管 */
body.mat .bname,
body.mat .tab,
body.mat .blockhead h2,
body.mat .blockhead .sub,
body.mat .set-link,
body.mat .footnote { text-shadow: 0 1px 3px rgba(0, 0, 0, .55); }
[data-theme="light"] body.mat .bname,
[data-theme="light"] body.mat .tab,
[data-theme="light"] body.mat .blockhead h2,
[data-theme="light"] body.mat .blockhead .sub,
[data-theme="light"] body.mat .set-link,
[data-theme="light"] body.mat .footnote { text-shadow: 0 1px 2px rgba(255, 255, 255, .85); }

/* 窗口按钮是字符，投影够用；只有 SVG 图标需要 drop-shadow。
 * 滚动条滑块外面那圈 3px 边是拿 --bg 填的，材质下会画出一圈实色。 */
body.mat .wb svg { filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .5)); }
body.mat .body::-webkit-scrollbar-thumb { border-color: transparent; }
```

#### `renderer/app.js` — 1246 行

界面逻辑：视图切换、计时器渲染、复习流程（含键盘）、设置、设置页滚动导航

```js
// 渲染进程：只负责画和发指令，计时与存储都在主进程

let ST = null;          // 最近一次完整快照
let lastTimerKey = '';  // 状态变化时才重绘按钮
const R = { queue: [], idx: 0, revealed: false };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function fmt(sec) {
  sec = Math.max(0, Math.round(sec));
  return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
}

function fmtMin(m) {
  if (m < 60) return m + ' 分';
  const h = Math.floor(m / 60), r = m % 60;
  return r ? h + ' 小时 ' + r + ' 分' : h + ' 小时';
}

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.innerHTML = '';
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
}

/* 带撤销按钮的提示。删除这类操作不弹确认框打断流程，
 * 而是给 6 秒反悔窗口 —— 比"每删一项问一次"顺得多 */
function toastUndo(msg, onUndo) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span><button class="undo" id="undoBtn">撤销</button>`;
  t.classList.add('on');
  clearTimeout(toastTimer);

  const btn = $('#undoBtn');
  if (btn) {
    btn.onclick = async () => {
      clearTimeout(toastTimer);
      t.classList.remove('on');
      await onUndo();
      toast('已恢复');
    };
  }

  toastTimer = setTimeout(() => {
    t.classList.remove('on');
    t.innerHTML = '';
  }, 6000);
}

/* ---------------- 弹窗 ---------------- */
function modal({ title, body, ok = '确定', cancel = '取消', onOk, onMount }) {
  const root = $('#modalRoot');
  root.innerHTML = `
    <div class="overlay">
      <div class="modal">
        <div class="mhead">${esc(title)}</div>
        <div class="mbody">${body}</div>
        <div class="mfoot">
          ${cancel ? `<button class="btn" data-act="cancel">${esc(cancel)}</button>` : ''}
          <button class="btn primary" data-act="ok">${esc(ok)}</button>
        </div>
      </div>
    </div>`;

  const close = () => { root.innerHTML = ''; };

  root.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.act === 'cancel') { close(); return; }
      if (!onOk || onOk(root) !== false) close();
    };
  });
  root.querySelector('.overlay').onclick = (e) => {
    if (e.target.classList.contains('overlay')) close();
  };
  if (onMount) onMount(root);
  return close;
}

/* ---------------- 顶部时钟 ---------------- */
function paintTopStat() {
  if (!ST) return;
  const T = ST.timer;
  let txt;
  if (T.state === 'break') txt = '休息中';
  else if (T.state === 'focus') txt = T.paused ? '已暂停' : '专注中';
  else txt = ST.today.sessions
    ? '今天 ' + ST.today.sessions + ' 个番茄 · ' + ST.today.minutes + ' 分钟'
    : '今天还没开始';
  $('#todayStat').textContent = txt;
}

function paintClock() {
  if (!ST) return;
  const T = ST.timer;
  if (T.state === 'idle') return;
  $('#timerNum').textContent = fmt(T.remain);
  const p = T.total ? T.remain / T.total : 1;
  $('#ringFg').style.strokeDashoffset = 552.92 * (1 - p);
  paintTopStat();
}

/* ---------------- 今日 ---------------- */
function renderToday() {
  $('#stageBadge').textContent = ST.stageName;
  $('#stageBadge').title = ST.stageHint;
  $('#streakText').textContent = '连续 ' + ST.streak + ' 天';
  paintTopStat();

  renderTimer();
  renderPlan();
  renderDueBar();

  $('#todayGrid').innerHTML = `
    <div class="sbox"><div class="slabel">番茄</div><div class="snum">${ST.today.sessions}</div></div>
    <div class="sbox"><div class="slabel">专注</div><div class="snum">${ST.today.minutes}<span class="sunit">分钟</span></div></div>
    <div class="sbox"><div class="slabel">卡片</div><div class="snum">${ST.today.cards}</div></div>
    <div class="sbox"><div class="slabel">干扰</div><div class="snum">${ST.today.interruptions}</div></div>`;
}

function renderTimer() {
  const T = ST.timer;
  const wrap = $('#ringWrap');
  const stage = $('#timerStage');
  const sub = $('#timerSub');
  const acts = $('#timerActions');
  const hint = $('#timerHint');

  wrap.classList.remove('idle', 'isbreak');
  lastTimerKey = T.state + '|' + T.paused;

  if (T.state === 'idle') {
    wrap.classList.add('idle');
    stage.textContent = ST.today.sessions ? '随时可以开始下一个' : '今天还没开始';
    $('#timerNum').textContent = fmt((ST.settings.pomo || 25) * 60);
    sub.textContent = '从下面挑一件事开始';
    $('#ringFg').style.strokeDashoffset = 0;
    acts.innerHTML = '';
    hint.textContent = ST.today.sessions
      ? '今天已完成 ' + ST.today.sessions + ' 个番茄，共 ' + ST.today.minutes + ' 分钟'
      : '一个番茄只做一件事，铃响必须停';
    return;
  }

  if (T.state === 'break') {
    wrap.classList.add('isbreak');
    stage.textContent = '休息中，别碰屏幕';
    sub.textContent = '站起来、走两步、看远处';
    acts.innerHTML = '<button class="btn" id="skipBtn">跳过休息</button>';
    $('#skipBtn').onclick = async () => { await api.skipBreak(); };
    hint.textContent = '休息不是奖励，是让下一个番茄有效的一部分';
    paintClock();
    return;
  }

  stage.textContent = (T.cat ? T.cat + ' · ' : '') + T.name;
  sub.textContent = T.paused ? '已暂停' : '共 ' + Math.round(T.total / 60) + ' 分钟';
  acts.innerHTML = `
    <button class="btn primary" id="pauseBtn">${T.paused ? '继续' : '暂停'}</button>
    <button class="btn" id="itrBtn">记一次干扰</button>
    <button class="btn quiet" id="abortBtn">放弃</button>`;

  $('#pauseBtn').onclick = () => api.toggleTimer();
  $('#itrBtn').onclick = () => askInterrupt();
  $('#abortBtn').onclick = () => askAbort();

  const n = T.intervals;
  hint.textContent = n
    ? '已记 ' + n + ' 次干扰：' + (T.interruptionList || []).join('、')
    : (T.paused ? '暂停期间不算专注时间' : '中断先记下来，别立刻去处理');

  paintClock();
}

function renderPlan() {
  const list = $('#planList');
  const plan = ST.today.plan || [];

  $('#planSummary').textContent = plan.length
    ? ST.taskDone + ' / ' + plan.length + ' 项'
    : '';

  if (!plan.length) {
    list.innerHTML = '<div class="card pad" style="color:var(--faint);font-size:12.5px">今天还没有安排，点右边「重新排」生成一份</div>';
    return;
  }

  const playingIdx = ST.timer.state === 'focus' ? ST.timer.planIdx : -1;

  list.innerHTML = plan.map((p, i) => `
    <div class="pitem ${p.done ? 'done' : ''} ${i === playingIdx ? 'playing' : ''}">
      <button class="pcheck" data-check="${i}">✓</button>
      <div class="pmain">
        <div class="pname">${esc(p.name)}</div>
        <div class="pdesc">${esc(p.desc || '')}</div>
      </div>
      <div class="pmeta">
        <span class="cattag">${esc(p.cat)}</span>
        <span class="pdur">${p.minutes} 分</span>
        <button class="pplay" data-play="${i}" title="开始">▶</button>
        <button class="pdel" data-del="${i}" title="移除">×</button>
      </div>
    </div>`).join('');

  $$('[data-check]', list).forEach((b) => {
    b.onclick = () => api.togglePlan(+b.dataset.check);
  });
  $$('[data-play]', list).forEach((b) => {
    b.onclick = () => {
      if (ST.timer.state !== 'idle') { toast('先把当前这段走完，或者点放弃'); return; }
      const i = +b.dataset.play;
      api.startTimer(ST.today.plan[i], i);
    };
  });
  $$('[data-del]', list).forEach((b) => {
    b.onclick = async () => {
      const idx = +b.dataset.del;
      const it = ST.today.plan[idx];
      const name = it ? it.name : '任务';
      const r = await api.removePlan(idx);
      if (!r || !r.ok) return;
      toastUndo('已移除「' + name + '」', () => api.restorePlan(r.item, r.idx));
    };
  });
}

function renderDueBar() {
  const slot = $('#dueBar');
  if (!ST.due) { slot.innerHTML = ''; return; }
  slot.innerHTML = `
    <div class="duebar">
      <div class="txt"><b>${ST.due} 张卡片到期</b><span>按遗忘曲线，现在复习效果最好</span></div>
      <button class="btn sm blue" id="goReview">去复习</button>
    </div>`;
  $('#goReview').onclick = () => switchView('review');
}

/* ---------------- 复习 ---------------- */
async function loadReview() {
  const list = await api.dueCards();
  R.queue = list || [];
  R.idx = 0;
  R.revealed = false;
  renderReview();
  // 先把今天这几个词的音频合出来，点朗读时就不用等
  warmUpVoice(R.queue.map((c) => c.front));
}

/* 单词朗读：优先用内置离线神经语音（主进程里的 Piper），
 * 拿不到时再退回系统语音。
 *
 * 为什么要自带引擎：Windows 有两套语音库，Chromium 只枚举 OneCore 那套，
 * 而中文版 Windows 的 OneCore 里没有英文音 —— 所以 speechSynthesis
 * 在没装英文语音包的机器上一个英文音都看不到。装语音包要管理员权限，
 * 不能当成"打开就能用"的前提。 */
let ttsInfo = null;
let audioCtx = null;
let currentSrc = null;
let voiceList = null;
let voiceProbe = null;

function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function b64ToBuf(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}

async function playWav(b64) {
  const ctx = getCtx();
  const buf = await ctx.decodeAudioData(b64ToBuf(b64));
  if (currentSrc) { try { currentSrc.stop(); } catch (e) { /* 已经停了 */ } }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  currentSrc = src;
}

/* 结果缓存 60 秒：设置页每重绘一次就探测一次太浪费（主进程那边要 existsSync + readdirSync），
 * 而引擎状态不会一秒一变。真出问题时用户点「试听」会走 sayWord，那里有强制路径。 */
let ttsInfoAt = 0;
async function ttsProbe(force) {
  if (ttsInfo && !force && Date.now() - ttsInfoAt < 60000) return ttsInfo;
  try {
    ttsInfo = await api.ttsStatus();
  } catch (e) {
    ttsInfo = { ok: false, why: e.message };
  }
  ttsInfoAt = Date.now();
  return ttsInfo;
}

/* 同一个词 400 毫秒内只发一次，连点不会叠着响 */
let lastSay = { text: '', at: 0 };

async function speak(text) {
  const t = String(text || '').trim();
  if (!t) return;
  const now = Date.now();
  if (t === lastSay.text && now - lastSay.at < 400) return;
  lastSay = { text: t, at: now };

  const st = await ttsProbe();
  if (st && st.ok) {
    try {
      const r = await api.sayWord(t);
      if (r && r.ok) { await playWav(r.data); return; }
      console.warn('[tts] 合成失败：', r && r.why);
      if (r && r.why !== 'no-engine') { toast('这个词没合成出来，再点一下试试'); return; }
    } catch (e) {
      console.warn('[tts] 播放失败：', e.message);
    }
  }
  speakBySystem(t);
}

/* 内置引擎不可用时兜底：系统语音。
 * 但必须确认是英文音 —— 用中文音去念英文是假发音，宁可不响。 */
function loadVoices() {
  const cur = window.speechSynthesis ? (window.speechSynthesis.getVoices() || []) : [];
  if (cur.length) { voiceList = cur; return Promise.resolve(cur); }
  if (!window.speechSynthesis) return Promise.resolve([]);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      voiceList = window.speechSynthesis.getVoices() || [];
      resolve(voiceList);
    };
    window.speechSynthesis.addEventListener('voiceschanged', finish, { once: true });
    setTimeout(finish, 1200);
  });
}

// Windows 上 en-US / en-GB 都能用，优先美音（四六级听力是美音为主）
function pickEnglish(list) {
  const all = (list || []).filter((x) => /^en[-_]/i.test(x.lang || ''));
  return all.find((x) => /[-_]US/i.test(x.lang)) || all[0] || null;
}

async function probeVoice(force) {
  if (voiceProbe && !force) return voiceProbe;
  const vs = await loadVoices();
  const v = pickEnglish(vs);
  voiceProbe = v
    ? { ok: true, name: v.name, lang: v.lang }
    : { ok: false, langs: vs.map((x) => x.lang) };
  return voiceProbe;
}

async function speakBySystem(text) {
  if (!window.speechSynthesis) { askInstallVoice(); return; }
  const vs = await loadVoices();
  const v = pickEnglish(vs);
  if (!v) { askInstallVoice(); return; }
  const u = new SpeechSynthesisUtterance(text);
  u.voice = v;
  u.lang = v.lang;
  u.rate = 0.85;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

/* 两套都没有时，给一条能走通的路 */
function askInstallVoice() {
  modal({
    title: '发音引擎没找到',
    body: `<p>这个版本应该自带一个离线英文语音引擎，但它的文件没找到（可能被杀毒软件删了，或者装的时候被裁掉了）。</p>
      <p>两条路：<br>
      1. 重新安装本应用，会把 engine 目录一起装上；<br>
      2. 装系统的英语语音：设置 → 时间和语言 → 语音 → 添加语音 → 英语（美国），约 20MB。</p>
      <p style="color:var(--faint);font-size:11.5px">系统语音装完不用重启应用，回到这里再点一次「试听」就能响。</p>`,
    ok: '打开语音设置',
    cancel: '算了',
    onOk: () => { api.openVoiceSettings(); return true; }
  });
}

/* 设置页那行发音状态 */
async function renderVoice() {
  const st = $('#voiceState');
  const hint = $('#voiceHint');
  if (!st) return;
  const t = await ttsProbe();
  if (t && t.ok) {
    const name = (t.voices && t.voices[0]) ? t.voices[0].replace(/\.onnx$/, '') : 'lessac';
    st.textContent = '内置离线语音就绪 · ' + name;
    st.style.color = 'var(--leaf)';
    hint.textContent = '不用联网、不用装系统语音。一个词第一次点要合 0.3 秒左右，之后是瞬间出声';
    $('#btnVoiceSet').hidden = true;
  } else {
    const r = await probeVoice(true);
    if (r.ok) {
      st.textContent = '系统英文语音 · ' + r.name;
      st.style.color = 'var(--leaf)';
      hint.textContent = '内置引擎不可用，暂时借系统语音顶一下';
    } else {
      st.textContent = '没有可用的英文发音';
      st.style.color = 'var(--amber)';
      hint.textContent = '内置引擎的文件没找到。重新安装应用，或装一个系统英语语音';
    }
    $('#btnVoiceSet').hidden = false;
  }
  const pace = (ST.settings && ST.settings.voicePace) || 'normal';
  $$('#segVoicePace button').forEach((b) => b.classList.toggle('on', b.dataset.v === pace));
}

/* 把今天要复习的词先合成好，点的时候不用等 */
function warmUpVoice(words) {
  if (!words || !words.length) return;
  api.prefetchWords(words).catch(() => {});
}

function bindSpeak(root) {
  $$('.spk', root || document).forEach((b) => {
    b.onclick = (ev) => { ev.stopPropagation(); speak(b.dataset.say); };
  });
}

function renderReview() {
  const body = $('#reviewBody');

  if (!R.queue.length) {
    body.innerHTML = `
      <div class="empty">
        <div class="et">${ST.totalCards ? '现在没有到期的卡片' : '词库还是空的'}</div>
        <div class="es">${ST.totalCards
          ? '按遗忘曲线，没到点就复习是浪费。到点了这里会亮起红点提醒你。'
          : '去「设置 → 导入与数据」点一下「再发 20 个新词」，先铺一批高频词。'}</div>
      </div>`;
    return;
  }

  if (R.idx >= R.queue.length) {
    body.innerHTML = `
      <div class="empty">
        <div class="et">这一批过完了</div>
        <div class="es">共 ${R.queue.length} 张。它们已经按曲线排到下一次。<br>
          <button class="btn" id="againBtn" style="margin-top:14px">再抽一批</button></div>
      </div>`;
    $('#againBtn').onclick = () => loadReview();
    return;
  }

  const c = R.queue[R.idx];

  // 没见过的新词：先看一遍，不考。考它是十分钟后的事
  if (!c.reps) {
    body.innerHTML = `
      <div class="fcwrap">
        <div class="fcprog">第 ${R.idx + 1} / ${R.queue.length} 张 · 新词<button class="spk" data-say="${esc(c.front)}">朗读</button></div>
        <div class="flashcard revealed">
          <div class="fcfront">${esc(c.front)}</div>
          <div class="fcback">${esc(c.back)}${c.ex ? `<div class="fcex">${esc(c.ex)}</div>` : ''}</div>
          <div class="fctip">先看一遍，别急着背</div>
        </div>
        <div class="fcactions" style="grid-template-columns:1fr">
          <button class="rate good" id="learnedBtn">看过了，下一个<small>10 分钟后回来考你</small></button>
        </div>
      </div>`;
    bindSpeak(body);
    $('#learnedBtn').onclick = async () => {
      await api.learnCard(c.id);
      R.idx++;
      R.revealed = false;
      renderReview();
    };
    return;
  }

  body.innerHTML = `
    <div class="fcwrap">
      <div class="fcprog">第 ${R.idx + 1} / ${R.queue.length} 张 · 第 ${c.iv + 1} 档<button class="spk" data-say="${esc(c.front)}">朗读</button></div>
      <div class="flashcard ${R.revealed ? 'revealed' : ''}" id="fcard">
        <div class="fcfront">${esc(c.front)}</div>
        ${R.revealed ? `
          <div class="fcback">${esc(c.back)}${c.ex ? `<div class="fcex">${esc(c.ex)}</div>` : ''}</div>` : ''}
        <div class="fctip">${R.revealed ? '想清楚再点下面' : '点击查看释义'}</div>
      </div>
      <div class="fcactions" ${R.revealed ? '' : 'hidden'}>
        <button class="rate again" data-r="0">忘了<small>回到 10 分钟档</small></button>
        <button class="rate" data-r="1">模糊<small>退回一档</small></button>
        <button class="rate good" data-r="2">记得<small>进下一档</small></button>
      </div>
    </div>`;
  bindSpeak(body);

  $('#fcard').onclick = () => {
    if (R.revealed) return;
    R.revealed = true;
    renderReview();
  };

  $$('[data-r]').forEach((b) => {
    b.onclick = async () => {
      const card = R.queue[R.idx];
      await api.rateCard(card.id, +b.dataset.r);
      R.idx++;
      R.revealed = false;
      renderReview();
    };
  });
}

/* ---------------- 记录 ---------------- */
function renderStats() {
  const t = ST.totals;
  $('#totalGrid').innerHTML = `
    <div class="sbox"><div class="slabel">总番茄</div><div class="snum">${t.pomodoros}</div></div>
    <div class="sbox"><div class="slabel">总专注</div><div class="snum">${(t.minutes / 60).toFixed(1)}<span class="sunit">小时</span></div></div>
    <div class="sbox"><div class="slabel">记住的卡</div><div class="snum">${ST.mastered}<span class="sunit">/${ST.totalCards}</span></div></div>
    <div class="sbox"><div class="slabel">最长连续</div><div class="snum">${t.best}<span class="sunit">天</span></div></div>`;

  const max = Math.max(30, ...ST.week.map((w) => w.min));
  $('#weekSum').textContent = '合计 ' + ST.week.reduce((n, w) => n + w.min, 0) + ' 分钟';
  $('#weekBars').innerHTML = ST.week.map((w) => `
    <div class="barcol">
      <div class="barval">${w.min || ''}</div>
      <div class="bar ${w.today ? 'on' : ''}" style="height:${Math.round(w.min / max * 92)}%"></div>
      <div class="barlabel">${w.label}</div>
    </div>`).join('');

  const catMax = ST.cats.length ? ST.cats[0][1] : 1;
  $('#catRows').innerHTML = ST.cats.length
    ? ST.cats.map(([c, m]) => `
      <div class="catrow">
        <span class="n">${esc(c)}</span>
        <span class="track"><span class="fill" style="width:${Math.round(m / catMax * 100)}%"></span></span>
        <span class="v">${fmtMin(m)}</span>
      </div>`).join('')
    : '<div style="color:var(--faint);font-size:12px">还没有记录</div>';

  $('#logList').innerHTML = ST.logs.length
    ? ST.logs.map((s) => {
      const d = new Date(s.endedAt);
      return `<div class="logrow">
        <span class="t">${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</span>
        <span class="n">${esc(s.name)}</span>
        <span class="tag ${s.status === 'done' ? 'ok' : 'bad'}">${s.status === 'done' ? '完成' : '作废'}</span>
        <span class="m">${s.minutes} 分</span>
      </div>`;
    }).join('')
    : '<div class="logrow"><span class="n" style="color:var(--faint)">还没有记录</span></div>';

  renderCurve();
}

function renderCurve() {
  const { raw, rev, reviews } = ST.curve;
  const x0 = 44, y0 = 22, W = 558, H = 104;
  const xs = (t) => x0 + t / 30 * W;
  const ys = (r) => y0 + (1 - r) * H;
  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${xs(p[0]).toFixed(1)} ${ys(p[1]).toFixed(1)}`).join(' ');

  $('#curveCard').innerHTML = `
    <svg width="100%" viewBox="0 0 660 172" role="img" aria-label="遗忘曲线与按计划复习的保持率对比">
      <line x1="${x0}" y1="${ys(1)}" x2="${x0 + W}" y2="${ys(1)}" style="stroke:var(--line)" stroke-width="1"/>
      <line x1="${x0}" y1="${ys(0.5)}" x2="${x0 + W}" y2="${ys(0.5)}" style="stroke:var(--line)" stroke-width="1" stroke-dasharray="3 4"/>
      <line x1="${x0}" y1="${ys(0)}" x2="${x0 + W}" y2="${ys(0)}" style="stroke:var(--line)" stroke-width="1"/>
      <text x="${x0 - 8}" y="${ys(1)}" text-anchor="end" dominant-baseline="central" font-size="11" style="fill:var(--faint)">100%</text>
      <text x="${x0 - 8}" y="${ys(0.5)}" text-anchor="end" dominant-baseline="central" font-size="11" style="fill:var(--faint)">50%</text>
      <text x="${x0 - 8}" y="${ys(0)}" text-anchor="end" dominant-baseline="central" font-size="11" style="fill:var(--faint)">0</text>
      <path d="${path(raw)}" fill="none" style="stroke:var(--faint)" stroke-width="1.4" stroke-dasharray="4 3"/>
      <path d="${path(rev)}" fill="none" style="stroke:var(--leaf)" stroke-width="1.8"/>
      ${reviews.map((t) => `<line x1="${xs(t)}" y1="${y0}" x2="${xs(t)}" y2="${ys(0)}" style="stroke:var(--leaf)" stroke-width="0.8" stroke-dasharray="2 4" opacity="0.45"/>`).join('')}
      ${[[0, '0'], [7, '7 天'], [15, '15 天'], [30, '30 天']].map(([t, l]) =>
        `<text x="${xs(t)}" y="${ys(0) + 15}" text-anchor="middle" font-size="11" style="fill:var(--faint)">${l}</text>`).join('')}
      <g transform="translate(${x0 + W - 168},${y0 - 12})">
        <line x1="0" y1="0" x2="12" y2="0" style="stroke:var(--faint)" stroke-width="1.4" stroke-dasharray="4 3"/>
        <text x="18" y="0" dominant-baseline="central" font-size="11.5" style="fill:var(--faint)">不复习</text>
        <line x1="66" y1="0" x2="78" y2="0" style="stroke:var(--leaf)" stroke-width="1.8"/>
        <text x="84" y="0" dominant-baseline="central" font-size="11.5" style="fill:var(--leaf)">按曲线复习</text>
      </g>
    </svg>
    <div style="font-size:11.5px;color:var(--faint);line-height:1.75;padding:0 16px 14px">
      灰色虚线是不复习的自然遗忘，一天就掉到三成；绿色是每次都在临界点复习的结果。
      卡片每答对一次，衰减就慢一档——「每天过一遍」比「一次背两小时」有用得多。
    </div>`;
}

/* ---------------- 铃声控制 ----------------
 * 内置音色是现场合成的，自定义铃声是用户上传的音频文件。
 * 两者在这里统一成一个列表，界面上不加区分地排在一起。
 */
const B = {
  sounds: [],

  list() {
    const builtin = Bell.recipes();
    const custom = this.sounds || [];
    return builtin.concat(custom);
  },

  current() {
    const s = ST && ST.settings;
    return (s && s.bell) || 'tomato';
  },

  async refresh() {
    try {
      const custom = await api.listSounds();
      this.sounds = (custom || []).slice();
    } catch (e) {
      this.sounds = [];
    }
    this.render();
    return this.sounds;
  },

  render() {
    const grid = $('#bellGrid');
    if (!grid || !Bell) return;
    const cur = this.current();
    const items = this.list();

    // 选中的铃声被删掉了，别让界面显示"什么都没选"
    if (!items.some((x) => x.id === cur)) {
      grid.innerHTML = `<div class="bellempty">还没有铃声，点下面「上传自己的」加一个</div>`;
      return;
    }

    grid.innerHTML = items.map((x) => `
      <button class="bellitem ${x.id === cur ? 'on' : ''}" data-bell="${esc(x.id)}">
        <span class="bn">${esc(x.name)}</span>
        <span class="bd">${esc(x.desc || '我上传的音频')}</span>
        ${x.builtin ? '' : `<span class="bx" data-rm="${esc(x.id)}" title="删掉这个铃声">×</span>`}
      </button>`).join('');

    $$('#bellGrid .bellitem').forEach((b) => {
      b.onclick = (ev) => {
        // 点的是删除叉，不要顺手把铃声也切过去
        if (ev.target.dataset && ev.target.dataset.rm) return;
        api.setSettings({ bell: b.dataset.bell });
        Bell.play({ id: b.dataset.bell, vol: ST.settings.soundVol, times: 1 });
        this.render();
      };
    });

    $$('#bellGrid .bx').forEach((b) => {
      b.onclick = async (ev) => {
        ev.stopPropagation();
        const id = b.dataset.rm;
        const r = await api.removeSound(id);
        if (r && r.ok) {
          Bell.clearCache(id);
          await B.refresh();
          toast('已删掉这个铃声');
        }
      };
    });
  },

  preview() {
    const s = ST.settings;
    if (!s.sound) {
      toast('「到点响铃」是关着的，先打开开关');
      return;
    }
    Bell.play({ id: this.current(), vol: s.soundVol, times: s.bellTimes })
      .then((r) => {
        if (!r.ok) toast('响不出来：' + r.why);
        else if (Bell.state() !== 'running') toast('系统把音频挡住了，点一下窗口再试');
      });
  }
};

/* ---------------- 设置 ---------------- */
/* 备考节奏那行：说实话。
 * 词池六千多词，一天十个要背两年——那不是备考，是拖。所以这里直接把
 * "照现在的速度到考试能过多少"算出来，差多少也照实写。 */
function renderPace(pl) {
  const row = $('#rowPace');
  const txt = $('#paceText');
  const fix = $('#btnPaceFix');
  if (!row || !txt) return;

  if (!pl || pl.days == null) { row.hidden = true; return; }
  row.hidden = false;

  // days 是 Math.max(0, ...) 出来的，考试当天就是 0。
  // 不能跟"已经过了"混在一起判，否则考试当天打开会看到"这个日期已经过了"
  if (pl.days === 0) {
    txt.textContent = '今天就是考试日。今天过了，这一页就可以退休了';
    fix.hidden = true;
    return;
  }
  if (pl.days < 0) {
    txt.textContent = '这个日期已经过了，改一个未来的日期';
    fix.hidden = true;
    return;
  }
  fix.hidden = false;

  if (pl.canCover >= pl.left) {
    txt.innerHTML = `还剩 ${pl.days} 天 · 每天 ${pl.perDay} 个，到考试刚好过完 ${pl.left} 个`;
    fix.hidden = true;
    return;
  }

  const lack = pl.left - pl.canCover;
  // 压成两行：第一行给事实，第二行给结论。挤成一大坨没人看得下去
  txt.innerHTML = `还剩 ${pl.days} 天 · 每天 ${pl.perDay} 个只能过 ${pl.canCover} 个，差 ${lack} 个<br>`
    + (pl.needPerDay > 50
      // 一天 50 个已经是上限了，再多也背不住，别拿一个不可能的数字骗人
      ? `<span style="color:var(--amber)">全背完要每天 ${pl.needPerDay} 个，不现实 —— 先拿下六级新增的 ${pl.only6Left} 个</span>`
      : `改成每天 ${pl.needPerDay} 个就能过完`);
}

function renderSettings() {
  const s = ST.settings;
  $('#setDaily').value = s.daily;
  $('#setPomo').value = s.pomo;
  $('#setBreak').value = s.breakMin;
  $('#setStage').value = s.stage;
  $('#setDailyNew').value = s.dailyNew || 10;
  $('#setAutoBreak').checked = !!s.autoBreak;
  $('#setOnTop').checked = !!s.alwaysOnTop;
  $('#setTray').checked = !!s.closeToTray;
  $('#setNotify').checked = !!s.notify;

  $('#setSound').checked = !!s.sound;
  $('#setVol').value = s.soundVol;
  $('#volVal').textContent = s.soundVol;
  $$('#segTimes button').forEach((b) => b.classList.toggle('on', +b.dataset.v === s.bellTimes));
  // 关掉响铃时，音量和次数的调整没意义，淡下去但仍可点（想先调好再开）
  $('#rowVol').classList.toggle('muted', !s.sound);
  $('#rowTimes').classList.toggle('muted', !s.sound);

  $$('#segTheme button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.theme));

  /* 界面材质。系统不支持时把两档置灰并说清原因 —— 不要让人点了没反应，
   * 更不要留下"选了亚克力、窗口透出桌面却没有毛玻璃"的半截状态。 */
  const mat = s.material || 'solid';
  const matOk = ST.materialOk !== false;
  $$('#segMat button').forEach((b) => {
    b.classList.toggle('on', b.dataset.v === mat);
    const no = b.dataset.v !== 'solid' && !matOk;
    b.disabled = no;
    b.classList.toggle('muted', no);
  });
  $('#matNote').textContent = matOk
    ? '亚克力和云母会让窗口透出桌面背景，Win11 22H2 以上才支持'
    : '这个系统不支持材质（要 Win11 22H2 以上），只能用纯色';
  $('#dataPath').textContent = 'config.json 存在用户目录下，卸载程序不会删它';

  /* 备考 */
  const pl = ST.pool || { total: 0, inHand: 0, left: 0, level: 'cet4', levelName: '四级' };
  const lvl = pl.level || 'cet4';
  $$('#segLevel button').forEach((b) => b.classList.toggle('on', b.dataset.v === lvl));
  $('#levelNote').textContent = lvl === 'cet6'
    ? `六级池 ${pl.total} 词 · 六级新增 ${pl.only6} 个，其余是四级基础词`
    : `四级池 ${pl.total} 词 · 核心 100 加四级全表`;
  $('#setExam').value = pl.examDate || '';
  renderPace(pl);

  $('#dailyNewHint').textContent = pl.days > 0
    ? `按词频发 · 现在这个数 ${pl.days} 天能过 ${pl.canCover} 个`
    : '按词频从高到低发。填了考试日期就能算出每天该发多少';

  $('#poolBar').innerHTML = `
    <span>${pl.levelName || '四级'}词池 <b>${pl.total}</b> 词</span>
    <span>手上 <b>${pl.inHand}</b> 张</span>
    <span>还能发 <b>${pl.left}</b> 个</span>
    ${pl.only6 && lvl === 'cet6' ? `<span>六级新增还剩 <b>${pl.only6Left}</b> 个</span>` : ''}
    ${pl.days > 0 ? `<span>距考试 <b>${pl.days}</b> 天</span>` : ''}`;

  renderVoice();
  B.render();
}

/* ---------------- 视图切换 ---------------- */
function switchView(name) {
  $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('on', v.id === 'view-' + name));
  if (name === 'today') renderToday();
  if (name === 'review') loadReview();
  if (name === 'stats') renderStats();
  if (name === 'settings') renderSettings();
  $('.body').scrollTop = 0;
}

/* ---------------- 交互：干扰与放弃 ---------------- */
function askInterrupt() {
  modal({
    title: '记一次干扰',
    body: `<p>写下来，然后回到刚才那行。计时不会停。</p>
      <input type="text" id="itrInput" placeholder="回了一条微信 / 想起要交电费" autocomplete="off">`,
    ok: '记下',
    onOk: (root) => {
      const v = root.querySelector('#itrInput').value.trim();
      api.interrupt(v);
      return true;
    },
    onMount: (root) => setTimeout(() => root.querySelector('#itrInput').focus(), 60)
  });
}

function askAbort() {
  const elapsed = Math.max(0, Math.round((ST.timer.total - ST.timer.remain) / 60));
  modal({
    title: '放弃这个番茄？',
    body: `<p>已经过去 <b>${elapsed} 分钟</b>。</p>
      <p>按规则这个番茄作废，不计入今天的账。已经断掉的专注，算半个只会让你高估自己。</p>`,
    ok: '作废',
    cancel: '继续做',
    onOk: () => { api.abortTimer(); return true; }
  });
}

function askAddTask() {
  const cats = ['词汇', '听力', '阅读', '翻译', '写作', '综合'];
  modal({
    title: '自定义一个任务',
    body: `<p>名称</p>
      <input type="text" id="ctName" placeholder="比如：背 30 个新词" autocomplete="off">
      <p style="margin-top:11px">分类</p>
      <div class="chips" id="ctCats">
        ${cats.map((c, i) => `<button data-cat="${c}" class="${i === 0 ? 'on' : ''}">${c}</button>`).join('')}
      </div>
      <p style="margin-top:11px">时长（分钟）</p>
      <input type="number" id="ctMin" value="${ST.settings.pomo}" min="5" max="180" step="5">
      <p style="margin-top:10px;font-size:11.5px;color:var(--faint)">填 5 到 180，超出按边界算。超过 25 分钟的任务，会在每 25 分钟处提醒一次，但不打断。</p>`,
    ok: '加进今天',
    onOk: (root) => {
      const name = root.querySelector('#ctName').value.trim();
      if (!name) { toast('先给任务起个名字'); return false; }
      const cat = root.querySelector('#ctCats .on').dataset.cat;
      // 越界就夹到边界，跟上面写的范围保持一致；空值才回落到默认番茄长度
      const raw = +root.querySelector('#ctMin').value;
      const minutes = Number.isFinite(raw) && raw > 0
        ? Math.min(180, Math.max(5, Math.round(raw)))
        : ST.settings.pomo;
      api.addPlan({ name, cat, minutes });
      return true;
    },
    onMount: (root) => {
      root.querySelector('#ctName').focus();
      // 失焦时把离谱的值夹回范围内，而不是等他点提交才报错
      const minInput = root.querySelector('#ctMin');
      minInput.onblur = () => {
        const v = +minInput.value;
        if (!Number.isFinite(v) || v <= 0) { minInput.value = ST.settings.pomo; return; }
        minInput.value = Math.min(180, Math.max(5, Math.round(v)));
      };
      root.querySelectorAll('#ctCats button').forEach((b) => {
        b.onclick = () => {
          root.querySelectorAll('#ctCats button').forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
        };
      });
    }
  });
}

/* ---------------- 状态应用 ---------------- */
function applyState(s) {
  ST = s;
  document.documentElement.dataset.theme = s.settings.theme || 'dark';
  /* 材质只加一个 class，真正的毛玻璃由主进程的 setBackgroundMaterial 交给 DWM 画。
   * 这里负责把页面底色让开（html/body 透明、面板半透明），见 style.css 末尾。 */
  document.body.classList.toggle('mat', (s.settings.material || 'solid') !== 'solid');
  $('#dueDot').hidden = !s.due;
  // 只重绘看得见的那一页。以前今日页是无条件重绘的，于是在复习页评一张卡，
  // 就会把下面藏着的计时器 + 计划列表 + 四宫格整块重建一次，白干活
  if ($('#view-today').classList.contains('on')) renderToday();
  if ($('#view-stats').classList.contains('on')) renderStats();
  if ($('#view-settings').classList.contains('on')) renderSettings();
}

/* ---------------- 绑定 ---------------- */
function bind() {
  $$('.tab').forEach((t) => { t.onclick = () => switchView(t.dataset.view); });

  /* 复习页键盘：空格翻面（新词页就是"下一个"）、1/2/3 评分。
   * 每天几十次点击全发生在这一页，键盘是整应用性价比最高的一处改动，
   * 也是 Anki 用户的肌肉记忆。
   * 三个不能抢的情况：不在复习页、弹窗开着、焦点在输入框或按钮上
   * （按钮聚焦时空格是"激活这个按钮"的原生行为，抢过来会点两次）。 */
  document.addEventListener('keydown', (e) => {
    if (!$('#view-review').classList.contains('on')) return;
    if ($('#modalRoot').children.length) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'button' || tag === 'a') return;

    const c = R.queue[R.idx];
    if (!c) return;

    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();          // 不然会滚页面
      if (!c.reps) {               // 新词页只有一个按钮
        const b = $('#learnedBtn');
        if (b) b.click();
      } else if (!R.revealed) {
        R.revealed = true;
        renderReview();
      }
      return;
    }

    const n = { 1: 0, 2: 1, 3: 2 }[e.key];
    if (n === undefined || !R.revealed) return;
    const btn = document.querySelector('[data-r="' + n + '"]');
    if (btn) { e.preventDefault(); btn.click(); }
  });

  $('#btnMin').onclick = () => api.minimize();
  $('#btnMax').onclick = () => api.toggleMaximize();
  $('#btnClose').onclick = () => api.close();

  $('#btnAddTask').onclick = askAddTask;
  $('#btnRebuild').onclick = () => api.rebuildPlan();

  /* ---------------- 备考 ---------------- */
  $$('#segLevel button').forEach((b) => {
    b.onclick = async () => {
      if (ST.pool && b.dataset.v === ST.pool.level) return;
      await api.setSettings({ level: b.dataset.v });
      toast(b.dataset.v === 'cet6'
        ? '换成六级词池：先铺六级新增的词，四级基础词排在后面。手上的卡不受影响'
        : '换回四级词池。已经学过的卡片都还在');
    };
  });

  $('#setExam').onchange = (e) => api.setSettings({ examDate: e.target.value || '' });

  /* 一键配速：按剩余天数和剩余词量，把"每天新词"调到刚好的数。
   * 超过 50 就直接顶到 50 —— 一天发一百个词不是勤奋，是当天下不去手背。 */
  $('#btnPaceFix').onclick = async () => {
    const pl = ST.pool || {};
    if (pl.days == null || pl.days <= 0) { toast('先填一个未来的考试日期'); return; }
    const need = pl.needPerDay || pl.perDay;
    const v = Math.max(5, Math.min(50, Math.round(need)));
    await api.setSettings({ dailyNew: v });
    toast(need > 50
      ? `一天 ${v} 个已经是上限。全背完不现实，先把六级新增那 ${pl.only6Left} 个拿下`
      : `改成每天 ${v} 个，到考试刚好过完`);
  };

  $('#btnVoiceTest').onclick = () => speak('abandon');
  $('#btnVoiceSet').onclick = () => api.openVoiceSettings();

  $('#setDaily').onchange = (e) => api.setSettings({ daily: Math.max(20, Math.min(360, +e.target.value || 60)) });
  $('#setPomo').onchange = (e) => api.setSettings({ pomo: Math.max(10, Math.min(60, +e.target.value || 25)) });
  $('#setBreak').onchange = (e) => api.setSettings({ breakMin: Math.max(1, Math.min(30, +e.target.value || 5)) });
  $('#setStage').onchange = (e) => api.setSettings({ stage: e.target.value });
  $('#setDailyNew').onchange = (e) => {
    const v = Math.max(5, Math.min(50, Math.round(+e.target.value || 10)));
    e.target.value = v;
    api.setSettings({ dailyNew: v });
  };
  $('#setAutoBreak').onchange = (e) => api.setSettings({ autoBreak: e.target.checked });
  $('#setOnTop').onchange = (e) => api.setSettings({ alwaysOnTop: e.target.checked });
  $('#setTray').onchange = (e) => api.setSettings({ closeToTray: e.target.checked });
  $('#setNotify').onchange = (e) => api.setSettings({ notify: e.target.checked });

  /* ---------------- 铃声 ---------------- */
  $('#setSound').onchange = (e) => api.setSettings({ sound: e.target.checked });

  /* 拖动过程中只改数字，松手才响一声。
   * 拖一下就响一次会叠成一片噪音，而且每次都是 1 秒多的衰减音。 */
  $('#setVol').oninput = (e) => {
    $('#volVal').textContent = e.target.value;
  };
  $('#setVol').onchange = (e) => {
    const v = +e.target.value;
    api.setSettings({ soundVol: v });
    if (v > 0) Bell.play({ id: B.current(), vol: v, times: 1 });
  };

  $$('#segTimes button').forEach((b) => {
    b.onclick = () => {
      api.setSettings({ bellTimes: +b.dataset.v });
      Bell.play({ id: B.current(), vol: ST.settings.soundVol, times: +b.dataset.v });
    };
  });

  $('#bellTest').onclick = () => B.preview();

  $('#bellUpload').onclick = async () => {
    const r = await api.uploadSound();
    if (!r || !r.ok) {
      if (r && r.why) toast(r.why);
      return;
    }
    Bell.clearCache();
    await B.refresh();
    toast('已换成「' + r.name + '」');
    B.preview();
  };

  $$('#segTheme button').forEach((b) => {
    b.onclick = () => api.setSettings({ theme: b.dataset.v });
  });

  /* 换材质由主进程调 setBackgroundMaterial，界面这边只等广播回来后切 class。
   * 系统不支持时主进程会把值改成 solid 并回一句说明，这里原样转达。 */
  $$('#segMat button').forEach((b) => {
    b.onclick = async () => {
      const v = b.dataset.v;
      const r = await api.setSettings({ material: v });
      if (r && r.msg) { toast(r.msg); return; }
      const name = { solid: '纯色', acrylic: '亚克力', mica: '云母' }[v] || '';
      toast('界面材质已换成「' + name + '」');
    };
  });

  $$('#segVoicePace button').forEach((b) => {
    b.onclick = () => {
      api.setSettings({ voicePace: b.dataset.v }).then(() => {
        ttsInfo = null;
        renderVoice();
        // 换语速后旧缓存对不上了，按新语速重新预热一遍手上的词
        if (R.queue && R.queue.length) warmUpVoice(R.queue.map((c) => c.front));
        speak('abandon');   // 换完立刻听一下差别
      });
    };
  });

  $('#btnImport').onclick = async () => {
    const raw = $('#importArea').value.trim();
    if (!raw) { toast('先粘贴内容'); return; }
    const r = await api.importCards(raw);
    if (r && r.ok) {
      $('#importArea').value = '';
      toast(r.added ? '导入了 ' + r.added + ' 张' : '没有新增，可能都重复了');
    }
  };

  $('#btnSeed').onclick = async () => {
    const r = await api.seedCards();
    if (!r || !r.added) { toast('词池已经空了，能发的都发完了'); return; }
    toast('发了 ' + r.added + ' 个新词，去复习页学');
  };

  $('#btnExport').onclick = async () => {
    const r = await api.exportData();
    if (r && r.ok) toast('已导出到 ' + r.path);
    else if (r && r.msg) toast('导出失败：' + r.msg);
  };

  $('#btnImportData').onclick = async () => {
    modal({
      title: '用备份覆盖当前数据？',
      body: '<p>当前的记录和卡片进度会被备份文件<b>整个替换</b>，不能撤销。</p><p>建议先把现在这份导出一次。</p>',
      ok: '选择文件',
      cancel: '取消',
      onOk: async () => {
        const r = await api.importData();
        if (r && r.ok) toast('已恢复');
        else if (r && r.msg) toast('恢复失败：' + r.msg);
        return true;
      }
    });
  };

  $('#btnReveal').onclick = () => api.revealData();

  /* 清空重来。
   * 这类操作点错一次，几个月的记录就没了，所以不设"一键"。要求把「清空」
   * 两个字亲手打出来才放行 —— 比"确定/取消"两个按钮难误触得多。
   * 主进程那边还会先落一份备份，打错了也能用「恢复」捡回来。 */
  const doReset = (mode) => {
    const all = mode === 'all';
    modal({
      title: all ? '连设置一起恢复出厂？' : '清空所有学习记录？',
      body:
        '<p>' + (all
          ? '番茄记录、卡片进度、今日安排，<b>以及全部设置</b>都会回到刚装好的样子。'
          : '番茄记录、卡片进度、今日安排全部清空，<b>设置保留</b>。')
        + '词池不动，清完会重新发今天的新词。</p>'
        + '<p>清空前会自动存一份备份，写错了能用上面的「恢复」捡回来。</p>'
        + '<p>确认请在下面输入「清空」两个字：</p>'
        + '<input type="text" id="resetConfirm" placeholder="清空" autocomplete="off">',
      ok: '确认清空',
      cancel: '算了',
      onMount: (root) => {
        const inp = root.querySelector('#resetConfirm');
        const okBtn = root.querySelector('[data-act=ok]');
        const sync = () => {
          const ready = inp.value.trim() === '清空';
          okBtn.disabled = !ready;
          okBtn.style.opacity = ready ? '' : '.45';
          okBtn.style.pointerEvents = ready ? '' : 'none';
        };
        sync();
        inp.oninput = sync;
        setTimeout(() => inp.focus(), 30);
      },
      onOk: async () => {
        const r = await api.resetData(mode);
        if (!r || !r.ok) {
          toast((r && r.msg) || '清空失败');
          return true;
        }
        toast('已清空，备份在 ' + String(r.backup || '').split(/[\\/]/).pop());
        // 清完停在设置页会让人以为没生效，切回首页看新的安排
        switchView('today');
        return true;
      }
    });
  };
  $('#btnReset').onclick = () => doReset('learn');
  $('#btnResetAll').onclick = () => doReset('all');

  api.onState(applyState);

  api.onTick((t) => {
    if (!ST) return;
    ST.timer.remain = t.remain;
    ST.timer.total = t.total;
    const key = t.state + '|' + t.paused;
    const changed = key !== lastTimerKey;
    ST.timer.state = t.state;
    ST.timer.paused = t.paused;
    if (changed) renderTimer();
    else paintClock();
  });

  api.onMaximize((v) => {
    $('#btnMax').textContent = v ? '❐' : '▢';
    $('#btnMax').title = v ? '还原' : '最大化';
  });

  /* 到点响铃。计时器活在主进程，所以窗口最小化、进托盘也照样会推过来。
   * 这里的策略：先确保音频上下文是活的，再放；
   * 放不出来就把原因说出来，别静悄悄地什么都不发生。 */
  api.onBell((o) => {
    const id = (o && o.id) || B.current();
    Bell.play({ id, vol: (o && o.vol) || 70, times: (o && o.times) || 3 })
      .then((r) => {
        if (!r.ok) {
          toast('铃没响出来：' + r.why);
          console.error('[bell]', r.why, id);
        }
      });
  });
}

/* ---------------- 启动 ---------------- */
(async function boot() {
  bind();
  const s = await api.getState();
  applyState(s);
  B.refresh();
  const h = location.hash.replace('#', '');
  if (['today', 'review', 'stats', 'settings'].includes(h)) switchView(h);
})();

/* ---------------- 设置页左导航 ----------------
 * 点击平滑滚到分组，滚动时自动高亮当前分组（窄屏导航吸顶，宽屏贴左侧）。
 * 三处坑都在下面处理了：
 *  1. 窄屏导航吸顶会盖住目标标题，滚动位置得把它让出来，而且它可能换成
 *     两行（760 宽时挤），高度不能写死，得现量；
 *  2. 点完之后平滑滚动要几百毫秒，这期间会一路把路过的分组点亮，看着像
 *     点错了，所以点击后短暂上锁；
 *  3. 高亮没用 IntersectionObserver。它只在元素「进出状态变化」时回报：
 *     滚动中 A 一直待在带里没动、B 刚进带，回调里就只有 B，于是点亮 B——
 *     明明 A 才是当前那一组。改成每次滚动自己量位置，慢一点但不会错。
 */
(() => {
  const nav = document.getElementById('setNav');
  if (!nav) return;
  const links = [...nav.querySelectorAll('.set-link')];
  const scroller = document.querySelector('.body');
  const view = document.getElementById('view-settings');
  const narrow = matchMedia('(max-width: 999px)');
  const GAP = 12;
  let lockUntil = 0;

  const navOffset = () => (narrow.matches ? nav.getBoundingClientRect().height + GAP : GAP);
  const paint = (id) => links.forEach((l) => l.classList.toggle('on', l.dataset.sec === id));

  links.forEach((l) => {
    l.addEventListener('click', () => {
      const sec = document.getElementById(l.dataset.sec);
      if (!sec) return;
      const box = scroller.getBoundingClientRect();
      scroller.scrollTo({
        top: scroller.scrollTop + sec.getBoundingClientRect().top - box.top - navOffset(),
        behavior: 'smooth'
      });
      paint(l.dataset.sec);
      lockUntil = Date.now() + 800;
    });
  });

  function spy() {
    if (Date.now() < lockUntil || !view.classList.contains('on')) return;

    // 滚到底就指最后一组：它只有两百来高，顶边到不了参考线
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
      paint(links[links.length - 1].dataset.sec);
      return;
    }

    /* 参考线 = 滚动区上沿 + 吸顶导航让出来的距离，也就是内容真正露出来的地方。
     * 谁的顶边越过这条线，谁就是正在看的那一组。
     * 不用「视口中间划一条检测带」那套：窗口一高（1066 时带子从 204 开始），
     * 第一组只有 157 高、整组落在带子上方，从头到尾都不会亮。 */
    const line = scroller.getBoundingClientRect().top + navOffset();

    let cur = links[0].dataset.sec;
    for (const l of links) {
      const r = document.getElementById(l.dataset.sec).getBoundingClientRect();
      if (r.top <= line) cur = l.dataset.sec; else break;
    }

    const on = links.find((l) => l.classList.contains('on'));
    if (!on || on.dataset.sec !== cur) paint(cur);
  }

  /* 滚动里直接算，不用 requestAnimationFrame 节流：窗口不可见时浏览器不产生
   * 帧，rAF 会一直挂着不执行，切回来时高亮还是旧的。这里只量 7 个元素的位置，
   * 一帧跑一次不算负担。末尾再补一次，防止最后一下被吞掉。 */
  let settle = 0;
  scroller.addEventListener('scroll', () => {
    spy();
    clearTimeout(settle);
    settle = setTimeout(spy, 120);
  }, { passive: true });

  // 切回设置页要重算一次：别的页面滚过之后切回来，高亮还停在旧值
  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => setTimeout(spy, 80));
  });
})();
```

#### `renderer/bell.js` — 227 行

铃声：8 种音色现场合成 + 用户上传音频解码播放

```js
/* 铃声：内置音色全部现场合成，用户上传的音频走解码播放。
 *
 * 为什么内置不用 mp3：
 *   1) 单文件离线应用，音频资源越多越容易丢
 *   2) 合成音能按设置实时改音量、改次数，不必准备多份素材
 *   3) 音色是自己定义的，没有版权问题
 *
 * 为什么钟的声音不是单一正弦波：
 *   真实的铃由多个非整数倍泛音叠加而成，高次泛音衰减更快，
 *   所以听起来是"叮——"而不是"嘟"。每个音色都带自己的泛音配比。
 */
(function () {
  'use strict';

  var ctx = null;
  var master = null;
  var cache = {};        // id -> AudioBuffer（用户上传的音频解码后缓存）

  /* 泛音配比：非整数倍才有金属感 */
  var TONE = {
    metal: [{ mul: 1.00, amp: 1.00, d: 1.00 }, { mul: 2.01, amp: 0.42, d: 0.62 },
            { mul: 2.76, amp: 0.26, d: 0.46 }, { mul: 5.40, amp: 0.10, d: 0.26 }],
    pure:  [{ mul: 1.00, amp: 1.00, d: 1.00 }, { mul: 2.00, amp: 0.18, d: 0.55 }],
    dull:  [{ mul: 1.00, amp: 1.00, d: 1.00 }, { mul: 1.51, amp: 0.12, d: 0.30 }],
    bell:  [{ mul: 1.00, amp: 1.00, d: 1.00 }, { mul: 2.00, amp: 0.50, d: 0.72 },
            { mul: 3.01, amp: 0.30, d: 0.50 }, { mul: 4.16, amp: 0.16, d: 0.34 },
            { mul: 6.10, amp: 0.07, d: 0.20 }]
  };

  function ensure() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    return ctx;
  }

  function unlock() {
    var c = ensure();
    if (!c) return false;
    if (c.state === 'suspended') c.resume();
    return true;
  }

  /* ---------------- 内置音色 ---------------- */
  /* 每种音色 = 一串音符 + 一套泛音 + 一轮的整体长度
   * notes: [频率, 相对起始秒, 时长系数(可选)]
   */
  var RECIPES = {
    tomato: {
      name: '番茄铃', desc: '三声上行，用久了不烦', tone: TONE.metal, decay: 1.25,
      notes: [[659.25, 0], [830.61, 0.30], [987.77, 0.60]]
    },
    single: {
      name: '一响', desc: '干脆一声，不啰嗦', tone: TONE.metal, decay: 1.1,
      notes: [[880.00, 0]]
    },
    wood: {
      name: '木鱼', desc: '闷响两声，图书馆也不吵', tone: TONE.dull, decay: 0.42,
      notes: [[392.00, 0, 0.9], [392.00, 0.38, 0.8]]
    },
    alarm: {
      name: '老闹钟', desc: '双铃急促，戴耳机也跑不掉', tone: TONE.metal, decay: 0.16,
      notes: [[2093.0, 0], [2093.0, 0.09], [2093.0, 0.18], [2093.0, 0.27],
              [2093.0, 0.40], [2093.0, 0.49], [2093.0, 0.58], [2093.0, 0.67]]
    },
    beep: {
      name: '电子哔', desc: '三短声，像微波炉', tone: TONE.pure, decay: 0.14,
      wave: 'square',
      notes: [[1046.5, 0], [1046.5, 0.20], [1046.5, 0.40]]
    },
    chime: {
      name: '钟声', desc: '低沉悠长，深度工作时用', tone: TONE.bell, decay: 3.4,
      notes: [[261.63, 0]]
    },
    drop: {
      name: '水滴', desc: '清脆一落，打扰最小', tone: TONE.pure, decay: 0.55,
      glide: 0.45,
      notes: [[1400.0, 0]]
    },
    soft: {
      name: '轻提醒', desc: '很轻的一下，戴耳机时用', tone: TONE.pure, decay: 0.9,
      level: 0.45,
      notes: [[783.99, 0]]
    }
  };

  function recipeList() {
    return Object.keys(RECIPES).map(function (k) {
      return { id: k, name: RECIPES[k].name, desc: RECIPES[k].desc, builtin: true };
    });
  }

  function strike(freq, when, gain, decay, recipe) {
    var c = ctx;
    var tone = recipe.tone || TONE.metal;
    var wave = recipe.wave || 'sine';

    tone.forEach(function (p) {
      var osc = c.createOscillator();
      var env = c.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(freq * p.mul, when);

      // 水滴那种"往下掉"的感觉：频率在衰减中滑落
      if (recipe.glide) {
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(40, freq * p.mul * recipe.glide), when + decay * 0.8);
      }

      var peak = gain * p.amp;
      var len = decay * p.d;
      env.gain.setValueAtTime(0.0001, when);
      env.gain.exponentialRampToValueAtTime(peak, when + 0.006); // 6ms 起音，太快会爆音
      env.gain.exponentialRampToValueAtTime(0.0001, when + len);

      osc.connect(env);
      env.connect(master);
      osc.start(when);
      osc.stop(when + len + 0.05);
    });
  }

  function playRecipe(id, opts) {
    var r = RECIPES[id] || RECIPES.tomato;
    var gain = (opts.vol / 100) * 0.34 * (r.level || 1);
    if (gain < 0.0003) return false;             // 音量拉到 0 就别算了
    var last = r.notes[r.notes.length - 1][1];
    var cycle = Math.max(1.6, last + r.decay + 0.5);
    var now = ctx.currentTime + 0.02;
    for (var i = 0; i < opts.times; i++) {
      var base = now + i * cycle;
      r.notes.forEach(function (n) {
        strike(n[0], base + n[1], gain, r.decay * (n[2] || 1), r);
      });
    }
    return true;
  }

  /* ---------------- 用户上传的音频 ---------------- */
  function decode(base64) {
    var bin = atob(base64);
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return ctx.decodeAudioData(bytes.buffer);
  }

  function playBuffer(buf, opts) {
    var gain = (opts.vol / 100) * 0.9;           // 用户自己的音频，留足动态
    if (gain < 0.0003) return false;
    var cycle = Math.max(0.3, buf.duration + 0.35);
    var now = ctx.currentTime + 0.02;
    for (var i = 0; i < opts.times; i++) {
      var src = ctx.createBufferSource();
      var g = ctx.createGain();
      src.buffer = buf;
      g.gain.value = gain;
      src.connect(g);
      g.connect(master);
      src.start(now + i * cycle);
    }
    return true;
  }

  /* 统一入口：id 命中内置音色就合成，否则去主进程取音频文件 */
  function play(opts) {
    opts = opts || {};
    var c = ensure();
    if (!c) return Promise.resolve({ ok: false, why: '这个系统不支持 Web Audio' });
    if (c.state === 'suspended') c.resume();

    var vol = typeof opts.vol === 'number' ? opts.vol : 70;
    var times = Math.max(1, Math.min(9, opts.times || 3));
    var id = opts.id || 'tomato';

    if (RECIPES[id]) {
      var ok = playRecipe(id, { vol: vol, times: times });
      return Promise.resolve({ ok: ok, mode: 'synth', why: ok ? '' : '音量为 0' });
    }

    if (cache[id]) {
      var ok2 = playBuffer(cache[id], { vol: vol, times: times });
      return Promise.resolve({ ok: ok2, mode: 'file', why: ok2 ? '' : '音量为 0' });
    }

    // 自定义铃声第一次响时要先解码，之后走缓存
    if (!window.api || !window.api.getSound) {
      return Promise.resolve({ ok: false, why: '拿不到音频接口' });
    }
    return window.api.getSound(id).then(function (res) {
      if (!res || !res.ok) return { ok: false, why: (res && res.why) || '读不到这个音频' };
      return decode(res.data).then(function (buf) {
        cache[id] = buf;
        var ok3 = playBuffer(buf, { vol: vol, times: times });
        return { ok: ok3, mode: 'file', why: ok3 ? '' : '音量为 0' };
      });
    }).catch(function (e) {
      return { ok: false, why: '这个格式解不开：' + (e && e.message ? e.message : '未知') };
    });
  }

  function clearCache(id) {
    if (id) delete cache[id];
    else cache = {};
  }

  window.Bell = {
    unlock: unlock,
    play: play,
    recipes: recipeList,
    isReady: function () { return !!ctx && ctx.state === 'running'; },
    state: function () { return ctx ? ctx.state : 'none'; },
    clearCache: clearCache
  };

  // 任何一次真实交互都把音频上下文解出来，之后到点才响得出来
  ['pointerdown', 'keydown'].forEach(function (ev) {
    window.addEventListener(ev, function once() {
      unlock();
      window.removeEventListener(ev, once);
    }, { once: true });
  });
})();
```

### 测试与构建工具（审布局可跳过）

#### `build/dev.js` — 106 行

开发启动器：调试端口、目录热重载、沙盒数据隔离

```js
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

const sandboxRoot = path.join(os.tmpdir(), 'cet4-pomodoro-sandbox');

console.log('');
console.log(sandbox ? '  ▸ 沙盒测试模式' : '  ▸ 开发模式');
console.log('  ─────────────────────────────────────────────');
if (sandbox) {
  console.log('  数据目录   ' + sandboxRoot);
  console.log('             （临时目录，删掉等于恢复出厂）');
  console.log('  真实数据   完全不会被写入');
} else {
  console.log('  数据目录   ' + path.join(process.env.APPDATA || '', 'cet4-pomodoro'));
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
```

#### `build/cdp.js` — 67 行

CDP 单行求值工具

```js
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
```

#### `build/e2e.js` — 968 行

端到端测试 21 条：真启动 + 真截图 + 真测波形

```js
#!/usr/bin/env node
// 端到端自测：在沙盒里启动应用 → 走一遍主要操作 → 每步截图 → 出报告
// 你不需要打开任何东西。我在后台跑完，把截图发给你看。
//
// 用法：
//   npm run e2e              跑完整流程，结束后自动关掉窗口
//   npm run e2e -- --keep    跑完留着窗口，你可以接着手动点

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT || 9333);
const SHOT_DIR = path.join(__dirname, 'shots');
const KEEP = process.argv.includes('--keep');

fs.mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- CDP 小客户端 ---------------- */
function fetchTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/json', timeout: 1500 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

async function waitForPage(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await fetchTargets();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch (e) { /* 还没起来 */ }
    await sleep(300);
  }
  throw new Error('等不到调试端口 ' + PORT + '，应用可能没起来');
}

async function openClient() {
  const page = await waitForPage(45000);
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  let id = 0;
  const pending = new Map();
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });

  const send = (method, params) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });

  const evaluate = async (body) => {
    const res = await send('Runtime.evaluate', {
      expression: `(async () => { ${body} })()`,
      awaitPromise: true,
      returnByValue: true
    });
    const r = res.result || {};
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error((d.exception && d.exception.description) || d.text || '页面里报错了');
    }
    return r.result ? r.result.value : undefined;
  };

  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    if (!r.result || !r.result.data) throw new Error('截图失败');
    const file = path.join(SHOT_DIR, name + '.png');
    fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    return file;
  };

  return { send, evaluate, shot, close: () => ws.close() };
}

/* ---------------- 主流程 ---------------- */
async function run() {
  console.log('\n  番茄四六级 · 自动化自测');
  console.log('  ────────────────────────────────');
  console.log('  沙盒目录  ' + path.join(process.env.TEMP || '', 'cet4-pomodoro-sandbox'));
  console.log('  截图目录  ' + SHOT_DIR);
  console.log('');

  // 旧截图先清掉，避免新旧混在一起看不出这次的结果
  try {
    fs.readdirSync(SHOT_DIR).filter((f) => /\.png$/i.test(f)).forEach((f) => {
      fs.unlinkSync(path.join(SHOT_DIR, f));
    });
  } catch (e) { /* ignore */ }

  const child = spawn(process.execPath, [path.join(__dirname, 'dev.js'), '--sandbox', '--fresh', '--port=' + PORT], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const appLog = [];
  child.stdout.on('data', (d) => appLog.push(d.toString()));
  child.stderr.on('data', (d) => appLog.push(d.toString()));

  let appExited = false;
  child.on('exit', () => { appExited = true; });

  let client = null;
  let diedEarly = false;

  try {
    client = await openClient();
    console.log('[' + stamp() + '] 已连上应用');

    for (let i = 0; i < 40; i++) {
      const ready = await client.evaluate('return !!(window.ST && document.querySelector(".view.on"))');
      if (ready) break;
      await sleep(250);
    }

    /* 音频探针要在页面一就绪就装上，不能等跑到铃声用例才装。
     * bell.js 的 context 是懒创建的，master→destination 只在创建那一次连；
     * 等用例里再挂 hook，如果 context 已经被别的功能创建过，这条连接就永远接不到，
     * 于是 AnalyserNode 一直拿不到信号、峰值恒为 0 —— 看起来像"铃声坏了"。
     * 装在这里，无论 context 什么时候建，都能拦到那次连接。 */
    await client.evaluate(`
      if (!window.__probe) {
        const orig = AudioNode.prototype.connect;
        AudioNode.prototype.connect = function (dest) {
          const n = dest && dest.constructor ? dest.constructor.name : '';
          if (n === 'AudioDestinationNode') {
            const an = this.context.createAnalyser();
            an.fftSize = 2048;
            orig.call(this, an); orig.call(an, dest);
            window.__probe = an;
            return dest;
          }
          return orig.apply(this, arguments);
        };
      }
      return 1;
    `);

    /* 1. 首屏 */
    {
      const s = await client.evaluate(`
        const on = document.querySelector('.view.on');
        return {
          view: on ? on.id : null,
          stage: (document.querySelector('#stageBadge') || {}).textContent || '',
          plans: [...document.querySelectorAll('.pitem')].map(x => (x.querySelector('.pname') || {}).textContent || ''),
          grid: [...document.querySelectorAll('#todayGrid .snum')].map(x => x.textContent),
          hasPlay: !!document.querySelector('[data-play="0"]')
        };
      `);
      const file = await client.shot('01-首屏-今日');
      const ok = s.view === 'view-today' && s.plans.length >= 3 && s.hasPlay;
      results.push({
        name: '首屏渲染', ok, file,
        note: `阶段 ${s.stage} · 今日任务 ${s.plans.length} 条 · 统计 ${s.grid.join(' / ')}`
      });
      console.log('[' + stamp() + '] 首屏 ' + s.plans.length + ' 条任务');
    }

    /* 2. 开始计时，确认数字在走 */
    {
      const s = await client.evaluate(`
        const b = document.querySelector('[data-play="0"]');
        if (!b) return { err: '没有开始按钮' };
        b.click();
        await new Promise(r => setTimeout(r, 1200));
        const a = (document.querySelector('#timerNum') || {}).textContent;
        await new Promise(r => setTimeout(r, 1400));
        const b2 = (document.querySelector('#timerNum') || {}).textContent;
        return {
          a, b: b2,
          running: a !== b2,
          stage: (document.querySelector('#timerStage') || {}).textContent || '',
          sub: (document.querySelector('#timerSub') || {}).textContent || '',
          btns: [...document.querySelectorAll('#timerActions button')].map(x => x.textContent.trim())
        };
      `);
      const file = await client.shot('02-专注中');
      const ok = !s.err && s.running;
      results.push({
        name: '开始一个番茄', ok, file,
        note: s.err || `${s.a} → ${s.b} · ${s.stage} ${s.sub} · 按钮「${s.btns.join(' ')}」`
      });
      console.log('[' + stamp() + '] 计时 ' + (s.err || s.a + ' → ' + s.b));
    }

    /* 3. 暂停 */
    {
      const s = await client.evaluate(`
        const p = document.querySelector('#pauseBtn');
        if (!p) return { err: '没有暂停按钮' };
        p.click();
        await new Promise(r => setTimeout(r, 700));
        const a = (document.querySelector('#timerNum') || {}).textContent;
        await new Promise(r => setTimeout(r, 1000));
        const b = (document.querySelector('#timerNum') || {}).textContent;
        return { a, b, frozen: a === b, label: p.textContent.trim() };
      `);
      const file = await client.shot('03-已暂停');
      const ok = !s.err && s.frozen;
      results.push({
        name: '暂停后时间冻结', ok, file,
        note: s.err || (s.frozen ? `停在 ${s.a} · 按钮变「${s.label}」` : `仍在走：${s.a} → ${s.b}`)
      });
      console.log('[' + stamp() + '] 暂停 ' + (s.frozen ? '已冻结' : '没冻住'));
      await client.evaluate(`const p = document.querySelector('#pauseBtn'); if (p) p.click(); return 1;`);
    }

    /* 4. 记干扰 */
    {
      const s = await client.evaluate(`
        const b = document.querySelector('#itrBtn');
        if (!b) return { err: '没有干扰按钮' };
        b.click();
        await new Promise(r => setTimeout(r, 400));
        const input = document.querySelector('#itrInput');
        if (!input) return { err: '弹窗没打开' };
        input.value = '回了一条微信';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const ok = document.querySelector('[data-act="ok"]');
        if (ok) ok.click();
        await new Promise(r => setTimeout(r, 600));
        return { hint: (document.querySelector('#timerHint') || {}).textContent || '' };
      `);
      const file = await client.shot('04-记下一次干扰');
      results.push({
        name: '记下一次干扰', ok: !s.err, file,
        note: s.err || ('提示栏：' + s.hint.slice(0, 46))
      });
      console.log('[' + stamp() + '] 干扰 ' + (s.err || '已记下'));
    }

    /* 5. 放弃 → 不计入番茄 */
    {
      const s = await client.evaluate(`
        const b = document.querySelector('#abortBtn');
        if (!b) return { err: '没有放弃按钮' };
        b.click();
        await new Promise(r => setTimeout(r, 400));
        const title = (document.querySelector('.mhead') || {}).textContent || '';
        const ok = document.querySelector('[data-act="ok"]');
        if (!ok) return { err: '确认框没出来' };
        ok.click();
        await new Promise(r => setTimeout(r, 900));
        return {
          title,
          stage: (document.querySelector('#timerStage') || {}).textContent || '',
          grid: [...document.querySelectorAll('#todayGrid .snum')].map(x => x.textContent)
        };
      `);
      const file = await client.shot('05-放弃之后');
      const done = Number((s.grid || [])[0]);
      results.push({
        name: '放弃的番茄不计入', ok: !s.err && done === 0, file,
        note: s.err || `确认框「${s.title}」· 番茄数仍是 ${done}`
      });
      console.log('[' + stamp() + '] 放弃 番茄数=' + done);
    }

    /* 5b. 暂停中被另一个任务顶掉：旧番茄必须留一条「作废」。
     * 界面上 .pplay 有前置拦截（非 idle 就 toast 不让点），所以这条路要走主进程接口
     * 才会碰上 —— 托盘菜单、以后的快捷键、自动化脚本都可能绕开界面那一层。
     * 以前 T 被整个覆盖，既不放弃也不记录，账上凭空少一段。 */
    {
      const s = await client.evaluate(`
        const rows = [...document.querySelectorAll('.pitem')];
        if (rows.length < 2) return { err: '计划只有 ' + rows.length + ' 条' };
        const nameOf = (i) => rows[i].querySelector('.pname').textContent;
        const first = nameOf(0), second = nameOf(1);

        document.querySelectorAll('.pplay')[0].click();
        await new Promise(r => setTimeout(r, 500));
        document.querySelector('#pauseBtn').click();
        await new Promise(r => setTimeout(r, 400));
        const paused = ST.timer.paused;

        // 绕开界面直接进主进程
        const r = await api.startTimer(ST.today.plan[1], 1);
        await new Promise(r => setTimeout(r, 700));
        const top = ST.logs[0] || {};
        const running = ST.timer.name;
        await api.abortTimer();
        await new Promise(r => setTimeout(r, 400));
        return { first, second, paused, ok: r && r.ok, topName: top.name, topStatus: top.status, running };
      `);
      const ok = s.paused === true && s.ok === true && s.topStatus === 'abort'
        && s.topName === s.first && s.running === s.second;
      results.push({
        name: '暂停中被顶掉记作废', ok,
        note: s.err || (`「${s.first}」暂停中 → 直接开「${s.second}」→ `
          + `记录里留下 ${s.topStatus || '（空）'}「${s.topName || ''}」· 计时器转到「${s.running}」`)
      });
      console.log('[' + stamp() + '] 暂停顶掉 → ' + (s.topStatus || '-') + ' ' + (s.topName || ''));
    }

    /* 6. 复习页：新词先看不考 */
    {
      const s = await client.evaluate(`
        document.querySelector('[data-view="review"]').click();
        await new Promise(r => setTimeout(r, 800));
        return {
          view: (document.querySelector('.view.on') || {}).id,
          prog: (document.querySelector('.fcprog') || {}).textContent || '',
          word: (document.querySelector('.fcfront') || {}).textContent || '',
          isNew: !!document.querySelector('#learnedBtn'),
          hasQuiz: !!document.querySelector('#fcard')
        };
      `);
      const file = await client.shot('06-复习页');
      const ok = s.view === 'view-review' && !!s.word;
      results.push({
        name: '复习页出卡', ok, file,
        note: ok ? `${s.prog} · ${s.isNew ? '新词模式（先看一遍）' : '测验模式'}` : '没有卡片，词库可能没铺进去'
      });
      console.log('[' + stamp() + '] 复习页 ' + (s.word || '没有卡片'));
    }

    /* 7. 新词：看过了，下一个 */
    {
      const s = await client.evaluate(`
        const b = document.querySelector('#learnedBtn');
        if (!b) return { skip: true };
        const before = (document.querySelector('.fcprog') || {}).textContent || '';
        b.click();
        await new Promise(r => setTimeout(r, 800));
        return {
          before,
          after: (document.querySelector('.fcprog') || {}).textContent || '',
          word: (document.querySelector('.fcfront') || {}).textContent || ''
        };
      `);
      if (s.skip) {
        results.push({ name: '新词先看一遍', ok: true, note: '这批没有新词，跳过' });
      } else {
        const file = await client.shot('07-下一个新词');
        results.push({
          name: '新词先看一遍，不立刻考', ok: s.before !== s.after, file,
          note: `${s.before} → ${s.after}`
        });
      }
      console.log('[' + stamp() + '] 新词 ' + (s.skip ? '跳过' : '已推进'));
    }

    /* 8. 测验模式：翻面 → 打分（沙盒钩子把卡改成已到期，省掉等 10 分钟） */
    {
      const seeded = await client.evaluate(`
        const n = await window.api.devMakeDue(3);
        document.querySelector('[data-view="today"]').click();
        await new Promise(r => setTimeout(r, 250));
        document.querySelector('[data-view="review"]').click();
        await new Promise(r => setTimeout(r, 900));
        return { n, hasCard: !!document.querySelector('#fcard') };
      `);

      const s = await client.evaluate(`
        const card = document.querySelector('#fcard');
        if (!card) return { err: '没有测验卡片' };
        card.click();
        await new Promise(r => setTimeout(r, 450));
        return {
          back: (document.querySelector('.fcback') || {}).textContent || '',
          rates: [...document.querySelectorAll('.rate')].map(b => b.textContent.replace(/\\s+/g, ' ').trim())
        };
      `);
      const file = await client.shot('08-翻面看释义');

      const s2 = await client.evaluate(`
        const b = document.querySelector('.rate.good');
        if (!b) return { err: '没有评分按钮' };
        const before = (document.querySelector('.fcprog') || {}).textContent || '';
        b.click();
        await new Promise(r => setTimeout(r, 800));
        return { before, after: (document.querySelector('.fcprog') || {}).textContent || '' };
      `);

      const ok = !s.err && !s2.err && !!s.back;
      results.push({
        name: '翻面并打分', ok, file,
        note: s.err || s2.err || `造出 ${seeded.n} 张到期卡 · 释义「${s.back.slice(0, 26)}」· 评级按钮 ${s.rates.length} 个 · ${s2.before} → ${s2.after}`
      });
      console.log('[' + stamp() + '] 打分 ' + (s.err || (s.back || '').slice(0, 24)));
    }

    /* 8b. 复习页键盘：空格翻面、数字键评分。
     * 每天几十次点击全在这页，键盘是性价比最高的一处；但抢错事件（比如按钮聚焦时
     * 也接空格）会点两次，所以这条要真的按两次键看队列有没有跳两格。 */
    {
      const s = await client.evaluate(`
        api.devMakeDue(3);
        document.querySelector('[data-view="review"]').click();
        await new Promise(r => setTimeout(r, 800));

        const key = (k, code) => document.body.dispatchEvent(
          new KeyboardEvent('keydown', { key: k, code: code || '', bubbles: true, cancelable: true }));

        const first = document.querySelector('.fcprog').textContent.trim();
        const before = !!document.querySelector('#fcard.revealed');
        key(' ', 'Space');
        await new Promise(r => setTimeout(r, 400));
        const after = !!document.querySelector('#fcard.revealed');

        key('3');
        await new Promise(r => setTimeout(r, 700));
        const second = (document.querySelector('.fcprog') || {}).textContent || '';
        return { first, before, after, second, typed: first !== second };
      `);
      const ok = s.before === false && s.after === true && s.typed === true;
      results.push({
        name: '复习页键盘', ok,
        note: `空格翻面 ${s.before ? '（本来已翻）' : '否 → 是'} · 按 3 后从「${(s.first || '').split(' ·')[0]}」`
          + ` 进到「${(s.second || '').split(' ·')[0]}」`
      });
      console.log('[' + stamp() + '] 键盘 空格翻面=' + s.after + ' 数字评分=' + s.typed);
    }

    /* 9. 记录页 */
    {
      const s = await client.evaluate(`
        document.querySelector('[data-view="stats"]').click();
        await new Promise(r => setTimeout(r, 900));
        return {
          view: (document.querySelector('.view.on') || {}).id,
          svg: document.querySelectorAll('.view.on svg').length,
          text: (document.querySelector('.view.on') || {}).innerText.slice(0, 100)
        };
      `);
      const file = await client.shot('09-记录页');
      results.push({
        name: '记录页与遗忘曲线', ok: s.view === 'view-stats' && s.svg >= 1, file,
        note: `${s.svg} 个图表`
      });
      console.log('[' + stamp() + '] 记录页 ' + s.svg + ' 个图表');
    }

    /* 10. 设置页 */
    {
      const s = await client.evaluate(`
        document.querySelector('[data-view="settings"]').click();
        await new Promise(r => setTimeout(r, 800));
        return {
          view: (document.querySelector('.view.on') || {}).id,
          rows: document.querySelectorAll('.view.on .srow, .view.on .setrow, .view.on .setting').length,
          text: (document.querySelector('.view.on') || {}).innerText.slice(0, 90)
        };
      `);
      const file = await client.shot('10-设置页');
      results.push({ name: '设置页', ok: s.view === 'view-settings', file, note: `${s.rows} 个设置行` });
      console.log('[' + stamp() + '] 设置页 ' + s.rows + ' 行');
    }

    /* 11. 换成六级词池 */
    {
      const s = await client.evaluate(`
        const btn = document.querySelector('#segLevel button[data-v="cet6"]');
        if (!btn) return { err: '没有六级按钮' };
        btn.click();
        await new Promise(r => setTimeout(r, 900));
        return {
          level: ST.settings.level,
          total: ST.pool.total,
          only6: ST.pool.only6,
          note: (document.querySelector('#levelNote') || {}).textContent || '',
          on: [...document.querySelectorAll('#segLevel button')].filter(b => b.classList.contains('on')).map(b => b.dataset.v),
          cards: ST.totalCards
        };
      `);
      const file = await client.shot('11-六级词池');
      const ok = !s.err && s.level === 'cet6' && s.total > 6000 && s.only6 > 2000
        && (s.on || []).includes('cet6');
      results.push({
        name: '换成六级词池', ok, file,
        note: s.err || `池 ${s.total} 词 · 六级新增 ${s.only6} · 手上卡片仍是 ${s.cards} 张`
      });
      console.log('[' + stamp() + '] 六级 ' + (s.err || s.total + ' 词 / 新增 ' + s.only6));
    }

    /* 12. 填考试日期 → 倒推配速 */
    {
      const s = await client.evaluate(`
        const el = document.querySelector('#setExam');
        if (!el) return { err: '没有考试日期输入框' };
        el.value = '2026-12-19';
        el.dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 900));
        return {
          days: ST.pool.days,
          hidden: (document.querySelector('#rowPace') || {}).hidden,
          pace: (document.querySelector('#paceText') || {}).textContent || '',
          pool: (document.querySelector('#poolBar') || {}).innerText || ''
        };
      `);
      const file = await client.shot('12-考试配速');
      const ok = !s.err && !s.hidden && s.days > 0 && /还剩 \d+ 天/.test(s.pace);
      results.push({ name: '按考试日期算配速', ok, file, note: s.err || s.pace.slice(0, 70) });
      console.log('[' + stamp() + '] 配速 ' + (s.err || s.days + ' 天'));
    }

    /* 12b. 发词按词频排序
     * 这条不走界面，直接查词池的顺序性质 —— 因为"下一个发什么"完全由
     * wordPool 的顺序决定，界面只是照着发。要验的是"确实从常用往生僻走"，
     * 而不是"我写了排序代码"。
     */
    {
      const D = require('../src/data');
      const F = require('../src/word-freq.json');
      const pool = D.wordPool('cet4');
      const body = pool.slice(100); // 跳过核心 100，它们手工排在前面不参与排序
      const ranks = body.map((w) => F[w.front.toLowerCase()]).filter((r) => typeof r === 'number');
      const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;

      const headAvg = Math.round(avg(ranks.slice(0, 100)));
      const allAvg = Math.round(avg(ranks));
      // 前 300 个里不该混进生僻词；专有名词（China/Monday）更不该占名额
      const maxHead = Math.max(...ranks.slice(0, 300));
      const capsInHead = body.slice(0, 20).filter((w) => /^[A-Z]/.test(w.front)).length;
      // of / page 这类基础词必须被压到后半段
      const ofAt = pool.findIndex((w) => w.front.toLowerCase() === 'of');
      const ofLate = ofAt > pool.length * 0.7;

      const ok = headAvg < 1500 && allAvg > 5000 && maxHead <= 8000 && capsInHead === 0 && ofLate;
      const note = `前100均rank ${headAvg} · 全程均rank ${allAvg}`
        + ` · 前300最大rank ${maxHead} · 大写词 ${capsInHead} 个 · of 在第 ${ofAt + 1} 位`;

      results.push({ name: '发词按词频排序', ok, note });
      console.log('[' + stamp() + '] 词频 ' + note);
    }

    /* 13. 铃声：不只看被调用，要在音频输出链上量到波形 */
    {
      const s = await client.evaluate(`
        // 探针在启动时就装好了（见上面），这里只管量
        const items = document.querySelectorAll('#bellGrid .bellitem').length;
        const btn = document.querySelector('#bellTest');

        async function measure(ms) {
          let peak = 0;
          const end = performance.now() + ms;
          while (performance.now() < end) {
            await new Promise(r => setTimeout(r, 60));
            const an = window.__probe;
            if (!an) continue;
            const b = new Float32Array(an.fftSize);
            an.getFloatTimeDomainData(b);
            let sum = 0;
            for (let k = 0; k < b.length; k++) sum += b[k] * b[k];
            const rms = Math.sqrt(sum / b.length);
            if (rms > peak) peak = rms;
          }
          return peak;
        }

        // 偶尔第一下量到 0：音频上下文刚被唤醒，或试听前一秒还在解码。
        // 真没声音的话三次都会是 0，所以重试不会把坏的测成好的。
        let peak = 0, tries = 0;
        for (let i = 0; i < 3 && peak <= 0.003; i++) {
          tries++;
          if (btn) btn.click();
          const p = await measure(1000);
          if (p > peak) peak = p;
          if (peak <= 0.003) await new Promise(r => setTimeout(r, 300));
        }
        return { items, peak: +peak.toFixed(4), tries, state: Bell ? Bell.state() : 'none' };
      `);
      const file = await client.shot('13-铃声');
      const ok = s.items >= 8 && s.peak > 0.003;
      results.push({
        name: '铃声真的出声', ok, file,
        note: `${s.items} 种音色 · 输出峰值 ${s.peak}${s.tries > 1 ? `（第 ${s.tries} 次才量到）` : ''} · 音频上下文 ${s.state}`
      });
      console.log('[' + stamp() + '] 铃声 ' + s.items + ' 种，峰值 ' + s.peak);
    }

    /* 12. 主进程通道与沙盒隔离 */
    {
      const s = await client.evaluate(`
        return {
          api: typeof window.api,
          keys: window.api ? Object.keys(window.api).length : 0,
          theme: document.documentElement.dataset.theme,
          storage: location.protocol
        };
      `);
      results.push({
        name: '主进程通道', ok: s.api === 'object' && s.keys > 20,
        note: `暴露 ${s.keys} 个接口 · 主题 ${s.theme}`
      });
      console.log('[' + stamp() + '] 接口 ' + s.keys + ' 个');
    }

    /* 14. 单词朗读：和铃声一样，要求量到真实输出波形。
     * 只验证"函数被调用了"没有意义——之前就吃过这个亏。 */
    {
      const s = await client.evaluate(`
        const st = await api.ttsStatus();
        if (!st.ok) return { ok: false, why: '引擎不可用' };

        if (!window.__probe) {
          const orig = AudioNode.prototype.connect;
          AudioNode.prototype.connect = function (dest) {
            const n = dest && dest.constructor ? dest.constructor.name : '';
            if (n === 'AudioDestinationNode') {
              const an = this.context.createAnalyser();
              an.fftSize = 2048;
              orig.call(this, an); orig.call(an, dest);
              window.__probe = an;
              return dest;
            }
            return orig.apply(this, arguments);
          };
        }

        const t0 = performance.now();
        const p = speak('abandon');
        let peak = 0;
        for (let i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 60));
          const an = window.__probe;
          if (!an) continue;
          const b = new Float32Array(an.fftSize);
          an.getFloatTimeDomainData(b);
          let sum = 0;
          for (let k = 0; k < b.length; k++) sum += b[k] * b[k];
          const rms = Math.sqrt(sum / b.length);
          if (rms > peak) peak = rms;
        }
        await p;
        const cold = Math.round(performance.now() - t0);

        // 第二次应当命中缓存
        const t1 = performance.now();
        const r2 = await api.sayWord('abandon');
        const warm = Math.round(performance.now() - t1);

        return { ok: true, peak: +peak.toFixed(4), cold, warm, hit: !!(r2 && r2.hit), voices: st.voices.length };
      `);
      const file = await client.shot('14-朗读');
      const ok = s.ok && s.peak > 0.01 && s.hit && s.warm < s.cold;
      results.push({
        name: '单词朗读真的出声', ok, file,
        note: s.ok
          ? `输出峰值 ${s.peak} · 首次 ${s.cold}ms · 缓存 ${s.warm}ms · ${s.voices} 个音色`
          : s.why
      });
      console.log('[' + stamp() + '] 朗读 峰值 ' + s.peak + ' 首次 ' + s.cold + 'ms 缓存 ' + s.warm + 'ms');
    }

    /* 15. 语速切换：慢速的音频应该比正常更长 */
    {
      const s = await client.evaluate(`
        await api.setSettings({ voicePace: 'normal' });
        const a = await api.sayWord('vocabulary');
        await api.setSettings({ voicePace: 'slow' });
        const b = await api.sayWord('vocabulary');
        await api.setSettings({ voicePace: 'normal' });
        return { ok: true, aLen: a.ok ? a.data.length : 0, bLen: b.ok ? b.data.length : 0 };
      `);
      const ok = s.aLen > 0 && s.bLen > s.aLen;
      results.push({
        name: '语速切换真的变慢', ok,
        note: `正常 ${s.aLen} 字节 → 慢速 ${s.bLen} 字节`
      });
      console.log('[' + stamp() + '] 语速 ' + s.aLen + ' → ' + s.bLen + ' 字节');
    }

    /* 16. 宽屏仍是单列
     * 这个窗口只有 900 宽。用 CDP 把视口临时改成 1440×900，量「内容列宽 /
     * 计划行有没有被拉宽 / 旧两栏的残留结构是否真的清掉了」。
     * 布局是刻意做成固定 780 单列的：拉宽会让行内两端距离散开，所以这里守的是
     * 「宽了也不变形」，不是「宽了要变形」。 */
    {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: 1440, height: 900, deviceScaleFactor: 1, mobile: false
      });
      await sleep(400);
      const wide = await client.evaluate(`
        switchView('today');
        await new Promise(r => setTimeout(r, 300));
        const v = document.querySelector('#view-today').getBoundingClientRect();
        const plan = document.querySelector('#planList').getBoundingClientRect();
        return {
          vw: innerWidth,
          viewW: Math.round(v.width),
          viewLeft: Math.round(v.left),
          planW: Math.round(plan.width),
          side: document.querySelector('.review-side') ? 'exists' : 'gone'
        };
      `);

      await client.send('Emulation.setDeviceMetricsOverride', {
        width: 900, height: 700, deviceScaleFactor: 1, mobile: false
      });
      await sleep(400);
      const narrow = await client.evaluate(`
        const plan = document.querySelector('#planList').getBoundingClientRect();
        return { vw: innerWidth, planW: Math.round(plan.width),
                 side: document.querySelector('.review-side') ? 'exists' : 'gone' };
      `);
      await client.send('Emulation.clearDeviceMetricsOverride');
      await sleep(300);

      // 计划行 = 内容列 780 减去两侧各 26 的留白
      const ok = Math.abs(wide.viewW - 780) <= 2 && Math.abs(wide.planW - 728) <= 2
        && wide.side === 'gone'
        && Math.abs(narrow.planW - 728) <= 2 && narrow.side === 'gone';
      results.push({
        name: '宽屏仍是单列', ok,
        note: `1440 宽：内容 ${wide.viewW}px（左右各空 ${wide.viewLeft}）· 计划行 ${wide.planW}px · `
          + `旧两栏结构 ${wide.side === 'gone' ? '已清掉' : '还在'}；`
          + `900 宽：计划行 ${narrow.planW}px`
      });
      console.log('[' + stamp() + '] 宽屏 ' + wide.viewW + 'px 单列 · 计划行 ' + wide.planW + 'px');
    }

    /* 17. 设置页左导航
     * 设置页从「左右两栏（差 295px）」改成「左导航 + 单列」之后，真正要守的是
     * 三件事：宽屏导航贴左、窄屏收成顶部一条并且横向铺满（不铺满就挡不住从
     * 底下滚过去的卡片）、点导航能滚到位且标题不被吸顶条盖住。 */
    {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: 1440, height: 900, deviceScaleFactor: 1, mobile: false
      });
      await sleep(400);
      const wide = await client.evaluate(`
        switchView('settings');
        await new Promise(r => setTimeout(r, 350));
        const R = e => e.getBoundingClientRect();
        const nav = document.getElementById('setNav');
        const main = document.querySelector('.set-main');
        return {
          links: nav.querySelectorAll('.set-link').length,
          navX: Math.round(R(nav).left), mainX: Math.round(R(main).left),
          mainW: Math.round(R(main).width),
          dir: getComputedStyle(document.querySelector('.set-wrap')).flexDirection,
          on: document.querySelector('.set-link.on').dataset.sec
        };
      `);

      /* 高窗口：第一组只有 157 高。要是拿「视口 20%~35%」划检测带，
       * 1200 高时带子从 230 起，第一组整组在带子上方，从头到尾都不亮。
       * 用户把窗口最大化就有 1000+ 高，所以这条必须单独守。 */
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false
      });
      await sleep(400);
      const tall = await client.evaluate(`
        document.querySelector('.body').scrollTop = 0;
        await new Promise(r => setTimeout(r, 300));
        return document.querySelector('.set-link.on').dataset.sec;
      `);

      // 点「铃声」：等平滑滚动停下，看标题所在位置
      // 窄屏导航吸顶在顶部，要让位；宽屏导航竖在左边，比的是滚动区顶边
      const click = await client.evaluate(`
        document.querySelector('.set-link[data-sec=secBell]').click();
        await new Promise(r => setTimeout(r, 1100));
        const navBox = document.getElementById('setNav').getBoundingClientRect();
        const bodyTop = document.querySelector('.body').getBoundingClientRect().top;
        const h = document.querySelector('#secBell .blockhead h2').getBoundingClientRect();
        const isNarrow = matchMedia('(max-width: 999px)').matches;
        return {
          gap: Math.round(h.top - (isNarrow ? navBox.bottom : bodyTop)),
          on: document.querySelector('.set-link.on').dataset.sec
        };
      `);

      await client.send('Emulation.setDeviceMetricsOverride', {
        width: 900, height: 700, deviceScaleFactor: 1, mobile: false
      });
      await sleep(400);
      const narrow = await client.evaluate(`
        const b = document.querySelector('.body');
        b.scrollTop = 0;
        await new Promise(r => setTimeout(r, 250));
        const R = e => e.getBoundingClientRect();
        return {
          dir: getComputedStyle(document.querySelector('.set-wrap')).flexDirection,
          navW: Math.round(R(document.getElementById('setNav')).width),
          viewW: Math.round(R(document.getElementById('view-settings')).width)
        };
      `);

      // 滚到底：最后一组两百来高、进不了检测带，得靠「到底点亮最后一项」兜住
      const bottom = await client.evaluate(`
        const b = document.querySelector('.body');
        b.scrollTop = b.scrollHeight;
        await new Promise(r => setTimeout(r, 350));
        return document.querySelector('.set-link.on') && document.querySelector('.set-link.on').dataset.sec;
      `);

      await client.send('Emulation.clearDeviceMetricsOverride');
      await sleep(300);

      const ok = wide.links === 7 && wide.navX < wide.mainX && wide.dir === 'row' && wide.mainW >= 800
        && wide.on === 'secPrep' && tall === 'secPrep'
        && click.gap >= 8 && click.on === 'secBell'
        && narrow.dir === 'column' && Math.abs(narrow.navW - narrow.viewW) <= 2
        && bottom === 'secData';
      results.push({
        name: '设置页导航',
        ok,
        note: `1440 宽：${wide.links} 项贴左（导航 x${wide.navX} / 内容 x${wide.mainX} · 内容 ${wide.mainW}px）`
          + `· 顶部亮 ${wide.on} / 1200 高亮 ${tall}`
          + `· 点「铃声」标题落在顶边下 ${click.gap}px；`
          + `900 宽：导航 ${narrow.navW}/${narrow.viewW} ${narrow.dir === 'column' ? '在顶部铺满' : '仍在左侧'}`
          + `· 滚到底亮 ${bottom}`
      });
      console.log('[' + stamp() + '] 设置导航 ' + wide.links + ' 项 · 顶亮 ' + wide.on + '/' + tall + ' · 点铃声留 ' + click.gap + 'px · 到底亮 ' + bottom);
    }

    /* 18. 清空重来
     * 以前只有「导出 / 恢复」——恢复得先有一份导出的文件，等于从来没导出过的人
     * 数据脏了无路可退。这条守四件事：学习数据归零、设置保留、当天安排重新铺出
     * 来（不能留个空页面）、清空前的备份真的落在盘上（否则"能反悔"是句空话）。 */
    {
      const before = await client.evaluate(`
        return {
          cards: ST.totalCards, logs: ST.logs.length, pomo: ST.totals.pomodoros,
          level: ST.settings.level, dailyNew: ST.settings.dailyNew
        };
      `);

      const r = await client.evaluate(`
        const res = await api.resetData('learn');
        await new Promise(r => setTimeout(r, 700));
        return {
          ok: !!res.ok, why: res.msg || '', backup: res.backup || '',
          cards: ST.totalCards, logs: ST.logs.length, pomo: ST.totals.pomodoros,
          plan: ST.today.plan.length, level: ST.settings.level, dailyNew: ST.settings.dailyNew,
          today: ST.today.sessions, topStat: document.getElementById('todayStat').textContent
        };
      `);

      const bakExists = !!r.backup && fs.existsSync(r.backup);
      const ok = r.ok && bakExists
        && r.cards > 0 && r.cards <= before.dailyNew
        && r.logs === 0 && r.pomo === 0 && r.today === 0
        && r.plan === 4
        && r.level === before.level && r.dailyNew === before.dailyNew;

      results.push({
        name: '清空重来', ok,
        note: r.why || (`清空前 ${before.cards} 张卡 / ${before.logs} 条记录 → 清空后 ${r.cards} 张（当天该发的）· `
          + `记录 ${r.logs} 条 · 今日安排 ${r.plan} 条 · 设置保留 ${r.level}/${r.dailyNew} · `
          + `备份 ${bakExists ? '已落盘' : '没找到'} · 首页「${r.topStat}」`)
      });
      console.log('[' + stamp() + '] 清空 ' + before.cards + '→' + r.cards + ' 张 · 记录 ' + before.logs + '→' + r.logs
        + ' · 备份 ' + (bakExists ? 'ok' : '缺失'));
    }

    /* 19. 界面材质（亚克力 / 云母）
     * 毛玻璃是 DWM 画的，CDP 截不到，所以这里守的是"让路"这一半：body 挂上 mat、
     * html 与 body 都透、面板变半透明。真正的 setBackgroundMaterial 只能看主进程
     * 日志里那行 [material]，这里退一步确认「设置值确实落库、能切回去」。
     * 这条最容易退化的地方是 html 那层——只透明 body 的话，页面上看什么都没变，
     * 但代码"看起来是对的"。 */
    {
      const on = await client.evaluate(`
        await api.setSettings({ material: 'mica' });
        await new Promise(r => setTimeout(r, 420));
        const g = (el) => getComputedStyle(el).backgroundColor;
        const alpha = (c) => {
          const m = c.match(/rgba?\\(([^)]+)\\)/);
          if (!m) return 1;
          const p = m[1].split(',');
          return p.length > 3 ? Number(p[3]) : 1;
        };
        // 清空那条用例最后停在首页，那里没有 .card，退到计时器卡片上量
        const box = document.querySelector('.card') || document.querySelector('.timer-card')
          || document.querySelector('.pitem');
        return {
          mat: document.body.classList.contains('mat'),
          bodyA: alpha(g(document.body)),
          htmlA: alpha(g(document.documentElement)),
          cardA: box ? alpha(g(box)) : -1,
          setting: ST.settings.material, ok: ST.materialOk
        };
      `);

      const off = await client.evaluate(`
        await api.setSettings({ material: 'solid' });
        await new Promise(r => setTimeout(r, 420));
        return {
          mat: document.body.classList.contains('mat'),
          bg: getComputedStyle(document.body).backgroundColor,
          setting: ST.settings.material
        };
      `);

      const solidBack = /^rgb\(15, 17, 21\)$/.test(off.bg) || /rgba\(15, 17, 21, 1\)/.test(off.bg);
      const ok = on.ok !== false && on.mat && on.setting === 'mica'
        && on.bodyA < 1 && on.htmlA === 0 && on.cardA < 1
        && !off.mat && off.setting === 'solid' && solidBack;

      results.push({
        name: '界面材质', ok,
        note: `云母：body ${on.bodyA} / html ${on.htmlA} / 卡片 ${on.cardA}（都该 < 1 或 = 0）· `
          + `设置值 ${on.setting} · 系统支持 ${on.ok ? '是' : '否'}；切回纯色：body ${off.bg}`
      });
      console.log('[' + stamp() + '] 材质 bodyA=' + on.bodyA + ' htmlA=' + on.htmlA
        + ' cardA=' + on.cardA + ' → 纯色 ' + off.bg);
    }

  } catch (e) {
    results.push({ name: '执行中断', ok: false, note: e.message });
    console.error('\n出错：' + e.message);
  } finally {
    if (client) client.close();
    diedEarly = appExited;
    if (!KEEP) {
      try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
      await sleep(700);
    }
  }

  /* ---------------- 报告 ---------------- */
  const pass = results.filter((r) => r.ok).length;
  console.log('\n  ────────────────────────────────');
  console.log('  结果  ' + pass + ' / ' + results.length + ' 通过      用时 ' + stamp());
  console.log('  ────────────────────────────────');
  results.forEach((r) => {
    console.log('  ' + (r.ok ? '✓' : '✗') + ' ' + r.name + (r.note ? '    ' + r.note : ''));
  });

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log('\n  没过的地方：');
    failed.forEach((r) => console.log('    · ' + r.name + ' — ' + r.note));
  }

  if (diedEarly) {
    console.log('\n  注意：应用进程中途退出了，日志尾巴：');
    console.log(appLog.join('').slice(-1200));
  }

  fs.writeFileSync(path.join(SHOT_DIR, 'report.json'), JSON.stringify({
    at: new Date().toISOString(), pass, total: results.length, results
  }, null, 2));

  console.log('\n  截图 → ' + SHOT_DIR + '\n');
  process.exit(failed.length ? 1 : 0);
}

run();
```

#### `build/selftest.js` — 106 行

纯逻辑自测：词库解析、阶梯推进、评分、阶段判定、计划生成

```js
// 核心逻辑自测：直接跑 schedule 模块，不依赖窗口
// 用法：node build/selftest.js

const S = require('../src/schedule');
const { TASK_LIB, parseBuiltin } = require('../src/data');

let fail = 0;
function ok(cond, msg, extra) {
  if (cond) { console.log('  ok   ' + msg); }
  else { console.log('  FAIL ' + msg + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); fail++; }
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }

console.log('\n[1] 词库解析');
const words = parseBuiltin();
ok(words.length === 100, '解析出 100 个词', words.length);
ok(words.every((w) => w.front && w.back), '每个词都有正面和释义');
ok(new Set(words.map((w) => w.front)).size === words.length, '没有重复单词');
const groups = new Set(words.map((w) => w.group));
ok(groups.size === 4, '分成 4 组', Array.from(groups));

console.log('\n[2] 新建卡片与艾宾浩斯阶梯');
const c = S.makeCard(words[0]);
ok(c.due <= Date.now() + 1000, '新卡立即可学');
ok(c.iv === 0 && c.reps === 0, '初始档位为 0、未学过');

S.markLearned(c);
const tenMin = 10 * 60 * 1000;
ok(near(c.due - Date.now(), S.EBB[0] * S.DAY, 3000), '学完排在 10 分钟后复习', Math.round((c.due - Date.now()) / 1000) + 's');
ok(c.reps === 1, '标记为已学');

console.log('\n[3] 三档评分推动阶梯');
const steps = [];
for (let i = 0; i < 6; i++) {
  S.rateCard(c, 2);                    // 每次都记得
  steps.push(Math.round((c.due - Date.now()) / S.DAY * 24 * 60) + 'min');
}
ok(c.iv === 6, '连答 6 次进到 30 天档', c.iv);
ok(c.due - Date.now() > 25 * S.DAY, '间隔已经拉到 25 天以上');

const before = c.iv;
S.rateCard(c, 1);
ok(c.iv === before - 1, '模糊退一档', [before, c.iv]);

S.rateCard(c, 0);
ok(c.iv === 0, '忘了直接回到第一档');
ok(near(c.due - Date.now(), S.EBB[0] * S.DAY, 3000), '忘了重排到 10 分钟后', Math.round((c.due - Date.now()) / 1000) + 's');
ok(c.lapses === 1, '遗忘次数记为 1');

console.log('\n[4] 掌握计数');
const cards = [];
for (let i = 0; i < 10; i++) {
  const k = S.makeCard(words[i]);
  k.iv = i;                 // 0..9，其中 >=4 的算掌握
  cards.push(k);
}
ok(S.masteredCount(cards) === 6, 'iv>=4 的算记住', S.masteredCount(cards));

console.log('\n[5] 阶段推进');
const st = { settings: { daily: 60, stage: 'auto' }, cards: [], sessions: [], days: {} };
ok(S.resolveStage(st.settings, st) === 'base', '空数据从基础期开始');
st.cards = cards.map((k) => Object.assign({}, k, { iv: 5 }));
ok(S.masteredCount(st.cards) === 10, '10 张都推到 7 天档');
ok(S.resolveStage(st.settings, st) === 'build', '记住 10 张后进积累期');
st.sessions = [{ status: 'done', minutes: 1300 }];
ok(S.resolveStage(st.settings, st) === 'boost', '累计时长够了进强化期');
st.settings.stage = 'mock';
ok(S.resolveStage(st.settings, st) === 'mock', '手动锁定阶段生效');

console.log('\n[6] 每日计划');
const st2 = { settings: { daily: 60, stage: 'auto' }, cards: [], sessions: [], days: {} };
const d = S.buildPlan(st2, 'base', true);
ok(d.plan.length >= 2, '至少生成两条任务', d.plan.length);
const total = d.plan.reduce((n, p) => n + p.minutes, 0);
ok(total >= 50, '总时长接近每日目标 60', total);
const libIds = new Set(TASK_LIB.map((t) => t.id));
ok(d.plan.every((p) => libIds.has(p.libId)), '任务都来自任务库');
const badStage = d.plan.filter((p) => {
  const t = TASK_LIB.find((x) => x.id === p.libId);
  return t && !t.stages.includes('base');
});
ok(badStage.length === 0, '基础期不会排出强化期才有的任务', badStage.map((x) => x.name));

const d2 = S.buildPlan(st2, 'base', true);
ok(d2.plan.length > 0, '清空后能重新生成');

console.log('\n[7] 复习曲线');
const cv = S.curvePoints();
ok(cv.raw.length > 200 && cv.rev.length > 200, '曲线采样点足够');
ok(cv.raw[0][1] === 1 || cv.raw[0][1] > 0.95, '起点保持率接近 100%');
ok(cv.raw[cv.raw.length - 1][1] < 0.15, '不复习 30 天后几乎归零');
ok(cv.rev.some((p) => p[1] > 0.99), '复习曲线有回到 100% 的瞬间');

console.log('\n[8] 连续天数');
const mk = (offset, done) => {
  const dd = new Date();
  dd.setDate(dd.getDate() - offset);
  return [S.dayKey(dd), { sessions: done ? 1 : 0, cards: 0 }];
};
const st3 = { days: Object.fromEntries([mk(0, true), mk(1, true), mk(2, true)]) };
ok(S.streakDays(st3) === 3, '连续 3 天', S.streakDays(st3));
const st4 = { days: Object.fromEntries([mk(0, false), mk(1, true)]) };
ok(S.streakDays(st4) === 1, '今天没学但昨天学了，算 1 天', S.streakDays(st4));

console.log('\n' + (fail ? `✗ ${fail} 项未通过` : '✓ 全部通过'));
process.exit(fail ? 1 : 0);
```

#### `build/reorder.js` — 93 行

从词频源生成 src/word-freq.json

```js
/* 词频提取：给四六级词表里的每个词标一个"多常用"的排名
 *
 * 数据源：Google Web Trillion Word Corpus（Peter Norvig 整理的 count_1w.txt）
 * 227,031 条，按出现次数从高到低排。四六级词表覆盖率实测 99.58% / 99.82%。
 *
 * 产出 src/word-freq.json：{ "abandon": 3987, ... }，数字是排名，越小越常用。
 * 只收录词表里真出现的词，文件约 100KB，随代码一起提交。
 *
 * 为什么排名而不是原始次数：原始次数是万亿级大数，排名更小更好读，
 * 而且我们只需要"谁比谁常用"这个相对关系，绝对次数没用。
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'freq', 'count_1w.txt');
const OUT = path.join(__dirname, '..', 'src', 'word-freq.json');
const DICT = path.join(__dirname, '..', 'src', 'data.js');

// 连字符、撇号都保留，否则 up-to-date / air-conditioning 这类词永远查不到
const OK = /^[a-z][a-z'\-]*$/;

function loadCounts() {
  const raw = fs.readFileSync(SRC, 'utf8');
  const rank = new Map();
  let n = 0;
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf('\t');
    if (i < 1) continue;
    const w = line.slice(0, i).toLowerCase();
    if (!OK.test(w)) continue;
    n += 1;
    if (!rank.has(w)) rank.set(w, n); // 同一个词出现多次只认第一次（排名最靠前那次）
  }
  return rank;
}

function readDict(file) {
  const p = path.join(__dirname, '..', 'src', file);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf('\t');
      return (i < 0 ? l : l.slice(0, i)).trim();
    })
    .filter(Boolean);
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error('找不到词频源文件：' + SRC);
    console.error('下载：curl -sL -o build/freq/count_1w.txt https://norvig.com/ngrams/count_1w.txt');
    process.exit(1);
  }

  const rank = loadCounts();
  const words = [...readDict('cet4-words.txt'), ...readDict('cet6-words.txt')];

  const out = {};
  let hit = 0;
  const miss = [];
  for (const w of words) {
    const k = w.toLowerCase();
    if (k in out) continue;
    if (rank.has(k)) {
      out[k] = rank.get(k);
      hit += 1;
    } else if (!miss.includes(k)) {
      miss.push(k);
    }
  }

  const sorted = {};
  Object.keys(out)
    .sort()
    .forEach((k) => { sorted[k] = out[k]; });

  fs.writeFileSync(OUT, JSON.stringify(sorted) + '\n', 'utf8');

  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log('词频源 ' + rank.size + ' 条');
  console.log('词表共 ' + new Set(words.map((w) => w.toLowerCase())).size + ' 个不重复词');
  console.log('命中 ' + hit + ' 个，缺 ' + miss.length + ' 个');
  console.log('产出 ' + path.relative(path.join(__dirname, '..'), OUT) + '  ' + kb + ' KB');
  if (miss.length) {
    console.log('缺频次的词（排序时排到该段末尾）：');
    console.log('  ' + miss.join(', '));
  }
}

main();
```

#### `build/mkicon.js` — 170 行

手写 PNG/ICO 生成图标

```js
// 生成应用图标：纯 Node 手写 PNG + ICO，不依赖任何图像库
// 用法：node build/mkicon.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- CRC32 ---------- */
let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = 1 + size * 4;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- 画一个番茄 ---------- */
function inEllipse(x, y, ex, ey, rx, ry, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const dx = x - ex, dy = y - ey;
  const u = dx * c + dy * s;
  const v = -dx * s + dy * c;
  return (u * u) / (rx * rx) + (v * v) / (ry * ry) <= 1;
}

function drawTomato(size) {
  const SS = 4;
  const W = size * SS;
  const acc = new Float64Array(size * size * 4);

  const cx = W / 2;
  const cy = W * 0.585;
  const R = W * 0.372;

  const leafL = { ex: cx - R * 0.30, ey: cy - R * 0.94, rx: R * 0.44, ry: R * 0.19, ang: -0.55 };
  const leafR = { ex: cx + R * 0.30, ey: cy - R * 0.94, rx: R * 0.44, ry: R * 0.19, ang: 0.55 };

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, a = 0;

      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);

      if (d <= R) {
        const t = Math.max(0, Math.min(1, (y - (cy - R)) / (2 * R)));
        r = 219 - t * 42;
        g = 82 - t * 26;
        b = 63 - t * 22;
        a = 1;

        // 左上高光
        const hx = cx - R * 0.33, hy = cy - R * 0.34, hr = R * 0.36;
        const hd = Math.sqrt((x - hx) * (x - hx) + (y - hy) * (y - hy));
        if (hd < hr) {
          const k = (1 - hd / hr) * 0.24;
          r += (255 - r) * k;
          g += (255 - g) * k;
          b += (255 - b) * k;
        }
      }

      // 叶子压在最上层
      if (inEllipse(x, y, leafL.ex, leafL.ey, leafL.rx, leafL.ry, leafL.ang) ||
          inEllipse(x, y, leafR.ex, leafR.ey, leafR.rx, leafR.ry, leafR.ang)) {
        r = 58; g = 160; b = 112; a = 1;
      }
      // 蒂
      if (Math.abs(x - cx) < R * 0.07 && y < cy - R * 0.78 && y > cy - R * 1.02) {
        r = 44; g = 126; b = 88; a = 1;
      }

      const px = Math.floor(x / SS);
      const py = Math.floor(y / SS);
      const i = (py * size + px) * 4;
      acc[i] += r * a;
      acc[i + 1] += g * a;
      acc[i + 2] += b * a;
      acc[i + 3] += a;
    }
  }

  const n = SS * SS;
  const out = Buffer.alloc(size * size * 4);
  for (let p = 0; p < size * size; p++) {
    const i = p * 4;
    const A = acc[i + 3];
    if (A > 0) {
      out[i] = Math.round(acc[i] / A);
      out[i + 1] = Math.round(acc[i + 1] / A);
      out[i + 2] = Math.round(acc[i + 2] / A);
    }
    out[i + 3] = Math.round((A / n) * 255);
  }
  return out;
}

/* ---------- ICO 封装（内嵌 PNG，Vista 以上都认） ---------- */
function encodeICO(png, size) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(1, 4);

  const ent = Buffer.alloc(16);
  ent[0] = size >= 256 ? 0 : size;
  ent[1] = size >= 256 ? 0 : size;
  ent[2] = 0;
  ent[3] = 0;
  ent.writeUInt16LE(1, 4);
  ent.writeUInt16LE(32, 6);
  ent.writeUInt32LE(png.length, 8);
  ent.writeUInt32LE(22, 12);

  return Buffer.concat([dir, ent, png]);
}

/* ---------- 输出 ---------- */
const root = path.join(__dirname, '..');
const buildDir = path.join(root, 'build');
const assetsDir = path.join(root, 'assets');
fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(assetsDir, { recursive: true });

const png256 = encodePNG(256, drawTomato(256));
fs.writeFileSync(path.join(buildDir, 'icon.png'), png256);
fs.writeFileSync(path.join(assetsDir, 'icon.png'), png256);
fs.writeFileSync(path.join(buildDir, 'icon.ico'), encodeICO(png256, 256));

const png32 = encodePNG(32, drawTomato(32));
fs.writeFileSync(path.join(assetsDir, 'tray.png'), png32);

console.log('icon.png / icon.ico / assets/tray.png 生成完毕');
```

#### `build/audiotest.js` — 109 行

只验声音：8 种音色逐个量输出峰值

```js
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
```

#### `build/belltest.js` — 114 行

只验链路：到点 → 响铃 → 自动进休息

```js
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
```

#### `build/snap.js` — 52 行

截当前窗口一张图

```js
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
```

---

## 8. 没附上的文件（需要时我再单独发）

| 文件 | 大小 | 为什么没附 |
|---|---|---|
| `src/word-freq.json` | 100KB，6635 条 | 一行 JSON：`{"word": 频次排名, ...}`，通读无意义 |
| `src/cet4-words.txt` / `cet6-words.txt` | 4543 / 3991 行 | 词表，格式 `单词\t释义` |
| `engine/` | 98MB | Piper 二进制 + onnxruntime + espeak-ng 数据 + 63MB 语音模型，不进 asar |
| `node_modules/` | — | 依赖 |
| `assets/` | — | 图标 PNG / ICO |
| `_legacy/` | — | 早期单文件原型，不参与运行也不参与打包 |
| `package-lock.json` | 大 | 依赖锁文件 |
