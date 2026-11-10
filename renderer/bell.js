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
