/* ============================================================
   应用公共层：共享状态、工具、少算数、分段控件、朗读稿装配
   ------------------------------------------------------------
   js/app/ 下的文件是**同一个程序切成的几段**（2026-10 由 app.js 拆出），
   靠 index.html 底部的固定顺序加载、共用一个全局作用域：
     core → overlay → today → train → records → meds → learn → settings → backup → boot
   所以一个文件里的函数可以直接调用另一个文件里的函数（运行时都已加载）；
   但**文件顶层立即执行的代码只能用排在它前面的文件里的东西**（如 boot.js 的 RENDERERS）。
   两条护栏（contracts / compat 测试）：各文件顶层名字不得重复；不得与浏览器自带的
   全局名同名（同名会悄悄盖掉 window 上的东西）。

   各文件：
     core.js      共享状态 + 工具(esc/toast/stored/beep/Awake) + 少算数 + 分段控件 + 朗读稿
     overlay.js   浮层与返回键(overlayPush/closeTopOverlayDOM/dismissTopOverlay) + openModal（硬约定 10）
     today.js     今日页
     train.js     训练页 → 打卡历史(日历+明细) → 训练引导器(计次/计时/游戏、常亮与提示音)
     records.js   记录页：判定 → 比上次 → 图表 → 三个表单(记录时间跟着现在走) → 导出
     meds.js      用药页：核对表 → 药物清单 → 服药历史 → 登记/停用/新疗程
     learn.js     知识页 + 急救弹窗(BE-FAST + 拨 120)
     settings.js  设置弹窗 + 字号/音色套用 + 换声音引导 + 首次指引
     backup.js    从备份恢复(选文件/粘贴/解密/预览) + 下载/复制/加密备份
     boot.js      渲染与导航(render/go) + 跨天与跨页面重画 + 离线缓存注册 + 初始化(init)
   每个文件内部仍用 `【区】` 标分区，搜它跳转。

   数据一律走 Store（storage.js），这些文件都不直接读写 localStorage。
   ============================================================ */

let currentView = 'today';
let recTab = 'bp';      // 记录页当前标签
let catTab = 'limb';    // 训练页当前分类
let trainerTimer = null;
let settingsRevision = 0;
const recordDrafts = {}; // 只保留当前页面会话中的未保存输入，不写入健康记录。
let recordSaved = null;

const $view = () => document.getElementById('view');
/* iOS 上"添加到主屏幕"的图标和 Safari 各用各的本地存储，互不相通：
   家人帮忙装好桌面图标后，老人会发现"记录全没了"。只在苹果手机上提示这一句。 */
const IS_IOS = 'standalone' in navigator && navigator.maxTouchPoints > 0;
const IS_IOS_HOME_ICON = navigator.standalone === true;
/* 微信（含企业微信）内置浏览器：不能下载文件（blob 下载被屏蔽），记录存在微信自己的
   存储里、清理微信缓存时可能一起被清掉。这里只用来换掉"下载备份"并给出搬家办法。 */
const IN_WECHAT = /MicroMessenger/i.test(navigator.userAgent);
const WECHAT_ADVICE = '建议点右上角「···」选「在浏览器打开」，再添加到桌面，以后从桌面图标进来。';

/* ============================================================
   【区】一、公共基础层：以下六个小节被各视图共用，改动波及全站
   ============================================================ */

