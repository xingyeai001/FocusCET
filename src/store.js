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
    // 界面材质：solid 纯色 | acrylic 亚克力 | mica 云母 | tabbed 云母 Alt（均需 Win11 22H2+）
    // 注意 acrylic 是"瞬态"材质，窗口失焦时 Windows 会停止绘制（系统行为，无法绕过）
    material: 'solid',
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
  /* 累计账本：只装「从 sessions 明细里被裁掉的那部分」。
   * 明细留最近若干条够看就行，但「累计番茄 / 累计分钟」是从明细汇总出来的，
   * 直接裁掉会让总数往回退 —— 攒了半年的数字突然变少，比丢明细更伤。
   * 所以裁剪前先把被裁掉的 done 记录折算进这里，统计时两边相加。 */
  lifetime: { pomodoros: 0, minutes: 0, byCat: {} },
  cards: []
});

/* 老配置文件没有 lifetime（这个字段是后加的），读进来补成空账本即可：
 * 空账本 + 现有明细 = 和加字段之前完全一致的统计口径，不需要迁移计算。 */
function fixLifetime(x) {
  if (!x || typeof x !== 'object') return { pomodoros: 0, minutes: 0, byCat: {} };
  return {
    pomodoros: Number(x.pomodoros) || 0,
    minutes: Number(x.minutes) || 0,
    byCat: (x.byCat && typeof x.byCat === 'object') ? x.byCat : {}
  };
}

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
  data.lifetime = fixLifetime(data.lifetime);

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
  data.lifetime = fixLifetime(data.lifetime);
  save();
  return true;
}

module.exports = { init, save, get, replace, DEFAULTS, getBrokenBackup };
