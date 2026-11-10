# 番茄四六级 —— 布局代码（供评估）

## 一、先说清楚这是什么

不是网页，是 **Electron 桌面应用**（Windows），单窗口：

| 项 | 值 |
|---|---|
| 默认窗口 | 900 × 700 |
| 最小窗口 | 760 × 560（`minWidth` / `minHeight`） |
| 可最大化 | 是，1920×1080 全屏也能开 |
| 缩放 | 跟随系统 DPI，不放大小 |
| 基字号 | `body { font-size: 13.5px }`，全站用 px 不用 rem |
| 滚动 | 只有 `.body` 一个滚动容器，`html/body` 是 `overflow:hidden` |
| 技术栈 | 纯 HTML + CSS + 原生 JS，无框架、无 Tailwind、无组件库 |

有 4 个页面（今日 / 复习 / 记录 / 设置），用 `display:none` 切 tab，不是路由。

## 二、我怀疑的问题

1. **窄窗口下像手机布局**：760~900 宽时是单列 780 居中，内容比例接近手机，用户质疑"这是适配手机的比例吗"。
2. **全屏时左右大量留白**：以前直接一条 780 窄列居中，现在加了断点做两栏，但：
   - 1320px+ 时左栏固定 372px、右栏吃剩余（1140 内容宽），左栏会不会太窄/太宽？
   - 设置页与记录页左右两栏**内容高度差很大**（实测设置页左右差约 295px），右栏下方空一大截，是否难看/该不该处理？
3. **字号偏小**：13.5px 基准 + 大量 11~12px 辅助文字，在 1080p 全屏下是否过小？
4. **垂直居中策略**：`justify-content: safe center`，内容不满一屏时整块居中。这个做法在大屏上是否合适？

## 三、目录与文件

- `renderer/index.html`：全部 4 个页面的骨架（下文完整贴出）
- `renderer/style.css`：全部样式（下文完整贴出）

下面 HTML 里**很多容器是空的**（`#planList`、`#todayGrid`、`#weekBars`、`#catRows`、`#curveCard`、`#logList`、`#bellGrid`、`#reviewBody`、`#reviewSide`、`#dueBar`、`#poolBar`、`#timerActions`），内容由 JS 在运行时注入。注入内容的形态见文末「运行时注入内容」一节，评估布局时按那节的真实内容量考虑。

---

## 四、renderer/index.html 全文（291 行）

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

    <div class="today-grid">
    <div class="today-left">

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

    </div><!-- /today-left -->
    <div class="today-right">

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

    </div><!-- /today-right -->
    </div><!-- /today-grid -->
  </section>

  <!-- ================= 复习 ================= -->
  <section class="view" id="view-review">
    <div id="reviewBody"></div>
    <aside class="review-side" id="reviewSide"></aside>
  </section>

  <!-- ================= 记录 ================= -->
  <section class="view" id="view-stats">
    <div class="stats-grid">
    <div class="stats-left">
    <div class="blockhead first"><h2>累计</h2></div>
    <div class="grid4" id="totalGrid"></div>

    <div class="blockhead"><h2>近 7 天专注</h2><span class="grow"></span><span class="sub" id="weekSum"></span></div>
    <div class="card"><div class="bars" id="weekBars"></div></div>

    <div class="blockhead"><h2>时间花在哪</h2></div>
    <div class="card"><div class="catrows" id="catRows"></div></div>

    </div><!-- /stats-left -->
    <div class="stats-right">

    <div class="blockhead"><h2>遗忘曲线</h2><span class="sub">卡片调度就按这条线走</span></div>
    <div class="card" id="curveCard"></div>

    <div class="blockhead"><h2>最近记录</h2></div>
    <div class="loglist" id="logList"></div>
    </div><!-- /stats-right -->
    </div><!-- /stats-grid -->
  </section>

  <!-- ================= 设置 ================= -->
  <section class="view" id="view-settings">
    <div class="set-grid">
    <div class="set-left">
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

    <div class="blockhead"><h2>铃声样式</h2><span class="sub">点一下就能听</span></div>
    <div class="card pad">
      <div class="bellgrid" id="bellGrid"></div>
      <div class="btnrow bellrow">
        <button class="btn sm" id="bellTest">试听这个</button>
        <button class="btn sm" id="bellUpload">＋ 上传自己的</button>
        <span class="bellnote" id="bellNote"></span>
      </div>
    </div>

    </div><!-- /set-left -->
    <div class="set-right">

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
    </div>

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

    <div class="blockhead"><h2>导入卡片</h2><span class="sub">每行一张，竖线分隔</span></div>
    <div class="card pad">
      <div class="poolbar" id="poolBar"></div>
      <textarea id="importArea" placeholder="abandon | v. 放弃，抛弃&#10;adapt | v. 适应；改编 | It takes time to adapt."></textarea>
      <div class="btnrow">
        <button class="btn primary" id="btnImport">导入</button>
        <button class="btn" id="btnSeed">再发 20 个新词</button>
      </div>
    </div>

    <div class="blockhead"><h2>数据</h2><span class="sub">存在本机，不上传</span></div>
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

    </div><!-- /set-right -->
    </div><!-- /set-grid -->

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