/* ---------- 工具 ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), 5000);
}
function showError(node, message) {
  let feedback = node.querySelector('.save-feedback');
  if (!feedback) {
    feedback = document.createElement('div');
    feedback.className = 'notice danger save-feedback';
    feedback.setAttribute('role', 'alert');
    feedback.tabIndex = -1;
    node.prepend(feedback);
  }
  feedback.textContent = message;
  feedback.focus();
}
function clearFieldErrors(root) {
  root.querySelectorAll('.field-error').forEach(el => el.remove());
  root.querySelectorAll('[aria-invalid]').forEach(el => {
    el.removeAttribute('aria-invalid');
    const ids = (el.getAttribute('aria-describedby') || '').split(' ').filter(id => !id.endsWith('-error'));
    if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
    else el.removeAttribute('aria-describedby');
  });
}
function fieldError(id, message) {
  const field = document.getElementById(id);
  const error = document.createElement('p');
  error.id = id + '-error';
  error.className = 'field-error';
  error.textContent = message;
  field.insertAdjacentElement('afterend', error);
  field.setAttribute('aria-invalid', 'true');
  field.setAttribute('aria-describedby', [field.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' '));
  const row = field.closest('.dt-row');
  if (row) {
    row.hidden = false;
    document.getElementById(row.id.replace('-dt-row', '-dt-chip')).setAttribute('aria-expanded', 'true');
  }
  field.focus();
}
function pageHeading(title, hint) {
  return `<header class="page-heading"><h1 tabindex="-1">${esc(title)}</h1><p>${esc(hint)}</p></header>`;
}
function renderStorageNotice() {
  const notice = document.getElementById('storage-notice');
  const issue = Store.storageStatus();
  notice.hidden = !issue;
  notice.textContent = issue ? issue.message : '';
}
function stored(ok) {
  renderStorageNotice();
  if (ok) return true;
  const top = topOverlay();
  showError((top && top.querySelector('.modal-panel, .trainer-body')) || $view(),
    (Store.storageStatus() || {}).message || Store.actionError() || Store.backupError() || '没有保存成功，请重试');
  return false;
}
/* 提示音：训练页打开期间共用一个 AudioContext，并在用户点按时解锁。
   iOS 上不在点按里创建的 AudioContext 一直是 suspended，计时结束那一声
   （由定时器触发，不是点按）就会静音——老人放下手机做动作，最需要这一声。 */
let audioCtx = null;
function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx || audioCtx.state === 'closed') audioCtx = new AC();
    if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
  } catch (_) { audioCtx = null; }
}
function releaseAudio() {
  const ac = audioCtx;
  audioCtx = null;
  if (ac && ac.state !== 'closed') ac.close().catch(() => {});
}
function beep() {
  try {
    if (!audioCtx) unlockAudio();
    const ac = audioCtx;
    if (ac) {
      if (ac.state !== 'running') ac.resume().catch(() => {});
      const o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      o.frequency.value = 880; g.gain.value = 0.12;
      o.start(ac.currentTime);
      o.stop(ac.currentTime + 0.35);
    }
  } catch (e) { /* 没有声音也不影响训练：还有震动、文字和 toast */ }
  if (navigator.vibrate) navigator.vibrate(300);
}

/* 训练时屏幕常亮：老人把手机放在一边照着做，屏幕 30 秒就黑了，
   计时也看不见、要重新解锁。训练页开着时请求常亮（Screen Wake Lock，
   安卓 Chrome、iOS 16.4+ 支持；不支持就静默放弃）；10 分钟没碰屏幕且
   没有在计时就放掉，免得忘了关页面一直亮着耗电。页面切走时浏览器会自动
   释放，切回来再要。 */
const Awake = (() => {
  const IDLE_MS = 10 * 60 * 1000;
  let lock = null, wanted = false, idleTimer = null, busy = () => false;
  async function acquire() {
    if (!wanted || lock || !navigator.wakeLock || document.visibilityState !== 'visible') return;
    try {
      const l = await navigator.wakeLock.request('screen');
      if (!wanted || lock) { l.release().catch(() => {}); return; }
      lock = l;
      l.addEventListener('release', () => { if (lock === l) lock = null; });
    } catch (_) { /* 不支持、省电模式或被拒：不影响训练 */ }
  }
  function release() {
    const l = lock;
    lock = null;
    if (l) l.release().catch(() => {});
  }
  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (busy()) armIdle(); else release(); }, IDLE_MS);
  }
  return {
    start(isBusy) { wanted = true; busy = isBusy || (() => false); armIdle(); acquire(); },
    poke() { if (wanted) { armIdle(); acquire(); } },   // 点按训练页、切回本页时调用
    stop() { wanted = false; clearTimeout(idleTimer); release(); },
  };
})();

/* ---------- 少算数：把比率/分数换成"还差几个"与圆点 ----------
   设计依据：卒中后计算障碍常见，界面里的分数、百分比、心算都会增加
   挫败感。原则是「应用把算好的结论说出来」，把数字降为次要信息。 */
