/* ============================================================
   朗读层回归（Node 直接运行，无需浏览器）
   运行：node test/speech.test.js
   通过标准：输出「✅ 朗读层全部断言通过」，退出码 0

   守的问题（v0.2.27）："配音太生硬"。定位到三层，这里三层都测：
   ① 喂给引擎的文本——`10～15次` 被念成"10 15次"、`mmHg` 拼成字母、
      `10次×2组` 念成"10次乘2组"。**这是机器味的主因**，所以不只测几条
      样例，而是拿真实的动作库和文章库全量扫一遍，确保没有漏网的写法。
   ② 句间停顿——原先"上一句 onend 立刻念下一句"，机关枪式没有换气。
      用桩 speechSynthesis 记时间戳，真的量出停顿，不只是看源码里有没有写。
   ③ 音色——各系统音色名长短差别巨大，认不出的必须收短，不能把
      `Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)` 塞进按钮。

   注：显示文案一个字都不能改，所以这里同时反向断言——数据文件里那些
   给眼睛看的写法（～ × mmHg）必须还在，只有朗读稿变了。
   ============================================================ */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error('FAIL:', msg); }
}
function eq(actual, expected, msg) {
  assert(actual === expected, `${msg}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`);
}

/* ---------- 桩：Node 里没有 Web Speech API ----------
   speak() 立刻回 onstart，再按"每字 8ms"回 onend，模拟真实的异步出声。
   只有这样才能量出句与句之间的留白到底有没有。 */
const spoken = [];          // { text, at }
let voiceList = [];
globalThis.speechSynthesis = {
  getVoices: () => voiceList,
  speak(u) {
    spoken.push({ text: u.text, at: Date.now(), voice: u.voice ? u.voice.name : '', rate: u.rate, lang: u.lang });
    setTimeout(() => { if (u.onstart) u.onstart(); }, 0);
    setTimeout(() => { if (u.onend) u.onend(); }, Math.max(4, u.text.length * 8));
  },
  cancel() {},
  addEventListener() {},
};
globalThis.SpeechSynthesisUtterance = class {
  constructor(text) { this.text = text; this.voice = null; this.rate = 1; this.pitch = 1; this.lang = ''; }
};

const src = read('js/speech.js');
eval(src + '; globalThis.Speech = Speech;');

const N = Speech.normalize;

/* ============================================================
   ① 归一化：单条规则
   ============================================================ */
eq(N('每侧10～15次'), '每侧10到15次', '全角波浪号范围要念成"到"（引擎多半直接跳过 ～）');
eq(N('10~15次'), '10到15次', '半角波浪号同样处理');
eq(N('每侧10次×2组'), '每侧10次，做2组', '乘号是"做几组"，不是"乘"');
eq(N('目标 130/80 mmHg 以下'), '目标 高压130、低压80毫米汞柱 以下', '血压不能念成"130斜杠80"');
eq(N('降到 1.8 mmol/L 以下'), '降到 1.8毫摩尔每升 以下', '血糖血脂单位要念中文');
eq(N('100 mg/dL'), '100毫克每分升', 'mg/dL 要念中文');
eq(N('收缩压 140 mmHg'), '收缩压 140毫米汞柱', '裸 mmHg 也要念中文');
eq(N('糖化血红蛋白（HbA1c）7%'), '糖化血红蛋白百分之7', '纯英文缩写的括注整段去掉，正文里的缩写念全称');
eq(N('HbA1c 目标'), '糖化血红蛋白 目标', '缩写在正文里出现时念全称');
eq(N('低密度脂蛋白胆固醇（LDL-C）'), '低密度脂蛋白胆固醇', '括注里的 LDL-C 去掉不重复念');
eq(N('看 LDL-C 指标'), '看 低密度脂蛋白胆固醇 指标', '正文里的 LDL-C 念全称');
eq(N('记住 BE-FAST'), '记住 B E F A S T', '口诀要逐字母念清楚，这是要教患者背的');
eq(N('保持5秒/次'), '保持5秒一次', '`/次` 是"一次"');
eq(N('轻型/小卒中'), '轻型或小卒中', '其余斜杠都是"或"');
eq(N('容易／适中／挑战'), '容易或适中或挑战', '全角斜杠同样处理');
eq(N('双手扶→单手扶→指尖轻扶'), '双手扶，再单手扶，再指尖轻扶', '递进箭头要念成"再"');
eq(N('下降 50%'), '下降 百分之50', '百分号要念成"百分之"');
eq(N('餐后2h血糖'), '餐后2小时血糖', 'h 是小时');
eq(N('口角歪斜 · 单侧无力'), '口角歪斜，单侧无力', '间隔号当停顿');
eq(N('阿司匹林+氯吡格雷'), '阿司匹林加氯吡格雷', '药名之间的加号要念"加"');
eq(N('脑损伤+巨大生活变化'), '脑损伤加巨大生活变化', '中文之间的加号一律念"加"');
eq(N('改回一种——什么时候改'), '改回一种，什么时候改', '破折号引出的补充说明念成停顿');
eq(N('肢体运动 —— 卧床期'), '肢体运动，卧床期', '带空格的破折号同样处理');
/* 破折号规则只能吃空格制表符：吃掉换行会把上下两句粘成一句 */
/* ---------- 换行是切句的依据，任何规则都不许吃掉它 ----------
   `splitSentences()` 靠 `\n` 断句，所以归一化里凡是"吃前后空白"的地方都只能用
   `[ \t]`；写成 `\s*` 会连换行一起吞掉，把上一句和下一句粘成一句破句念到底
   ——这正是 v0.2.27 要修的那类"生硬"。这条踩过两次：第一次是破折号规则，
   第二次是乘号/斜杠/箭头/间隔号等 6 条（真实内容当时恰好没触发，是潜伏 bug）。
   所以这里不只测踩过的那一条，而是**逐条**喂"上一句。\n<该符号开头的下一句>"，
   以后新增规则漏用 `[ \t]` 会立刻在这里失败。 */
