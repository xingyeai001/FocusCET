// 记录明细的裁剪，以及「累计」账本。
//
// 为什么要单独一个文件：这是整个程序里唯一会**主动丢数据**的地方。
// 明细留太全会让 config.json 越滚越大、每次保存都要全量写；留太少又会让
// 「累计番茄 / 累计分钟」往回退 —— 攒了半年的数字突然变少，比看不到老明细更伤。
//
// 解法是把两件事拆开：
//   明细 sessions  → 只留最近 LIMIT 条，够看、够算近 7 天
//   账本 lifetime  → 只装「已经从明细里裁掉的那部分」，统计时两边相加
// 两边永不重叠，所以不会重复计数。放在这里也方便脱离窗口单测
// （build/selftest.js 里有一节专门盯着它）。

// 2000 条 ≈ 每天 10 个番茄攒 200 天，JSON 约 300KB，全量写的成本还能接受
const LIMIT = 2000;

function emptyLifetime() {
  return { pomodoros: 0, minutes: 0, byCat: {} };
}

/* 把 cfg.sessions 裁到 limit 条，被裁掉的 done 记录折进 cfg.lifetime。
 * 作废（abort）不进账本 —— 和「累计」的统计口径保持一致（见 totalsOf）。
 * 返回 { cut, kept } 便于调用方打日志或断言。 */
function trimSessions(cfg, limit) {
  const max = Number.isFinite(limit) ? limit : LIMIT;
  if (!cfg || !Array.isArray(cfg.sessions)) return { cut: 0, kept: 0 };
  if (!cfg.lifetime || typeof cfg.lifetime !== 'object') cfg.lifetime = emptyLifetime();
  if (!cfg.lifetime.byCat || typeof cfg.lifetime.byCat !== 'object') cfg.lifetime.byCat = {};
  if (!Number.isFinite(cfg.lifetime.pomodoros)) cfg.lifetime.pomodoros = 0;
  if (!Number.isFinite(cfg.lifetime.minutes)) cfg.lifetime.minutes = 0;
  if (cfg.sessions.length <= max) return { cut: 0, kept: cfg.sessions.length };

  const cut = cfg.sessions.splice(max);
  cut.forEach((s) => {
    if (!s || s.status !== 'done') return;
    const mins = Number(s.minutes) || 0;
    cfg.lifetime.pomodoros += 1;
    cfg.lifetime.minutes += mins;
    const c = s.cat || '综合';
    cfg.lifetime.byCat[c] = (cfg.lifetime.byCat[c] || 0) + mins;
  });
  return { cut: cut.length, kept: cfg.sessions.length };
}

/* 「累计」的唯一口径：账本（已裁掉的老记录）+ 明细里还在的。
 * 界面上「累计番茄 / 累计分钟 / 时间花在哪」都走这里，别各算各的。 */
function totalsOf(cfg) {
  const life = (cfg && cfg.lifetime) || emptyLifetime();
  const sessions = (cfg && Array.isArray(cfg.sessions)) ? cfg.sessions : [];
  const byCat = Object.assign({}, life.byCat || {});
  let pomodoros = Number(life.pomodoros) || 0;
  let minutes = Number(life.minutes) || 0;

  sessions.forEach((s) => {
    if (!s || s.status !== 'done') return;
    const mins = Number(s.minutes) || 0;
    pomodoros += 1;
    minutes += mins;
    const c = s.cat || '综合';
    byCat[c] = (byCat[c] || 0) + mins;
  });

  return { pomodoros, minutes, byCat };
}

module.exports = { LIMIT, trimSessions, totalsOf, emptyLifetime };