---

## 五、renderer/style.css 全文（589 行）

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
  /* 内容列宽度：窗口窄时按单列走，够宽了才换成两栏（见文件末尾的断点） */
  --cw: 780px;
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
.view { display: none; padding: 20px 26px 40px; max-width: var(--cw); margin: 0 auto; }
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
  .view { padding: 16px 16px 32px; }
  .grid4 { grid-template-columns: repeat(2, 1fr); }
}

/* ---------- 复习侧栏（只有宽屏才显示） ---------- */
.review-side { display: none; }
.rs-head { display: flex; align-items: baseline; justify-content: space-between; font-size: 12px; color: var(--dim); margin-bottom: 9px; }
.rs-head b { font-weight: 500; color: var(--text); font-variant-numeric: tabular-nums; }
.rs-bar { height: 3px; background: var(--line); border-radius: 2px; overflow: hidden; margin-bottom: 14px; }
.rs-bar i { display: block; height: 100%; background: var(--leaf); border-radius: 2px; transition: width .3s; }
.rs-list { display: flex; flex-direction: column; gap: 2px; max-height: 340px; overflow-y: auto; }
.rs-item {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 9px; border-radius: 7px; font-size: 12px; color: var(--faint);
}
.rs-item .rs-w { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rs-item .rs-m { font-size: 10.5px; flex: none; font-variant-numeric: tabular-nums; }
.rs-item.done { opacity: .45; text-decoration: line-through; }
.rs-item.on { background: var(--panel); border: 1px solid var(--line); color: var(--text); padding: 5px 8px; }
.rs-item.on .rs-m { color: var(--tomato); }
.rs-foot { margin-top: 12px; font-size: 11px; color: var(--faint); line-height: 1.75; }

/* ---------- 宽屏布局 ----------
 * 以前不管窗口多大都是同一条 780 的居中窄列，拉到全屏时左右各空 460 多像素，
 * 看着就像把手机界面摆在大屏中间。按宽度分三档：
 *   < 1000px  单列 780   和原来一致
 *   1000px+   单列 880   小本子上不挤
 *   1320px+   两栏 1140  计时器黏在左边、计划在右；复习页多一条本轮队列
 */
@media (min-width: 1000px) {
  :root { --cw: 880px; }

  /* 内容比窗口矮时垂直居中。以前是贴顶排，下面拖一大片空白，
   * 看着像加载到一半没渲染完。safe 是为了内容超出时退回顶部对齐，
   * 免得居中把顶部内容顶到滚动区外面去。
   * 整块居中而不是只居中计时器：只把计时器居中会在页眉和内容之间
   * 埋一道两三百像素的断层，看着像两块东西各飘各的。 */
  #view-today.on,
  #view-stats.on {
    display: flex;
    flex-direction: column;
    justify-content: safe center;
    min-height: 100%;
  }
}