/* 进度圆点：做完的实心，剩下的空心；超过 12 个不画点（改用文字），避免糊成一片 */
function dotsHTML(done, total, cls = '') {
  if (!total || total > 12) return '';
  let s = '';
  for (let i = 0; i < total; i++) s += `<i class="pg-dot ${i < done ? 'on' : ''} ${cls}"></i>`;
  return `<div class="pg-dots" aria-hidden="true">${s}</div>`;
}
/* 「还差 N」文案：算好差值直接说，不让患者自己减 */
function leftText(done, total, unit = '项') {
  const left = Math.max(0, total - done);
  if (!total) return '';
  if (left === 0) return `都做完了 ✓`;
  if (done === 0) return `${total} ${unit}，一项一项来`;
  return `还差 ${left} ${unit}`;
}
/* 计次训练的可视进度：次数少用圆点（能一眼数出还差几个），
   次数多（如踝泵 20 次、踏步 30 次）圆点会糊成一片，改用进度条——
   无论哪种，患者都不必读数字就知道还剩多少。 */
function repTrackHTML(done, total) {
  if (total <= 12) return dotsHTML(done, total, 'big');
  return `<div class="progress-bar" style="width:100%;max-width:17rem"><div style="width:${Math.round(done / total * 100)}%"></div></div>`;
}
/* 秒数说成人话："大约 5 分钟"比 "5:00" 好懂，也免得患者换算分秒 */
function plainDuration(sec) {
  if (sec < 60) return `大约 ${sec} 秒`;
  const m = Math.floor(sec / 60), s = sec % 60;
  if (!s) return `大约 ${m} 分钟`;
  if (s === 30) return `大约 ${m} 分半`;
  return `大约 ${m} 分 ${s} 秒`;
}

/* ---------- 单选分段控件（字号/语速这类"立刻生效"的偏好） ----------
   两条规则，缺一个就会出现"显示和实际不一致"：
   ① 选中态**只从 Store 派生**，不靠 DOM 上残留的 .active 反推；
   ② 立刻生效的偏好点一下就落盘（同训练页阶段 chip），不等"保存设置"——
      设置弹窗有 ✕/返回键/Esc/点遮罩四种关法，只有一种会走保存按钮。
   无障碍：radiogroup + aria-checked，读屏能报"已选中，3 之 3"。 */
function segGroupHTML(name, label, options, current, cls = '') {
  const chips = options.map(o =>
    `<button type="button" role="radio" class="font-chip ${o.cls || ''} ${o.key === current ? 'active' : ''}"
       aria-checked="${o.key === current}" data-seg="${esc(name)}" data-seg-key="${esc(o.key)}"
     >${esc(o.label)}</button>`).join('');
  return `<div class="font-chips ${cls}" role="radiogroup" aria-label="${esc(label)}">${chips}</div>`;
}
/* current() 读真相（Store），commit(key) 负责落盘并返回是否成功。
   无论成功或失败都按 current() 重刷一遍——落盘失败时高亮会自己弹回旧值，
   用户看到的永远是真实生效的那一档，不会出现"看起来选上了其实没存"。
   键盘：左右/上下箭头在同组内移动选择（WAI-ARIA radiogroup 惯例）。 */
function bindSegGroup(root, name, { current, commit }) {
  const chips = [...root.querySelectorAll(`[data-seg="${name}"]`)];
  if (!chips.length) return () => {};
  const paint = () => chips.forEach(c => {
    const on = c.dataset.segKey === current();
    c.classList.toggle('active', on);
    c.setAttribute('aria-checked', String(on));
    c.tabIndex = on ? 0 : -1;
  });
  /* paint() 放在 finally 里：commit 里任何一步抛异常（试听时浏览器语音接口
     抽风就会），高亮也必须按 Store 重刷一遍。漏了这一步，高亮会停在旧档而
     Store 已经变了——显示与真相分叉，正是 v0.2.25 修掉的那类 bug。 */
  const pick = c => {
    try { commit(c.dataset.segKey); }
    finally { paint(); }
  };
  chips.forEach((c, i) => {
    c.onclick = () => pick(c);
    c.onkeydown = e => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const next = chips[(i + step + chips.length) % chips.length];
      pick(next);
      next.focus();
    };
  });
  paint();
  return paint;
}
/* 写 profile 的统一入口。不必自己备份回滚：Store.save() 失败时会把整个 data
   重新读回上次持久化的状态，此后 Store.data.profile 已是旧值。after() 与
   选中态重绘都从 Store 现读，所以落盘失败时字号和高亮会自动弹回真正生效的那一档。 */
