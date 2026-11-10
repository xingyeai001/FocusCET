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

console.log('\n[9] 累计账本（明细裁剪不能丢数）');
const L = require('../src/lifetime');
const mkS = (i, status, mins) => ({ id: 's' + i, status, minutes: mins, cat: '词汇', endedAt: Date.now() - i * 1000 });

/* 造 2005 条：105 条作废 + 1900 条完成。完成的那批放在数组尾部，
 * 这样 splice 裁掉的正好是完成记录 —— 才能验证"裁掉的不丢数"。 */
const big = { sessions: [], lifetime: { pomodoros: 0, minutes: 0, byCat: {} } };
for (let i = 0; i < 105; i++) big.sessions.push(mkS(i, 'abort', 7));
for (let i = 0; i < 1900; i++) big.sessions.push(mkS(1000 + i, 'done', 25));
const accB = L.totalsOf(big);
ok(accB.pomodoros === 1900 && accB.minutes === 47500, '裁剪前累计 1900 个 / 47500 分', accB);

const r = L.trimSessions(big, 2000);
ok(big.sessions.length === 2000, '明细裁到 2000 条', big.sessions.length);
ok(r.cut === 5, '裁掉 5 条', r);
const accA = L.totalsOf(big);
ok(accA.pomodoros === accB.pomodoros && accA.minutes === accB.minutes,
  '裁剪后累计没变（不倒退、不重复计数）', { accB, accA });
ok(accA.byCat['词汇'] === accB.byCat['词汇'], '分类分钟数同样没变', accA.byCat);

// 再进来一条、再裁一次：账本累加不能翻倍
big.sessions.unshift(mkS(9999, 'abort', 3));
L.trimSessions(big, 2000);
const again = L.totalsOf(big);
ok(again.pomodoros === accB.pomodoros && again.minutes === accB.minutes,
  '反复裁剪仍然相等', again);

// 作废记录本来就不进累计，裁掉也不该凭空变出数来
const onlyAbort = { sessions: [], lifetime: L.emptyLifetime() };
for (let i = 0; i < 2003; i++) onlyAbort.sessions.push(mkS(i, 'abort', 5));
L.trimSessions(onlyAbort, 2000);
const ab = L.totalsOf(onlyAbort);
ok(ab.pomodoros === 0 && ab.minutes === 0, '全是作废记录时累计仍为 0', ab);

// 老配置文件里根本没有 lifetime 这个字段
const lg = L.totalsOf({ sessions: [mkS(0, 'done', 25), mkS(1, 'done', 30)] });
ok(lg.pomodoros === 2 && lg.minutes === 55, '缺 lifetime 字段时退回按明细算', lg);

console.log('\n' + (fail ? `✗ ${fail} 项未通过` : '✓ 全部通过'));
process.exit(fail ? 1 : 0);
