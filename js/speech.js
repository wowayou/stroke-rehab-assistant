/* ============================================================
   语音朗读（Web Speech API，零依赖、纯前端）
   给读字困难、视力差、失语恢复期的患者用："听"比"读"省力。

   Speech.supported()            浏览器是否支持
   Speech.speak(text, {onEnd})   朗读（会先停掉上一段）
   Speech.stop()                 停止
   Speech.speaking()             是否正在朗读
   Speech.rateOf(key)            'slow'|'mid'|'fast' → 语速倍率

   已处理的坑：
   · Chrome 语音列表异步加载（voiceschanged），首次朗读可能拿不到中文音色；
   · 长文本在部分浏览器会被截断 → 按句切分排队朗读；
   · onend 偶发不触发 → 加看门狗定时器兜底推进队列；
   · 切页/关弹窗必须 stop()，否则 iOS 上会继续念。
   ============================================================ */

const Speech = (() => {
  const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  const RATES = { slow: 0.7, mid: 0.9, fast: 1.1 };

  let voice = null;
  let queue = [];
  let gen = 0;          // 代号：每次 stop/speak 自增，防止旧回调推进新队列
  let watchdog = null;
  let startGuard = null;
  let onEndCb = null;
  let onFailCb = null;
  let active = false;
  let started = false;   // 本次朗读是否真的开口（用于识别静默失败的环境）

  function pickVoice() {
    if (!synth) return;
    const vs = synth.getVoices() || [];
    if (!vs.length) return;
    /* 优先中文（大陆普通话），退而求其次任意中文，最后交给浏览器默认 */
    voice = vs.find(v => /^zh[-_]CN/i.test(v.lang))
      || vs.find(v => /^zh/i.test(v.lang))
      || null;
  }
  if (synth) {
    pickVoice();
    if (typeof synth.addEventListener === 'function') {
      synth.addEventListener('voiceschanged', pickVoice);
    } else {
      synth.onvoiceschanged = pickVoice;
    }
  }

  function supported() {
    return !!(synth && typeof SpeechSynthesisUtterance !== 'undefined');
  }
  function rateOf(key) { return RATES[key] || RATES.slow; }

  /* 按句切分：中文句末标点后断开，过长的句子再按逗号断。
     不用正则 lookbehind（老 WebView 不支持，会整文件解析失败）。 */
  function splitSentences(text) {
    const out = [];
    let buf = '';
    const flush = () => { const s = buf.trim(); if (s) out.push(s); buf = ''; };
    for (const ch of String(text)) {
      buf += ch;
      if ('。！？；\n!?;'.includes(ch)) flush();
      else if (buf.length >= 60 && '，、,'.includes(ch)) flush();
      else if (buf.length >= 120) flush();
    }
    flush();
    return out;
  }

  function clearWatchdog() {
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
  }
  function clearStartGuard() {
    if (startGuard) { clearTimeout(startGuard); startGuard = null; }
  }

  function stop() {
    gen++;
    queue = [];
    active = false;
    started = false;
    onEndCb = null;
    onFailCb = null;
    clearWatchdog();
    clearStartGuard();
    if (synth) { try { synth.cancel(); } catch (e) { /* 忽略 */ } }
  }

  function speaking() { return active; }

  function step(myGen, rate) {
    if (myGen !== gen) return;
    if (!queue.length) {
      active = false;
      const cb = onEndCb; onEndCb = null;
      if (cb) cb();
      return;
    }
    const text = queue.shift();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = (voice && voice.lang) || 'zh-CN';
    u.rate = rate;
    u.pitch = 1;

    let advanced = false;
    const advance = () => {
      if (advanced || myGen !== gen) return;
      advanced = true;
      clearWatchdog();
      step(myGen, rate);
    };
    u.onstart = () => { started = true; clearStartGuard(); };
    u.onend = () => { started = true; clearStartGuard(); advance(); };
    u.onerror = advance;

    /* 看门狗：按字数估算时长（中文约每秒 4.5 字 × 语速）再宽放 3 秒 */
    const estMs = (text.length / (4.5 * rate)) * 1000 + 3000;
    clearWatchdog();
    watchdog = setTimeout(advance, Math.min(estMs, 30000));

    try { synth.speak(u); } catch (e) { advance(); }
  }

  function speak(text, opts = {}) {
    if (!supported()) return false;
    stop();
    const parts = splitSentences(text);
    if (!parts.length) return false;
    const myGen = gen;
    queue = parts;
    active = true;
    started = false;
    onEndCb = opts.onEnd || null;
    onFailCb = opts.onFail || null;
    /* 起播看门狗：有些环境（部分微信内置 WebView、未装语音包的系统）
       API 齐全但一个音色都没有，speak() 静默失败。1.5 秒还没开口就当不可用，
       让调用方给出提示，而不是留一个按了没反应的按钮。 */
    clearStartGuard();
    startGuard = setTimeout(() => {
      if (myGen !== gen || started) return;
      const cb = onFailCb;
      stop();
      if (cb) cb();
    }, 1500);
    step(myGen, opts.rate || rateOf(opts.rateKey));
    return true;
  }

  /* 注：不提供"本机是否有语音包"的查询接口——getVoices() 为空时无法区分
     "还没异步加载完"和"根本没有"，给不出可靠答案。能不能出声由 speak() 的
     起播看门狗（onFail）在真正尝试后告知，那是唯一可信的判断。 */

  return { supported, speak, stop, speaking, rateOf, splitSentences };
})();