function commitProfile(mutate, after) {
  mutate(Store.data.profile);
  const ok = stored(Store.save());
  if (after) after();
  return ok;
}
/* 字号/语速的选项表：标签、存储键、以及 chip 自身的字号示意（f1/f2/f3） */
const FONT_OPTIONS = [
  { key: 'normal', label: '标准', cls: 'f1' },
  { key: 'large', label: '大', cls: 'f2' },
  { key: 'xlarge', label: '特大', cls: 'f3' },
];
const RATE_OPTIONS = [
  { key: 'slow', label: '慢', cls: 'f1' },
  { key: 'mid', label: '适中', cls: 'f1' },
  { key: 'fast', label: '快', cls: 'f1' },
];

/* ---------- 语音朗读 ----------
   给读字困难/视力差/失语恢复期的患者："听"比"读"省力。
   不支持的浏览器（部分微信内置 WebView）直接不显示按钮，不做降级提示打扰。 */
function speakBtnHTML(id, label = '听一遍') {
  if (!Speech.supported()) return '';
  return `<button class="btn outline speak-btn" id="${id}">🔊 ${esc(label)}</button>`;
}
/* 把按钮接上朗读：朗读中变"停止朗读"，结束/停止自动复原 */
function bindSpeak(btn, getText) {
  if (!btn) return;
  const idle = btn.innerHTML;
  const reset = () => { btn.innerHTML = idle; btn.classList.remove('speaking'); };
  btn.onclick = () => {
    if (Speech.speaking()) { Speech.stop(); reset(); return; }
    const ok = Speech.speak(getText(), {
      rateKey: Store.data.profile.speechRate,
      onEnd: reset,
      /* API 齐全但没有语音包的环境（部分微信内置浏览器）会静默失败，
         这里给一句明确的话，不让患者以为是自己按错了 */
      onFail: () => { reset(); toast('这个手机好像没装朗读语音，换用手机自带浏览器试试'); },
    });
    if (ok) { btn.innerHTML = '⏹ 停止朗读'; btn.classList.add('speaking'); }
    else toast('这个浏览器不支持朗读，可换用手机自带浏览器');
  };
}
/* 动作示意简笔画：有图就画（两帧对照），没图退回大 emoji——不留空位 */
function figureHTML(ex) {
  const f = typeof FIGURES !== 'undefined' ? FIGURES[ex.id] : null;
  if (!f) return `<div class="trainer-icon-big">${ex.icon}</div>`;
  return `
    <figure class="ex-figure">
      ${f.svg}
      <figcaption>${esc(f.alt)}</figcaption>
    </figure>`;
}

/* 训练动作朗读稿：名称→目的→分步要领→建议量→注意，按患者听的顺序 */
function exerciseSpeechText(ex) {
  const lines = [ex.name + '。', ex.goal + '。'];
  lines.push('动作要领。');
  ex.steps.forEach((s, i) => lines.push(`第${i + 1}步，${s}。`));
  lines.push(`建议量，${ex.dose}。`);
  if (ex.caution) lines.push(`注意，${ex.caution}`);
  return lines.join('\n');
}
/* 文章朗读稿：把 HTML 变成"能听懂"的稿子。
   不能直接用 textContent——`<h3>2. 控制血压</h3><ul><li>高血压是…` 会被粘成
   "控制血压高血压是…"，一句破句念到底，听着就是"生硬"的主要来源之一。
   按块级标签断行（朗读层据此换气），段末没标点的补句号。 */
const SPEECH_BLOCK = 'p,h1,h2,h3,h4,h5,h6,li,dt,dd,blockquote,figcaption,div,td,th';
function collectSpeechBlocks(root, out) {
  for (let i = 0; i < root.childNodes.length; i++) {
    const node = root.childNodes[i];
    if (node.nodeType === 3) {           // 块级标签之间的裸文本也要念
      const t = node.textContent.replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
      continue;
    }
    if (node.nodeType !== 1) continue;
    /* 只在"叶子块"上取文本：ul/div 这类里面还套着块的容器继续往里走，
       否则外层容器会把内层每一段重复念一遍。 */
    if (node.matches(SPEECH_BLOCK) && !node.querySelector(SPEECH_BLOCK)) {
      const t = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
      continue;
    }
    collectSpeechBlocks(node, out);
  }
  return out;
}
function articleSpeechText(a) {
  const div = document.createElement('div');
  div.innerHTML = a.body;
  const body = collectSpeechBlocks(div, [])
    .map(s => (/[。！？；：…，、,.!?;:]$/.test(s) ? s : s + '。'))
    .join('\n');
  return `${a.title}。${a.sub}。\n${body}`;
}
