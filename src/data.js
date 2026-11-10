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
