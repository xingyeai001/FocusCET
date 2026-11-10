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
  // 记录明细：全部列表、删一条、把误删的那条放回去（配合提示条上的「撤销」）
  allLogs: () => ipcRenderer.invoke('data:allLogs'),
  deleteSession: (id) => ipcRenderer.invoke('data:deleteSession', id),
  restoreSession: (entry) => ipcRenderer.invoke('data:restoreSession', entry),
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
