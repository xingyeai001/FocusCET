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
  console.log('\n  FocusCET · 自动化自测');
  console.log('  ────────────────────────────────');
  console.log('  沙盒目录  ' + path.join(process.env.TEMP || '', 'focuscet-sandbox'));
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

    /* 15. 语速切换：慢速的音频应该比正常更长
     * 先清一次缓存再合成：不清的话，跑过一遍的沙盒里两种语速的文件都在，
     * 这个用例就退化成"测命中缓存"，量出来的长度差不能证明合成参数变了。
     * （真吃过这个亏：某次两边都命中同一个文件，字节数一模一样。） */
    {
      const s = await client.evaluate(`
        const cleared = await api.ttsClear();
        await api.setSettings({ voicePace: 'normal' });
        const a = await api.sayWord('vocabulary');
        const lsA = (await api.ttsStatus()).lengthScale;
        await api.setSettings({ voicePace: 'slow' });
        const b = await api.sayWord('vocabulary');
        const lsB = (await api.ttsStatus()).lengthScale;
        await api.setSettings({ voicePace: 'normal' });
        return {
          ok: true,
          cleared: cleared && cleared.removed,
          aLen: a.ok ? a.data.length : 0,
          bLen: b.ok ? b.data.length : 0,
          aHit: !!a.hit, bHit: !!b.hit,
          lsA, lsB
        };
      `);
      const ok = s.aLen > 0 && s.bLen > s.aLen && !s.aHit && !s.bHit && s.lsA < s.lsB;
      results.push({
        name: '语速切换真的变慢', ok,
        note: `清掉 ${s.cleared} 个旧缓存 · 倍率 ${s.lsA} → ${s.lsB} · 正常 ${s.aLen} 字节 → 慢速 ${s.bLen} 字节`
          + (s.aHit || s.bHit ? '（不该命中缓存的）' : '')
      });
      console.log('[' + stamp() + '] 语速 ' + s.aLen + ' → ' + s.bLen + ' 字节（倍率 ' + s.lsA + '/' + s.lsB + '）');
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

    /* 18. 全部记录与删除
     * 「最近记录」只显示 20 条，明细里其实留了 2000 条。这条守四件事：
     * 能翻到全部、能删单条、删了能在提示条上撤销、以及删/撤销之后
     * 「最近记录」的条数和分组计数都跟着对上（数字对不上比没有入口更糟）。 */
    {
      const open = await client.evaluate(`
        switchView('stats');
        await new Promise(r => setTimeout(r, 350));
        const btn = document.querySelector('#btnAllLogs');
        if (!btn) return { err: '没有「全部记录」按钮' };
        btn.click();
        await new Promise(r => setTimeout(r, 600));
        const box = document.querySelector('#allLogsBox');
        const rows = box ? box.querySelectorAll('.alrow').length : 0;
        const first = box ? box.querySelector('.alrow') : null;
        const del = first ? first.querySelector('[data-del]') : null;
        return {
          rows,
          logs: ST.logs.length,
          name: first ? (first.querySelector('.n') || {}).textContent : '',
          id: del ? del.dataset.del : '',
          groups: box ? box.querySelectorAll('.algroup').length : 0,
          gcount: box && box.querySelector('.gcount') ? box.querySelector('.gcount').textContent : ''
        };
      `);
      const file = await client.shot('18-全部记录');

      const act = await client.evaluate(`
        const first = document.querySelector('#allLogsBox .alrow');
        if (!first) return { err: '弹层里没有行' };
        first.querySelector('[data-del]').click();
        await new Promise(r => setTimeout(r, 800));
        const rowsAfterDel = document.querySelectorAll('#allLogsBox .alrow').length;
        const gcountAfterDel = document.querySelector('#allLogsBox .gcount').textContent;
        const logsAfterDel = ST.logs.length;
        const undo = document.querySelector('#undoBtn');
        const hasUndo = !!undo;
        if (undo) undo.click();
        await new Promise(r => setTimeout(r, 1000));
        return {
          rowsAfterDel, gcountAfterDel, logsAfterDel, hasUndo,
          rowsAfterUndo: document.querySelectorAll('#allLogsBox .alrow').length,
          logsAfterUndo: ST.logs.length,
          pomo: ST.totals.pomodoros
        };
      `);

      const closed = await client.evaluate(`
        const b = document.querySelector('#modalRoot [data-act="ok"]');
        if (b) b.click();
        await new Promise(r => setTimeout(r, 250));
        return { stillOpen: !!document.querySelector('#allLogsBox') };
      `);

      const ok = !open.err && !act.err
        && open.rows > 0 && open.rows >= open.logs
        && act.rowsAfterDel === open.rows - 1
        && act.rowsAfterUndo === open.rows
        && act.hasUndo
        && act.logsAfterDel === open.logs - 1
        && act.logsAfterUndo === open.logs
        && act.gcountAfterDel === String(Math.max(0, Number(open.gcount) - 1))
        && !closed.stillOpen;

      results.push({
        name: '全部记录与删除', ok, file,
        note: open.err || act.err || (
          `明细 ${open.rows} 条 / ${open.groups} 个月分组 · 删除「${open.name}」→ ${act.rowsAfterDel} 条`
          + `（分组 ${open.gcount}→${act.gcountAfterDel}）· 撤销 → ${act.rowsAfterUndo} 条`
          + ` · 最近记录 ${open.logs}→${act.logsAfterDel}→${act.logsAfterUndo} · 累计 ${act.pomo} 条`)
      });
      console.log('[' + stamp() + '] 全部记录 ' + open.rows + ' 条 · 删后 ' + act.rowsAfterDel
        + ' · 撤销后 ' + act.rowsAfterUndo + ' · 弹层' + (closed.stillOpen ? '没关掉' : '已关闭'));
    }

    /* 19. 清空重来
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
