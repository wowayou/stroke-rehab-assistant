/* ============================================================
   语音朗读（Web Speech API，零依赖、纯前端）
   给读字困难、视力差、失语恢复期的患者用："听"比"读"省力。

   Speech.supported()            浏览器是否支持
   Speech.speak(text, {onEnd})   朗读（会先停掉上一段）
   Speech.stop()                 停止
   Speech.speaking()             是否正在朗读
   Speech.rateOf(key)            'slow'|'mid'|'fast' → 语速倍率
   Speech.voices()               本机可用的中文音色（可能为空/异步才有）
   Speech.setVoice(name)         指定音色（''=跟随系统；机上没有则自动回落）
   Speech.normalize(text)        朗读前的口语化（导出给测试）

   为什么听起来"生硬"，以及这里做了什么（v0.2.27）：
   · **主因是喂给引擎的文本，不是音色**——`10～15次` 会被念成"10 15次"、
     `mmHg` 拼成"m m h g"、`10次×2组` 念成"10次乘2组"。归一化后才像人话。
   · 句子之间原先是"上一句 onend 立刻 speak 下一句"，机关枪式没有换气；
     现在按标点给不同长度的停顿。
   · 有些系统装了多个中文音色，默认那个不一定最好听 → 允许选。

   已处理的坑：
   · Chrome 语音列表异步加载（voiceschanged），首次朗读可能拿不到中文音色；
   · 长文本在部分浏览器会被截断 → 按句切分排队朗读；
   · onend 偶发不触发 → 加看门狗定时器兜底推进队列；
   · 切页/关弹窗必须 stop()，否则 iOS 上会继续念。
   ============================================================ */