const NEWLINE_CASES = [
  ['上一句。\n——补充说明', '破折号'],
  ['第一组做完了。\n×2组继续', '乘号'],
  ['每天两遍。\n/次记一下', '斜杠加次'],
  ['方案甲。\n/备选方案', '裸斜杠'],
  ['先扶稳。\n→再迈步', '箭头'],
  ['注意安全。\n·扶好扶手', '间隔号'],
  ['共10。\n～15次', '波浪号'],
  ['下降了5。\n%的幅度', '百分号'],
  ['休息2。\nh后再练', '小时'],
  ['目标130。\n/80 mmHg', '血压斜杠'],
  ['血脂达标。\nmmol/L 是单位', '毫摩尔单位'],
  ['血压记录。\nmmHg 是单位', '汞柱单位'],
  ['看这项。\nLDL-C 指标', 'LDL 缩写'],
  ['记住口诀。\nBE-FAST', 'BE-FAST 口诀'],
  ['正常范围。\n(ASCII) 后续', 'ASCII 括注'],
];
NEWLINE_CASES.forEach(([input, why]) => {
  const out = N(input);
  assert(out.includes('\n'),
    `${why}规则吃掉了换行，会把两句粘成一句（吃空白只能用 [ \\t]，不能用 \\s）：${JSON.stringify(out)}`);
  assert(Speech.splitSentences(out).length >= 2,
    `${why}规则导致切句失败，两句被粘成一句：${JSON.stringify(out)}`);
});
/* 兜底：直接扫规则表源码。上面的用例只覆盖已知符号，这条防的是
   "新加一条规则、又没给它写用例"——正则里出现 `\s*` 紧贴替换目标就该警觉。 */
{
  const rulesSrc = read('js/speech.js').split('const SPEAK_RULES = [')[1].split('\n  ];')[0];
  const withS = rulesSrc.split('\n').filter(l => /^\s*\[\//.test(l) && /\\s\*/.test(l));
  assert(!withS.length,
    `SPEAK_RULES 里仍有规则用 \\s* 吃空白（会吞换行、粘句），改用 [ \\t]*：\n      ${withS.join('\n      ')}`);
}
/* 老 WebView 不支持 lookbehind，用到就整个文件解析失败、朗读全哑 */
assert(!/\(\?<[=!]/.test(read('js/speech.js')), 'speech.js 不得使用 lookbehind（老 WebView 会整文件解析失败）');
eq(N('🛡️ 防复发'), '防复发', '图标是给眼睛的，不能念出来');
eq(N('第一步，，抬手'), '第一步，抬手', '替换后留下的叠标点要收掉');
eq(N(''), '', '空字符串不炸');
eq(N(null), '', 'null 不炸（getText() 可能拿到空）');

/* 顺序敏感：含斜杠的单位必须排在裸斜杠规则之前，否则 mmol/L 会先变成 "mmol或L" */
assert(!/或/.test(N('1.8 mmol/L')), 'mmol/L 不能被裸斜杠规则先吃掉（规则顺序错了）');
assert(!/斜杠|slash/.test(N('130/80 mmHg')), '血压不能残留斜杠');
/* 去 emoji 的码位区间覆盖了箭头，必须排在箭头规则之后，否则箭头会被直接删掉、丢掉递进关系 */
assert(N('A→B').includes('再'), '箭头规则必须排在去 emoji 之前（否则递进关系被删没了）');

/* 中文括注是正文不是注解，不能跟着 ASCII 括注一起删 */
assert(N('（如阿司匹林、氯吡格雷）').includes('阿司匹林'), '中文括注是正文，不能删');
assert(N('（Bobath握手）').includes('握手'), '中英混排的括注是正文，不能删');
assert(N('（多见于轻型/小卒中）').includes('小卒中'), '含中文的括注不能删');

/* 数值一个都不能改——医学数字念错比念得生硬严重得多 */
['130', '80', '1.8', '7', '10', '15', '140', '90'].forEach(n => {
  assert(N(`目标 ${n} 以下`).includes(n), `归一化不得改动数值 ${n}`);
});

/* ============================================================
   ② 归一化：拿真实内容库全量扫
      样例测试只能覆盖想到的写法，漏一个就是一处生硬。
   ============================================================ */
eval(read('js/data-exercises.js') + '; globalThis.EXERCISES = EXERCISES;');
eval(read('js/data-articles.js') + '; globalThis.ARTICLES = ARTICLES; globalThis.BEFAST = BEFAST;');

/* 与 app.js 的 exerciseSpeechText 同构（那边依赖 DOM，这里只取同一批字段） */
function exScript(ex) {
  const lines = [ex.name + '。', ex.goal + '。', '动作要领。'];
  ex.steps.forEach((s, i) => lines.push(`第${i + 1}步，${s}。`));
  lines.push(`建议量，${ex.dose}。`);
  if (ex.caution) lines.push(`注意，${ex.caution}`);
  return lines.join('\n');
}
const stripTags = html => String(html).replace(/<[^>]*>/g, '\n');

/* 念出来会变成噪音的写法：朗读稿里一个都不该剩 */
const LEFTOVERS = [
  [/[～~]/, '波浪号（会被念漏，范围听不出来）'],
  [/[×✕]/, '乘号（会被念成"乘"）'],
  [/mmHg/i, 'mmHg（会被拼成字母）'],
  [/mmol/i, 'mmol（会被拼成字母）'],
  [/HbA1c/i, 'HbA1c（会被拼成字母）'],
  [/LDL/i, 'LDL（会被拼成字母）'],
  [/[／/]/, '斜杠（会被念成"斜杠"或直接跳过）'],
  [/[→⇒]/, '箭头（递进关系听不出来）'],
  [/%/, '百分号'],
  [/—/, '破折号（引擎会跳过或念出怪音）'],
  [/[\u4e00-\u9fa5][ \t]*\+/, '中文之间的加号（"阿司匹林+氯吡格雷"念不出来）'],
  [/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u, '图标'],
];

let scanned = 0;
EXERCISES.forEach(ex => {
  const out = N(exScript(ex));
  scanned++;
  LEFTOVERS.forEach(([re, why]) => {
    const m = out.match(re);
    assert(!m, `动作「${ex.name}」(${ex.id}) 的朗读稿仍残留 ${why}：…${out.slice(Math.max(0, out.indexOf(m ? m[0] : '') - 12), (out.indexOf(m ? m[0] : '') + 14))}…`);
  });
});
ARTICLES.forEach(a => {
  const out = N(`${a.title}。${a.sub}。\n${stripTags(a.body)}`);
  scanned++;
  LEFTOVERS.forEach(([re, why]) => {
    const m = out.match(re);
    assert(!m, `文章「${a.title}」的朗读稿仍残留 ${why}：…${out.slice(Math.max(0, out.indexOf(m ? m[0] : '') - 12), (out.indexOf(m ? m[0] : '') + 14))}…`);
  });
});
BEFAST.forEach(b => {
  const out = N(`${b.name}。${b.desc}。`);
  scanned++;
  assert(!/[／/]/.test(out), `BE-FAST「${b.name}」朗读稿残留斜杠`);
});
assert(scanned >= 20, `真实内容扫描数量异常（只扫了 ${scanned} 条，数据文件可能没加载上）`);

/* 反向断言：**显示文案一个字都不能改**。数据文件里给眼睛看的写法必须还在。 */
const exSrc = read('js/data-exercises.js');
const artSrc = read('js/data-articles.js');
assert(/[～]/.test(exSrc), '动作库里的 ～ 是给眼睛看的，不能为了朗读去改数据文件');
assert(/[×]/.test(exSrc), '动作库里的 × 是给眼睛看的，不能为了朗读去改数据文件');
assert(/mmHg/.test(artSrc) && /HbA1c/.test(artSrc), '文章里的医学缩写是给眼睛看的，不能为了朗读去改数据文件');

/* ============================================================
   ③ 切句与停顿：真的量出留白
   ============================================================ */
eq(Speech.splitSentences('甲。乙。丙。').length, 3, '句末标点处要断开');
eq(Speech.splitSentences('甲\n乙').length, 2, '换行也算断句（分步要领靠它分开）');
assert(Speech.splitSentences('康'.repeat(200)).every(s => s.length <= 120),
  '超长无标点句子必须硬断，否则部分浏览器会整句截断');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function reset() { spoken.length = 0; Speech.stop(); }

(async () => {
  /* --- 句号处换气 --- */
  reset();
  await new Promise(done => {
    Speech.speak('甲一。乙二。丙三。', { rateKey: 'fast', onEnd: done });
  });
  eq(spoken.length, 3, '三句应分三次朗读');
  eq(spoken.map(s => s.text).join('|'), '甲一。|乙二。|丙三。', '朗读顺序必须与原文一致');
  for (let i = 1; i < spoken.length; i++) {
    const gapStart = spoken[i - 1].at + spoken[i - 1].text.length * 8;
    const gap = spoken[i].at - gapStart;
    assert(gap >= 200, `第${i}句与第${i + 1}句之间应有换气停顿（实测约 ${gap}ms，机关枪式朗读就是"生硬"的来源之一）`);
    assert(gap < 1200, `句间停顿不应拖沓（实测约 ${gap}ms）`);
  }

  /* --- 逗号切开的只稍顿，不能和句号一样长 --- */
  reset();
  const long = '康'.repeat(70) + '，' + '收尾。';
  await new Promise(done => { Speech.speak(long, { rateKey: 'fast', onEnd: done }); });
  eq(spoken.length, 2, '过长句子应在逗号处切开');
  const clauseGap = spoken[1].at - (spoken[0].at + spoken[0].text.length * 8);
  assert(clauseGap >= 40, `逗号处也要稍顿（实测约 ${clauseGap}ms）`);
  assert(clauseGap < 260, `逗号处的停顿应短于句末换气（实测约 ${clauseGap}ms，和句号一样长会拖沓）`);

  /* --- 停顿期间被打断：不能等定时器到点又把旧内容念下去 --- */
  reset();
  Speech.speak('甲一。乙二。丙三。', { rateKey: 'fast' });
  await sleep(40);          // 第一句念完、正处在句间停顿里
  Speech.stop();
  const afterStop = spoken.length;
  await sleep(600);
  eq(spoken.length, afterStop, '停止后不得再念（句间停顿的定时器必须认代号作废）');
  assert(!Speech.speaking(), '停止后 speaking() 应为 false');

  /* --- 归一化对所有调用方生效：调用方只管传屏幕上的文字 --- */
  reset();
  await new Promise(done => { Speech.speak('每侧10～15次×2组。', { rateKey: 'fast', onEnd: done }); });
  const heard = spoken.map(s => s.text).join('');
  assert(heard.includes('10到15次') && heard.includes('，做2组'),
    `speak() 必须自己做归一化，调用方不该各自处理（实际念的是「${heard}」）`);
  assert(!/[～×]/.test(heard), '实际念出的文本不得残留 ～ ×');

  /* --- 语速 --- */
  eq(Speech.rateOf('slow') < Speech.rateOf('mid'), true, '慢档必须比适中慢');
  eq(Speech.rateOf('mid') < Speech.rateOf('fast'), true, '适中必须比快档慢');
  eq(Speech.rateOf('不存在的档'), Speech.rateOf('slow'), '非法语速键回落到慢档（老人听得清优先）');
  reset();
  await new Promise(done => { Speech.speak('测速。', { rateKey: 'fast', onEnd: done }); });
  eq(spoken[0].rate, Speech.rateOf('fast'), '语速必须传到 utterance 上');

  /* ============================================================
     ④ 音色：选择、回落、名字收短
     ============================================================ */
  voiceList = [
    { name: 'Tingting', lang: 'zh-CN' },
    { name: 'Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)', lang: 'zh-CN' },
    { name: 'Sinji', lang: 'zh-HK' },
    { name: 'Daniel', lang: 'en-GB' },
    { name: 'Chinese China', lang: 'zh_CN' },
  ];
  const opts = Speech.voices();
  eq(opts.length, 4, '只列中文音色，英文音色不该出现在选项里');
  assert(!opts.some(o => /Daniel/.test(o.name)), '英文音色不得混进中文音色列表');
  eq(opts.find(o => o.name === 'Tingting').label, '婷婷（女声）', '认识的音色给中文名');
  eq(opts.find(o => o.name === 'Sinji').label, '欣悦（女声）', '认识的音色给中文名');
  const winLabel = opts.find(o => /Xiaoxiao/.test(o.name)).label;
  eq(winLabel, '晓晓（女声）', 'Windows 的长名字必须按人名认出来，不能整串塞进按钮');
  opts.forEach(o => {
    assert(o.label.length <= 12, `音色名必须收短才放得进按钮（"${o.label}" 太长）`);
    assert(!/microsoft|online|natural|\(/i.test(o.label), `音色名不该露出厂商与技术词（"${o.label}"）`);
  });
  eq(Speech.voices().find(o => o.name === 'Chinese China').label, '中文语音',
    '认不出人名时用"中文语音"兜底，不摊一串英文给患者');

  /* 指定音色 */
  eq(Speech.setVoice('Sinji'), true, '指定本机存在的音色应成功');
  eq(Speech.voiceName(), 'Sinji', '指定后 voiceName() 要跟着变');
  reset();
  await new Promise(done => { Speech.speak('换个声音。', { rateKey: 'fast', onEnd: done }); });
  eq(spoken[0].voice, 'Sinji', '指定的音色必须真的用在 utterance 上');
  eq(spoken[0].lang, 'zh-HK', 'lang 应跟随所选音色，而不是写死 zh-CN');

  /* 换手机、恢复别人的备份：存着的音色名在本机不存在 → 静默回落，不能哑掉 */
  eq(Speech.setVoice('不存在的音色'), false, '本机没有该音色时应返回 false（界面据此不高亮它）');
  assert(Speech.voiceName() !== '', '回落后必须仍有可用音色，不能变成哑的');
  eq(Speech.voiceName(), 'Tingting', '回落优先大陆普通话（zh-CN 排在 zh-HK 之前）');
  reset();
  await new Promise(done => { Speech.speak('回落。', { rateKey: 'fast', onEnd: done }); });
  eq(spoken.length, 1, '音色回落后仍要正常出声');

  /* 跟随系统 */
  eq(Speech.setVoice(''), false, '空字符串＝跟随系统');
  eq(Speech.voiceName(), 'Tingting', '跟随系统时选大陆普通话');
  Speech.setVoice(undefined);
  assert(Speech.voiceName() !== '', 'setVoice(undefined) 不炸也不哑（恢复旧备份时 profile 里没这个字段）');

  if (failed) {
    console.error(`❌ ${failed} 项朗读层断言失败`);
    process.exit(1);
  }
  console.log(`✅ 朗读层全部断言通过（含 ${scanned} 条真实动作/文章朗读稿全量扫描）`);
})().catch(e => {
  console.error('❌ 朗读层测试异常：', e);
  process.exit(1);
});
