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
/* wide：标题长/内容宽（比如全部记录）时放宽；
 * scroll：正文自己滚，别把弹窗撑出屏幕。 */
function modal({ title, body, ok = '确定', cancel = '取消', onOk, onMount, wide = false, scroll = false }) {
  const root = $('#modalRoot');
  root.innerHTML = `
    <div class="overlay">
      <div class="modal${wide ? ' wide' : ''}">
        <div class="mhead">${esc(title)}</div>
        <div class="mbody${scroll ? ' scroll' : ''}">${body}</div>
        <div class="mfoot">
          ${cancel ? `<button class="btn" data-act="cancel">${esc(cancel)}</button>` : ''}
          <button class="btn primary" data-act="ok">${esc(ok)}</button>
        </div>
      </div>
    </div>`;

  /* 关闭时把 Esc 监听一起摘掉，别在 document 上留一串死监听 */
  function close() {
    document.removeEventListener('keydown', onKey, true);
    root.innerHTML = '';
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }
  document.addEventListener('keydown', onKey, true);


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

/* ---------------- 全部记录 ---------------- */
/* 「最近记录」只有 20 条，明细里其实留了 2000 条（更老的折进累计账本）。
 * 这里按月分组列出全部明细，每条都能删 —— 删错了有 6 秒撤销窗口。 */

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];
function fmtLogDate(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} 周${WEEKDAY[d.getDay()]} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function paintAllLogs(box) {
  if (!box) return;
  const r = await api.allLogs();
  const logs = (r && r.logs) || [];
  if (!logs.length) {
    box.innerHTML = '<div class="allnull">还没有任何记录</div>';
    return;
  }

  // 按月分组。logs 本身已经是按时间倒序的，所以顺序扫一遍就够
  const groups = [];
  let cur = null;
  logs.forEach((s) => {
    const d = new Date(s.endedAt);
    const k = d.getFullYear() + '-' + d.getMonth();
    if (!cur || cur.k !== k) {
      cur = { k, label: d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月', items: [] };
      groups.push(cur);
    }
    cur.items.push(s);
  });

  box.innerHTML = groups.map((g, gi) => `
    <div class="algroup" id="alg-${gi}"><span>${g.label} · <span class="gcount">${g.items.length}</span> 条</span><span class="gline"></span></div>
    ${g.items.map((s) => `
      <div class="alrow" data-id="${esc(s.id)}" data-g="${gi}">
        <span class="d">${fmtLogDate(s.endedAt)}</span>
        <span class="n" title="${esc(s.name)}">${esc(s.name)}</span>
        <span class="tag ${s.status === 'done' ? 'ok' : 'bad'}">${s.status === 'done' ? '完成' : '作废'}</span>
        <span class="m">${s.minutes} 分</span>
        <button class="del" data-del="${esc(s.id)}" title="删除这条记录" aria-label="删除这条记录">×</button>
      </div>`).join('')}
  `).join('') + (r.archived
    ? `<div class="altip">另有 ${r.archived} 条更早的完成记录已经归档：明细只留最近 ${r.limit} 条，
       更老的那些只计入累计数字，不再单条列出。它们删不掉，也不需要删 —— 不影响任何统计。</div>`
    : '');
}

async function onLogClick(e) {
  const b = e.target.closest('[data-del]');
  if (!b) return;
  const id = b.dataset.del;
  const row = b.closest('.alrow');
  const r = await api.deleteSession(id);
  if (!r || !r.ok) { toast((r && r.msg) || '这条记录删不掉'); return; }
  if (row) {
    // 分组标题上的「N 条」跟着减一，别留个对不上的数字
    const g = row.dataset.g;
    const cnt = document.querySelector('#alg-' + g + ' .gcount');
    if (cnt) cnt.textContent = Math.max(0, Number(cnt.textContent) - 1);
    row.remove();
  }

  /* 不弹确认框：删记录是高频小动作，每删一条问一句太烦。
   * 给 6 秒撤销窗口，误删点一下就回来了（会把那天的人数一起补回去）。 */
  toastUndo('已删除「' + (r.entry.name || '记录') + '」', async () => {
    await api.restoreSession(r.entry);
    if ($('#allLogsBox')) await paintAllLogs($('#allLogsBox'));
  });
}

function openAllLogs() {
  modal({
    title: '全部记录',
    body: '<div class="alllogs" id="allLogsBox">正在读取…</div>',
    ok: '关闭',
    cancel: '',
    wide: true,
    scroll: true,
    onMount: async (root) => {
      const box = root.querySelector('#allLogsBox');
      box.addEventListener('click', onLogClick);
      await paintAllLogs(box);
    }
  });
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

  /* 界面材质。系统不支持时把三档置灰并说清原因 —— 不要让人点了没反应，
   * 更不要留下"选了亚克力、窗口透出桌面却没有毛玻璃"的半截状态。
   *
   * 亚克力那条提示是必须写的：Windows 的桌面亚克力是"瞬态表面"材质，
   * 窗口一失焦 DWM 就不再绘制，背景退回清晰。这是系统行为，不是本程序的 bug，
   * 不写在界面上用户只会以为是坏了。 */
  const mat = s.material || 'solid';
  const matOk = ST.materialOk !== false;
  $$('#segMat button').forEach((b) => {
    b.classList.toggle('on', b.dataset.v === mat);
    const no = b.dataset.v !== 'solid' && !matOk;
    b.disabled = no;
    b.classList.toggle('muted', no);
  });
  const MAT_NOTE = {
    solid: '纯色最稳，完全不透桌面',
    acrylic: '透得最狠，但窗口一失去焦点，Windows 就会把它退回清晰 —— 这是系统对「瞬态材质」的规定，改用云母可避免',
    mica: '一直保留材质，点到窗口外面也不掉；透感比亚克力含蓄',
    tabbed: '云母 Alt：失焦同样不掉，透感比云母强一档'
  };
  $('#matNote').textContent = matOk
    ? (MAT_NOTE[mat] || MAT_NOTE.solid)
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

  // 记录页：「最近记录」下面那 20 条不够看，点这里翻全部
  const allLogsBtn = $('#btnAllLogs');
  if (allLogsBtn) allLogsBtn.onclick = () => openAllLogs();

  /* 换材质由主进程调 setBackgroundMaterial，界面这边只等广播回来后切 class。
   * 系统不支持时主进程会把值改成 solid 并回一句说明，这里原样转达。 */
  $$('#segMat button').forEach((b) => {
    b.onclick = async () => {
      const v = b.dataset.v;
      const r = await api.setSettings({ material: v });
      if (r && r.msg) { toast(r.msg); return; }
      const name = { solid: '纯色', acrylic: '亚克力', mica: '云母', tabbed: '云母 Alt' }[v] || '';
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