const Speech = (() => {
  const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  const RATES = { slow: 0.7, mid: 0.9, fast: 1.1 };

  /* 句子之间的停顿（毫秒）。人说话在句号处换气、逗号处只是稍顿，
     全都不停会像机关枪，全都长停会拖沓。 */
  const GAP_SENTENCE = 320;
  const GAP_CLAUSE = 130;

  let voice = null;
  let wantVoice = '';   // 用户指定的音色名，''=跟随系统
  let queue = [];
  let gen = 0;          // 代号：每次 stop/speak 自增，防止旧回调推进新队列
  let watchdog = null;
  let startGuard = null;
  let gapTimer = null;
  let onEndCb = null;
  let onFailCb = null;
  let active = false;
  let started = false;   // 本次朗读是否真的开口（用于识别静默失败的环境）

  /* 音色名多是英文（Tingting / Sinji），对老人没有意义，给个中文说法。
     用**子串**匹配而不是整名相等：各系统的名字长短差别很大，
     iOS 是 `Tingting`，安卓是 `Chinese China`，Windows 则是
     `Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)`——
     整名相等只能认出 iOS 那一种，其余会把一长串英文塞进按钮。
     认不出的走 shortLabel() 收短，不瞎猜名字。 */
  const VOICE_ALIAS = [
    ['tingting', '婷婷（女声）'],
    ['sinji', '欣悦（女声）'],
    ['meijia', '美佳（女声）'],
    ['yueyue', '悦悦（女声）'],
    ['xiaoxiao', '晓晓（女声）'],
    ['xiaoyi', '晓伊（女声）'],
    ['xiaoyou', '晓悠（童声）'],
    ['huihui', '慧慧（女声）'],
    ['yaoyao', '瑶瑶（女声）'],
    ['yunxi', '云希（男声）'],
    ['yunyang', '云扬（男声）'],
    ['yunjian', '云健（男声）'],
    ['kangkang', '康康（男声）'],
    ['liang', '亮亮（男声）'],
    ['limu', '李牧（男声）'],
    ['yushu', '雨舒（女声）'],
    ['hanhan', '含含（女声）'],
    ['panpan', '盼盼（女声）'],
  ];

  /* 认不出的名字：去掉厂商前缀与括注（Microsoft … Online (Natural) - Chinese (Mainland)），
     只留中间那个人名；实在没有人名就用"中文语音"兜底，不把整串英文摊给用户。 */
  function shortLabel(name) {
    let s = String(name || '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\b(microsoft|google|chrome os|android|apple|com\.apple\.[\w.-]+)\b/gi, ' ')
      .replace(/\b(online|natural|desktop|mobile|compact|enhanced|premium|neural|voice)\b/gi, ' ')
      .replace(/\b(chinese|mandarin|china|mainland|taiwan|hong kong|cantonese|simplified|traditional)\b/gi, ' ')
      .replace(/[-_,]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (/[\u4e00-\u9fa5]/.test(s)) s = s.replace(/[A-Za-z]/g, '').trim();
    return s || '中文语音';
  }

  function zhVoices() {
    if (!synth) return [];
    return (synth.getVoices() || []).filter(v => /^zh/i.test(v.lang || ''));
  }

  function pickVoice() {
    if (!synth) return;
    const zh = zhVoices();
    if (!zh.length) return;
    /* 用户指定的优先；否则大陆普通话优先，再退到任意中文。
       指定的音色在这台机器上不存在（换手机、恢复备份）时静默回落，不报错。 */
    voice = (wantVoice && zh.find(v => v.name === wantVoice))
      || zh.find(v => /^zh[-_]CN/i.test(v.lang))
      || zh[0]
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

  /* 本机可用中文音色。注意 getVoices() 是异步填充的，开机首屏可能返回空数组，
     所以调用方只能"有就显示、没有就不显示"，不能据此判断本机不支持朗读。 */
  function voices() {
    return zhVoices().map(v => {
      const key = String(v.name || '').toLowerCase().replace(/[\s\-_]+/g, '');
      const hit = VOICE_ALIAS.find(([k]) => key.includes(k));
      return { name: v.name, lang: v.lang, label: hit ? hit[1] : shortLabel(v.name) };
    });
  }
  function setVoice(name) {
    wantVoice = typeof name === 'string' ? name : '';
    pickVoice();
    return !!(wantVoice && voice && voice.name === wantVoice);
  }
  function voiceName() { return voice ? voice.name : ''; }

  /* ---------- 朗读文本归一化 ----------
     屏幕上的写法是给眼睛的：`10～15次`、`130/80 mmHg`、`每侧10次×2组`。
     原样丢给 TTS 会念成"10 15次""m m h g""10次乘2组"——**机器味主要来自这里**。
     所以朗读前换成口语说法；**界面显示一个字都不改**（数据文件不动）。

     顺序敏感，别随手调换：
     · 含 `/` 的单位（mmol/L、130/80 mmHg）必须排在裸 `/` 规则之前；
     · 去 emoji 的码位区间覆盖了箭头，必须排在箭头规则之后。 */
  const SPEAK_RULES = [
    /* 括号里只剩 ASCII 缩写时整段去掉：`糖化血红蛋白（HbA1c）` 念全称就够了，
       念成"括号 H b A 1 c"只会让人分神。含中文的括号（如"（Bobath握手）"、
       "（10以内）"）保留——那是正文不是注解。 */
    [/[（(][A-Za-z0-9][A-Za-z0-9\s.\-]*[)）]/g, ''],
    /* 血压 `130/80 mmHg`：念"130斜杠80"没人听得懂，直接说清高压低压（不改数值） */
    [/([0-9]+)[ \t]*\/[ \t]*([0-9]+)[ \t]*mmHg/g, '高压$1、低压$2毫米汞柱'],
    /* 单位前面那个空格要一起吃掉：屏幕上 `1.8 mmol/L` 分开好读，
       念出来"1.8 毫摩尔每升"中间那一顿很别扭。只吃空格和制表符，
       不用 \s——那会把换行也吃掉，把上一句和下一句粘成一句。 */
    [/[ \t]*mmol[ \t]*\/[ \t]*L/gi, '毫摩尔每升'],
    [/[ \t]*mg[ \t]*\/[ \t]*dL/gi, '毫克每分升'],
    [/[ \t]*mmHg/g, '毫米汞柱'],
    [/HbA1c/gi, '糖化血红蛋白'],
    [/LDL[-\s]?C/g, '低密度脂蛋白胆固醇'],
    /* 要教患者记住的口诀，逐个字母念清楚 */
    [/BE[-\s]?FAST/gi, 'B E F A S T'],
    /* 药名之间的 `+`：`阿司匹林+氯吡格雷` 念"加"，别念成"正号"或直接跳过。
       只在两侧都是中文时替换，数字算式不碰。
       **不能用 lookbehind**——老 WebView 不支持，整个文件会解析失败、朗读功能全哑，
       所以用捕获组把左边那个字带回来。 */
    [/([\u4e00-\u9fa5])[ \t]*\+[ \t]*(?=[\u4e00-\u9fa5])/g, '$1加'],
    /* 破折号 `——` 引出的是补充说明，念成停顿；正文里有 13 处。
       引擎对它的处理各不相同（跳过、或念出怪音），统一成逗号最稳。
       只吃空格制表符，不用 \s——那会把换行吃掉，把上下两句粘成一句。 */
    [/[ \t]*—{1,2}[ \t]*/g, '，'],
    /* 数量范围 `10～15次` → `10到15次`（全角 ～ 在数据里有 49 处，引擎多半直接跳过） */
    [/([0-9])[ \t]*[～~][ \t]*([0-9])/g, '$1到$2'],
    /* `每侧10次×2组` → `每侧10次，做2组`。
       只看右边是数字，不要求左边也是数字——动作库里 7 处乘号左边全是量词
       （`10次×2组`、`5～10个台阶×2～3回`、`保持5～10秒×8～12次`），
       要求左边是数字会一处都匹配不上，全部照原样念成"乘"。 */
    [/[ \t]*[×✕][ \t]*(?=[0-9])/g, '，做'],
    /* `保持5秒/次` → `保持5秒一次` */
    [/[ \t]*[／/][ \t]*次/g, '一次'],
    /* 剩下的斜杠都是"或"：`轻型/小卒中`、`普利/沙坦类`、`容易／适中／挑战` */
    [/[ \t]*[／/][ \t]*/g, '或'],
    /* 递进箭头 `双手扶→单手扶→指尖轻扶` → `双手扶，再单手扶，再指尖轻扶` */
    [/[ \t]*[→⇒][ \t]*/g, '，再'],
    /* `7%` → `百分之7`。数字部分必须用 `+` 收全：写成 `([0-9](?:\.[0-9]+)?)`
       只吃一位，`50%` 会被拆成"5百分之0"——数字念错比念得生硬严重得多。 */
    [/([0-9]+(?:\.[0-9]+)?)[ \t]*%/g, '百分之$1'],
    /* `餐后2h` → `餐后2小时` */
    [/([0-9])[ \t]*h(?![A-Za-z])/g, '$1小时'],
    /* 间隔号当停顿：`口角歪斜 · 单侧肢体无力` */
    [/[ \t]*·[ \t]*/g, '，'],
    /* 图标是给眼睛的，念出来是"笑脸""房子" */
    [/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{FE0F}\u{20E3}]/gu, ''],
    /* 上面的替换会留下叠标点和多余空白。
       同样只吃空格制表符：这里若用 \s 会把换行一起吃掉，
       而换行是切句的依据（`。\n，` 会被整段收成一句，上下两句粘在一起）。 */
    [/[，、][ \t]*(?=[，、])/g, ''],
    [/。[ \t]*(?=[。，、])/g, ''],
    [/[ \t]{2,}/g, ' '],
    [/^[，、。 \t]+/gm, ''],
  ];

  function normalize(text) {
    let s = String(text == null ? '' : text);
    for (const [re, to] of SPEAK_RULES) s = s.replace(re, to);
    return s.trim();
  }

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

  /* 这句念完该停多久：句末标点＝换气，逗号切开的＝稍顿 */
  function gapAfter(s) {
    return /[。！？!?；;]$/.test(String(s).trim()) ? GAP_SENTENCE : GAP_CLAUSE;
  }

  function clearWatchdog() {
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
  }
  function clearStartGuard() {
    if (startGuard) { clearTimeout(startGuard); startGuard = null; }
  }
  function clearGap() {
    if (gapTimer) { clearTimeout(gapTimer); gapTimer = null; }
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
    clearGap();
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
    /* 指定音色失败不能让整段朗读哑掉——退回系统默认音色照样念得出来。
       voice 是上一次 getVoices() 拿到的对象，语音包在中途被系统换掉/卸载时
       这个引用会失效，赋值即抛。宁可音色不如意，也不要一句话都听不到。 */
    if (voice) {
      try { u.voice = voice; } catch (e) { /* 用系统默认音色 */ }
    }
    u.lang = (voice && voice.lang) || 'zh-CN';
    u.rate = rate;
    u.pitch = 1;

    let advanced = false;
    /* 句间留白后再念下一句。停顿也要认代号：停顿期间用户点了停止或换了内容，
       定时器到点不能把旧队列接着念下去。 */
    const advance = () => {
      if (advanced || myGen !== gen) return;
      advanced = true;
      clearWatchdog();
      const gap = queue.length ? gapAfter(text) : 0;
      clearGap();
      if (!gap) { step(myGen, rate); return; }
      gapTimer = setTimeout(() => {
        gapTimer = null;
        if (myGen !== gen) return;
        step(myGen, rate);
      }, gap);
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
    /* 归一化放在这里，所有调用方（训练要领、文章、试听）自动受益 */
    const parts = splitSentences(normalize(text));
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

  return {
    supported, speak, stop, speaking, rateOf, splitSentences,
    normalize, voices, setVoice, voiceName,
  };
})();
