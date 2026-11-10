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