@media (min-width: 1320px) {
  :root { --cw: 1140px; }

  .today-grid { display: grid; grid-template-columns: 372px minmax(0, 1fr); gap: 30px; align-items: stretch; }
  /* 计划列表往往比计时器长，让计时器跟着滚，不用滚上去看还剩多少时间 */
  .today-left { position: sticky; top: 2px; display: flex; }

  /* 计时器面板拉成和右栏等高，圆环在面板里居中。
   * 不拉的话左栏是个矮卡片、右栏一长条，整块看着像缺了半边。 */
  .today-left .timer-card { flex: 1; display: flex; flex-direction: column; justify-content: center; }

  /* 左栏宽到 372 了，圆环还按 196 会显得又小又空 */
  .ringwrap,
  .ring { width: 236px; height: 236px; }
  .tnum { font-size: 44px; }

  /* 大屏上纵向节奏放宽半档，不然整块内容又小又挤 */
  .timer-card { padding: 24px 22px 18px; }
  .pitem { padding: 13px 14px; }
  .sbox { padding: 14px 15px; }

  .stats-grid,
  .set-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 30px; align-items: start; }

  /* 右栏第一块不能比左栏矮一截 */
  .today-right > .blockhead:first-child,
  .stats-grid > div > .blockhead:first-child,
  .set-grid > div > .blockhead:first-child { margin-top: 0; }

  #view-review.on {
    display: grid;
    grid-template-columns: 620px 288px;
    gap: 36px;
    justify-content: center;
    align-items: center;
  }
  /* 没有卡片要练时，别留一条空的右栏 */
  #view-review.on:has(.review-side:empty) { grid-template-columns: minmax(0, 620px); }
  .review-side { display: block; }
}

```

---

## 六、运行时注入内容（评估时按这个算内容量）

| 容器 | 真实内容 |
|---|---|
| `#planList` | 6~9 条 `.pitem`，每条 48~50px 高（名字 / 描述 / 分类标签 / 时长 / 播放按钮 / 删除按钮） |
| `#todayGrid` | 4 个 `.sbox`（有效专注 / 完成番茄 / 新学卡片 / 待复习） |
| `#weekBars` | 7 根柱 `.barcol`，容器固定 132px 高 |
| `#catRows` | 3~4 行分类条（听力 / 阅读 / 写作 / 单词），每行 5px 细条 + 名字 + 数值 |
| `#curveCard` | 一张 `viewBox="0 0 660 172"` 的 SVG（宽 100% 自适应）+ 下方 3 行说明文字，整块约 260px 高 |
| `#logList` | 最多 12 行 `.logrow`，每行约 33px |
| `#bellGrid` | `repeat(auto-fill, minmax(146px,1fr))` 网格，5~8 个铃声方块 |
| `#timerActions` | 空闲时**0 个按钮**，计时中 2 个按钮（用 `:has(> button)` 控制是否留高度） |
| `#reviewBody` | 一张 `.fcwrap`（`max-width:500px`）：进度行 + 闪卡（`min-height:220px`）+ 3 个评分按钮 |
| `#reviewSide` | 宽屏才有：本轮队列列表（最多 340px 高可滚），**没有卡片要练时整个为空** |
| `#dueBar` / `#poolBar` | 0 或 1 条提示条 |

各页面实际内容高度（900×700 窗口实测）：

- 今日：约 700~760px（一屏差一点，需轻微滚动）
- 复习：约 330px（远不满屏 → 做了垂直居中）
- 记录：约 900px（要滚）
- 设置：约 1150px（要滚），两栏时左 1150 / 右 855，差约 295px

---

## 七、我想要的反馈

1. 三档断点（1000 / 1320）选得对不对？760 最小宽到 1920 全屏，档位该怎么分？
2. 全屏两栏：左 372 固定 + 右自适应，这个配比合适吗？还是该用 `minmax()` 弹性、或干脆居中的定宽列？
3. 设置页/记录页两栏高度差 295px，怎么处理最自然（让右栏拉伸？重新分配内容？还是干脆不做两栏）？
4. 13.5px 基准在桌面应用里偏小吗？该不该整体提到 14/15？
5. 内容不满一屏时垂直居中（`safe center`）——桌面 app 里这个做法常见吗，还是该一律顶对齐？
