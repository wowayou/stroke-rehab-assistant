/* ============================================================
   主应用：视图渲染 / 训练引导 / 弹窗 / 设置
   ------------------------------------------------------------
   模块地图（按本文件从上到下的顺序；搜 `【区】` 跳分区锚点）：

   一、公共基础层（跨视图共用，改一处影响全站，动前先想清楚）
     · 工具        esc/toast/stored/beep —— 转义、提示条、存盘失败提示、成功音
     · 少算数      dotsHTML/leftText/repTrackHTML/plainDuration
                   —— 把比率/分数换成"还差几个"与圆点（硬约定 5）
     · 分段控件    segGroupHTML/bindSegGroup/commitProfile + FONT/RATE_OPTIONS
                   —— 字号/语速这类"点一下即生效即落盘"的偏好（硬约定 9）
     · 语音朗读    speakBtnHTML/bindSpeak/figureHTML/exerciseSpeechText/
                   collectSpeechBlocks/articleSpeechText —— 朗读稿装配（朗读规则在 speech.js）
     · 浮层与返回键 overlayPush/closeTopOverlayDOM/dismissTopOverlay（硬约定 10）
     · 弹窗        openModal/nodeFromHTML —— 所有浮层的底座

   二、视图层（五个页面各自成区，末尾跟本页专属的弹窗/引导器）
     · 今日页      renderToday + exItemHTML/bindExItems
     · 训练页      renderTrain/exCardHTML → 打卡历史(日历+明细) → 训练引导器(reps/timer/game)
     · 记录页      判定(bpBadge/gluBadge/bmiBadge) → 格式化 → 比上次 → 图表(VITAL_SERIES/
                   targetConfig/drawVitalChart/tooltip) → renderBP/Glucose/Weight → openExport
     · 用药页      renderMeds/medListHTML → 服药历史 → openMedForm（登记/停用/新疗程）
     · 知识页      renderLearn + openEmergency

   三、设置与备份    openSettings/applyFont/applyVoice → 首次指引 → 备份下载(明文/加密)
   四、导航与初始化  RENDERERS/render/go/init（DOMContentLoaded 入口在文件末尾）

   数据一律走 Store（storage.js），本文件不直接读写 localStorage。
   ============================================================ */

const App = (() => {
  let currentView = 'today';
  let recTab = 'bp';      // 记录页当前标签
  let catTab = 'limb';    // 训练页当前分类
  let trainerTimer = null;
  let settingsRevision = 0;
  const recordDrafts = {}; // 只保留当前页面会话中的未保存输入，不写入健康记录。
  let recordSaved = null;

  const $view = () => document.getElementById('view');

  /* ============================================================
     【区】一、公共基础层：以下六个小节被各视图共用，改动波及全站
     ============================================================ */

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
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
    showError(topOverlay()?.querySelector('.modal-panel, .trainer-body') || $view(),
      Store.storageStatus()?.message || Store.backupError() || '没有保存成功，请重试');
    return false;
  }
  function beep() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      o.frequency.value = 880; g.gain.value = 0.12;
      o.start();
      setTimeout(() => { o.stop(); ac.close(); }, 350);
    } catch (e) { /* 忽略 */ }
    if (navigator.vibrate) navigator.vibrate(300);
  }

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

  /* ---------- 浮层与返回键 ----------
     目标：安卓实体返回键先关浮层，而不是直接退出应用。
     做法：**每开一个浮层就压一个历史条目**，返回键消耗它 → popstate 里关浮层。
     屏幕上的 ✕ / Esc 只发起 history.back()，DOM 也统一由 popstate 关闭，
     避免"先删 DOM、异步回退尚未完成、又打开新浮层"造成历史栈错位。
     连续弹窗用 close.replace() 原位替换，复用当前浮层历史条目。
     （早先的版本没有压条目，返回键直接吃掉了真实页面条目、导致整页重载。） */
  let dismissPending = false;
  let reuseOverlayEntry = false;
  let replacementFocus = null;
  let openingTrigger = null;
  const overlayStack = [];
  const topOverlay = () => overlayStack[overlayStack.length - 1];
  function syncOverlays() {
    const top = topOverlay();
    document.body.classList.toggle('overlay-open', !!top);
    document.querySelectorAll('.app-header, #view, #storage-notice, .bottom-nav').forEach(el => {
      el.inert = !!top;
      if (top) el.setAttribute('aria-hidden', 'true'); else el.removeAttribute('aria-hidden');
    });
    overlayStack.forEach(el => {
      el.inert = el !== top;
      if (el !== top) el.setAttribute('aria-hidden', 'true'); else el.removeAttribute('aria-hidden');
      el.style.zIndex = String(150 + overlayStack.indexOf(el));
    });
  }
  function mountOverlay(node, focusTarget) {
    // Safari 触摸按钮未必获得焦点，返回位置要认触发控件本身。
    const trigger = openingTrigger?.isConnected && (!topOverlay() || topOverlay().contains(openingTrigger))
      ? openingTrigger : document.activeElement;
    node._returnFocus = replacementFocus || trigger;
    overlayStack.push(node);
    Speech.stop();
    syncOverlays();
    focusTarget.focus({ preventScroll: true });
  }
  function overlayPush() {
    if (!reuseOverlayEntry) history.pushState({ rehabOverlay: 1 }, '');
  }
  // 保存/打卡会重建列表；用原控件的稳定标识找回新节点，不能只检查旧 DOM。
  function returnFocusTarget(target) {
    if (!target || target.isConnected) return target;
    if (target.id) return document.getElementById(target.id);
    for (const key of ['ex', 'editMed', 'hist', 'art']) {
      if (target.dataset[key]) {
        return [...$view().querySelectorAll('button, [role="button"]')]
          .find(el => el.dataset[key] === target.dataset[key]);
      }
    }
    return null;
  }
  /* 只动 DOM、不碰历史：给 popstate 用 */
  function closeTopOverlayDOM() {
    const top = topOverlay();
    if (!top) return false;
    if (top.id === 'trainer') closeTrainer();
    else { overlayStack.pop(); Speech.stop(); top.remove(); syncOverlays(); }
    if (topOverlay()?._onResume) topOverlay()._onResume();
    const target = returnFocusTarget(top._returnFocus);
    if (target?.isConnected && !target.closest('[inert]')) target.focus({ preventScroll: true });
    else if (topOverlay()) topOverlay().querySelector('.m-title, .t-name').focus({ preventScroll: true });
    else $view().focus({ preventScroll: true });
    return true;
  }
  /* 主动关闭（✕ / Esc）：等 popstate 到达后再关 DOM，期间遮罩仍会阻止重复操作。 */
  function dismissTopOverlay() {
    if (!topOverlay()) return false;
    if (dismissPending) return true;
    dismissPending = true;
    Speech.stop();
    const top = topOverlay();
    if (top) {
      top.setAttribute('aria-busy', 'true');
      top.querySelectorAll('button, input, select, textarea').forEach(control => { control.disabled = true; });
    }
    history.back();
    return true;
  }

  /* ---------- 弹窗 ---------- */
  function openModal(title, contentNode, { center = false, emergency = false } = {}) {
    const mask = document.createElement('div');
    mask.className = 'modal-mask' + (center ? ' center' : '');
    const panel = document.createElement('div');
    panel.className = 'modal-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', title);
    const head = document.createElement('div');
    head.className = 'modal-head';
    head.innerHTML = `<div class="m-title" tabindex="-1">${esc(title)}</div>`;
    if (!emergency) {
      const urgent = document.createElement('button');
      urgent.className = 'btn-emergency';
      urgent.textContent = '急救';
      urgent.onclick = openEmergency;
      head.appendChild(urgent);
    }
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', '关闭');
    head.appendChild(closeBtn);
    panel.appendChild(head);
    panel.appendChild(contentNode);
    mask.appendChild(panel);
    document.getElementById('modal-root').appendChild(mask);
    overlayPush();
    mountOverlay(mask, head.querySelector('.m-title'));
    const close = () => {
      if (!mask.isConnected || topOverlay() !== mask) return;
      dismissTopOverlay();
    };
    close.replace = openNext => {
      if (!mask.isConnected || topOverlay() !== mask || dismissPending) return false;
      Speech.stop();
      overlayStack.pop();
      mask.remove();
      reuseOverlayEntry = true;
      replacementFocus = mask._returnFocus;
      try { openNext(); } finally { reuseOverlayEntry = false; replacementFocus = null; syncOverlays(); }
      return true;
    };
    closeBtn.onclick = close;
    mask.addEventListener('click', e => { if (e.target === mask) close(); });
    close.onResume = callback => { mask._onResume = callback; };
    close.active = () => mask.isConnected && topOverlay() === mask && !dismissPending;
    return close;
  }
  function nodeFromHTML(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d;
  }

  /* ############################################################
     二、视图层：以下每个 renderXxx 对应底部导航一个页面，
     末尾跟随本页专属的弹窗/引导器。视图只读 Store、只拼 HTML，
     数据变更一律走 Store 再 render()。
     ############################################################ */

  /* ============================================================
     【区】今日页
     ============================================================ */
  function renderToday() {
    const p = Store.data.profile;
    const now = new Date();
    const h = now.getHours();
    const greet = h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好';
    const name = p.name ? `，${esc(p.name)}` : '';
    const rd = Store.rehabDay();
    const streak = Store.streak();

    const plan = (DAILY_PLAN[p.stage] || DAILY_PLAN.sitting)
      .map(id => EXERCISES.find(e => e.id === id)).filter(Boolean);
    const doneIds = Store.exercisesDoneToday();
    const planDone = plan.filter(e => doneIds.includes(e.id)).length;
    const mp = Store.medProgressToday();
    const bpDone = Store.bpToday();

    const stageName = (STAGES.find(s => s.key === p.stage) || {}).name || '';

    const medDone = mp.total > 0 && mp.done >= mp.total;
    const trainDone = plan.length > 0 && planDone >= plan.length;
    /* 三件事里"已经做到"的件数：只用来说一句肯定的话，不做评分 */
    const thingsDone = [bpDone, medDone, trainDone].filter(Boolean).length;
    const summary = thingsDone === 3
      ? '今天三件事都做到了，很稳。'
      : thingsDone > 0
        ? `今天已经做到 ${thingsDone} 件，剩下的慢慢来就好。`
        : '一天做一点就好，从最容易的一件开始。';

    /* 连续天数断了不清零、不指责：先肯定过去，再把重新开始说成很轻的一步 */
    const best = Store.bestStreak();
    const last = Store.lastExerciseDate();
    let streakHTML = '';
    if (streak > 0) {
      streakHTML = `<div class="streak-chip">🔥 已连续坚持训练 ${streak} 天</div>`;
    } else if (last) {
      const gap = Store.daysBetween(last, Store.today());
      streakHTML = `<div class="streak-chip">🌱 ${gap <= 2 ? '歇了一下没关系' : '欢迎回来'}${best > 1 ? `，之前最长连续 ${best} 天` : ''}，今天做一个动作就重新开始</div>`;
    }

    let html = `
    <div class="today-hero">
      <div class="date-line">${now.getMonth() + 1}月${now.getDate()}日 ${Store.weekdayCN(now)}</div>
      <h1 class="greet" tabindex="-1">${greet}${name}</h1>
      ${rd ? `<div class="rehab-day">今天是康复第 <b>${rd}</b> 天，每一天都算数</div>`
           : `<div class="rehab-day">坚持康复，每一天都算数</div>`}
      ${streakHTML}
    </div>

    <div class="card">
      <h2 class="card-title">今日三件事</h2>
      <div class="today-summary">${summary}</div>
      <div class="check-item ${bpDone ? 'done' : ''}">
        <div class="ci-icon" aria-hidden="true">🩺</div>
        <div class="ci-body">
          <div class="ci-name">测量血压</div>
          <div class="ci-sub">${bpDone ? '今天记好了 ✓' : '每天固定时间测量并记录'}</div>
        </div>
        <button class="ci-action ${bpDone ? 'done' : ''}" data-go="records" data-rec="bp">${bpDone ? '已完成' : '去记录'}</button>
      </div>
      <div class="check-item ${medDone ? 'done' : ''}">
        <div class="ci-icon" aria-hidden="true">💊</div>
        <div class="ci-body">
          <div class="ci-name">按时服药</div>
          <div class="ci-sub">${mp.total
            ? (medDone ? '今天该吃的都核对了 ✓' : leftText(mp.done, mp.total, '次没核对'))
            : '先到「用药」页登记药物'}</div>
          ${mp.total ? dotsHTML(mp.done, mp.total) : ''}
        </div>
        <button class="ci-action ${medDone ? 'done' : ''}" data-go="meds">${medDone ? '已完成' : '去核对'}</button>
      </div>
      <div class="check-item ${trainDone ? 'done' : ''}">
        <div class="ci-icon" aria-hidden="true">💪</div>
        <div class="ci-body">
          <div class="ci-name">康复训练</div>
          <div class="ci-sub">${esc(stageName)}${trainDone ? '推荐都练过了 ✓' : ' · ' + leftText(planDone, plan.length, '项')}</div>
          ${dotsHTML(planDone, plan.length)}
        </div>
        <button class="ci-action ${trainDone ? 'done' : ''}" data-go="train">${trainDone ? '已完成' : '去训练'}</button>
      </div>
    </div>

    <div class="card">
      <h2 class="card-title">今日推荐训练 <span class="card-meta">${esc(stageName)}</span></h2>
      ${plan.map(e => exItemHTML(e, doneIds.includes(e.id))).join('')}
      <div class="muted" style="margin-top:0.5rem">阶段不符？到「训练」页可切换康复阶段。</div>
    </div>

    <div class="disclaimer">本应用是家庭康复辅助工具，不能替代医生的诊断和治疗。<br>训练内容请经康复医生评估后进行，身体不适立即停止并就医。</div>`;

    $view().innerHTML = html;

    $view().querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
      if (b.dataset.rec) recTab = b.dataset.rec;
      go(b.dataset.go);
    });
    bindExItems($view());
  }

  /* 训练条目公共 HTML（今日推荐 & 训练库共用）：行样式由 CSS 的 .ex-item 统一给，
     今天页在 .card 里、训练库在 #ex-list 分组卡里，都是"一卡多行"的分组列表 */
  function exItemHTML(e, done) {
    return `
    <div class="ex-item">
      <div class="ex-icon" aria-hidden="true">${e.icon}</div>
      <div class="ex-body">
        <div class="ex-name">${e.name}</div>
        <div class="ex-dose">${e.dose}</div>
        ${done ? '<div class="ex-done-mark">✓ 今日已完成</div>' : ''}
      </div>
      <button class="ex-start ${done ? 'done' : ''}" data-ex="${e.id}" aria-label="${done ? '再练一次' : '开始'}：${esc(e.name)}">${done ? '再练一次' : '开始'}</button>
    </div>`;
  }
  function bindExItems(root) {
    root.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => {
      const ex = EXERCISES.find(x => x.id === b.dataset.ex);
      if (ex) openTrainer(ex);
    });
  }

  /* ============================================================
     【区】训练页
     ============================================================ */
  function renderTrain() {
    const p = Store.data.profile;
    const doneIds = Store.exercisesDoneToday();
    const stage = STAGES.find(s => s.key === p.stage) || STAGES[0];

    let html = `
    ${pageHeading('康复训练', '选一个动作，按自己的节奏慢慢练。')}
    <details class="card disclosure stage-card" id="train-stage">
      <summary><span><strong>当前阶段 · ${esc(stage.name)}</strong><span class="disclosure-hint">${esc(stage.desc)}</span></span><span class="disclosure-action">更换<span class="disclosure-arrow" aria-hidden="true">⌄</span></span></summary>
      <div class="disclosure-body">
      <div class="stage-picker" role="group" aria-label="当前康复阶段">
        ${STAGES.map(s => `<button class="stage-chip ${p.stage === s.key ? 'active' : ''}" aria-pressed="${p.stage === s.key}" data-stage="${s.key}">${s.name}</button>`).join('')}
      </div>
      <div class="muted">阶段影响「肢体运动」列表和今日推荐。</div>
      </div>
    </details>

    <h2 class="section-label">选择训练内容</h2>
    <div class="cat-tabs" role="group" aria-label="训练内容">
      ${EX_CATS.map(c => `<button class="cat-tab ${catTab === c.key ? 'active' : ''}" aria-pressed="${catTab === c.key}" aria-controls="ex-list" data-cat="${c.key}">${c.name}</button>`).join('')}
    </div>
    <div id="ex-list"></div>
    <div class="disclaimer">训练动作应经康复医生/治疗师评估后进行；站立、步行类训练必须有家属保护。</div>
    ${trainHistoryCardHTML()}`;

    $view().innerHTML = html;

    $view().querySelectorAll('[data-stage]').forEach(b => b.onclick = () => {
      if (Store.data.profile.stage === b.dataset.stage) return;
      Store.data.profile.stage = b.dataset.stage;
      if (!stored(Store.save())) return;
      render('train', { keepScroll: true });
    });
    $view().querySelectorAll('[data-cat]').forEach(b => b.onclick = () => {
      if (catTab === b.dataset.cat) return;
      catTab = b.dataset.cat;
      render('train', { keepScroll: true });
      $view().querySelector(`[data-cat="${catTab}"]`).focus({ preventScroll: true });
    });
    const histBtn = document.getElementById('btn-ex-hist');
    if (histBtn) histBtn.onclick = openExerciseHistory;

    let list = EXERCISES.filter(e => e.cat === catTab);
    if (catTab === 'limb') {
      const mine = list.filter(e => e.stage === p.stage);
      const others = list.filter(e => e.stage !== p.stage);
      const stageName = k => (STAGES.find(s => s.key === k) || {}).name || '';
      document.getElementById('ex-list').innerHTML =
        `<div class="ex-group-label">适合当前阶段（${esc(stageName(p.stage))}）</div>`
        + mine.map(e => exCardHTML(e, doneIds.includes(e.id))).join('')
        + `<div class="ex-group-label">其他阶段动作（量力选做）</div>`
        + others.map(e => exCardHTML(e, doneIds.includes(e.id), stageName(e.stage))).join('');
    } else {
      document.getElementById('ex-list').innerHTML =
        list.map(e => exCardHTML(e, doneIds.includes(e.id))).join('');
    }
    bindExItems($view());
  }

  function exCardHTML(e, done, stageTag) {
    return `
    <div class="ex-item">
      <div class="ex-icon" aria-hidden="true">${e.icon}</div>
      <div class="ex-body">
        <div class="ex-name">${e.name}${stageTag ? ` <span class="badge info" style="font-size:0.75rem">${stageTag}</span>` : ''}</div>
        <div class="ex-dose">${e.dose}</div>
        ${done ? '<div class="ex-done-mark">✓ 今日已完成</div>' : ''}
      </div>
      <button class="ex-start ${done ? 'done' : ''}" data-ex="${e.id}" aria-label="${done ? '再练' : '开始'}：${esc(e.name)}">${done ? '再练' : '开始'}</button>
    </div>`;
  }

  /* ============================================================
     【区】训练打卡历史（日历 + 每日明细 + 游戏成绩）
     ============================================================ */

  /* 打卡日历：最近 n 天，按周几对齐，颜色深浅表示当天训练项数 */
  function calendarHTML(n) {
    const cells = Store.exerciseCalendar(n);
    const t = Store.today();
    const head = '日一二三四五六'.split('').map(w => `<div class="cal-head">${w}</div>`).join('');
    const lead = '<div class="cal-cell blank"></div>'.repeat(new Date(cells[0].date + 'T00:00:00').getDay());
    const body = cells.map(c => {
      const lv = c.count >= 3 ? 'lv2' : c.count > 0 ? 'lv1' : '';
      return `<div class="cal-cell ${lv}${c.date === t ? ' today' : ''}" aria-label="${c.date} 训练 ${c.count} 项">
        <span class="cal-d">${+c.date.slice(8)}</span>
        <span class="cal-n">${c.count || ''}</span>
      </div>`;
    }).join('');
    return `<div class="cal-grid">${head}${lead}${body}</div>`;
  }

  function trainHistoryCardHTML() {
    const total = Store.exerciseDaysTotal();
    const streak = Store.streak();
    const hasHistory = Store.activeDates().length > 0;
    /* 累计天数是"越攒越多"的正向数字，放在最前面；连续天数断了也先肯定历史最长 */
    let line;
    if (!total) {
      line = '<div class="muted">还没有打卡记录，今天做一个动作就开始了。</div>';
    } else {
      const best = Store.bestStreak();
      line = `<div class="ad-main">已经练了 <b>${total}</b> 天</div>`
        + (streak > 0
          ? `<div class="muted">目前连着练了 ${streak} 天</div>`
          : `<div class="muted">${best > 1 ? `之前最长连着练过 ${best} 天。` : ''}中间歇几天很正常，今天做一个动作就又接上了。</div>`);
    }
    return `
    <details class="disclosure card" id="train-history">
      <summary><span><strong>训练打卡记录</strong><span class="disclosure-hint">${total ? `已积累 ${total} 天 · 查看近四周` : '查看日历与每日明细'}</span></span><span class="disclosure-arrow" aria-hidden="true">⌄</span></summary>
      <div class="disclosure-body">
      ${line}
      ${calendarHTML(28)}
      <div class="cal-legend">
        <span>近 4 周</span>
        <span class="cal-legend-scale">少 <i class="cal-dot"></i><i class="cal-dot lv1"></i><i class="cal-dot lv2"></i> 多</span>
      </div>
      ${hasHistory ? '<button class="btn ghost block" id="btn-ex-hist" style="margin-top:0.7rem">📄 查看每天练了什么</button>' : ''}
      </div>
    </details>`;
  }

  function exName(id) {
    const e = EXERCISES.find(x => x.id === id);
    return e ? e.name : id;
  }
  function gameName(key) {
    const e = EXERCISES.find(x => x.mode && x.mode.type === 'game' && x.mode.game === key);
    return e ? e.name : key;
  }
  function weekdayOf(date) {
    return Store.weekdayCN(new Date(date + 'T00:00:00'));
  }

  function openExerciseHistory() {
    const dates = Store.activeDates();
    const days = dates.map(d => {
      const ids = Store.exercisesOn(d);
      const games = Store.gamesOn(d);
      return `
      <div class="hist-day">
        <div class="hd-date">${esc(d)} ${weekdayOf(d)}<span class="hd-count">${ids.length} 项</span></div>
        ${ids.length ? `<div class="chip-row">${ids.map(i => `<span class="chip">${esc(exName(i))}</span>`).join('')}</div>` : ''}
        ${games.length ? `<div class="hd-games">🎮 ${games.map(g => `${esc(gameName(g.game))} ${esc(g.detail || g.score)}`).join('　·　')}</div>` : ''}
      </div>`;
    }).join('');

    const node = nodeFromHTML(`
      <div class="card">
        <div class="card-title">📅 最近 4 周</div>
        ${calendarHTML(28)}
        <div class="cal-legend"><span>已经练了 ${Store.exerciseDaysTotal()} 天${Store.streak() > 0 ? ` · 目前连着 ${Store.streak()} 天` : ''}</span></div>
      </div>
      <div class="card">
        <div class="card-title">📄 每天练了什么</div>
        ${days || '<div class="empty-tip">还没有训练打卡记录，做一个动作就有了</div>'}
      </div>`);
    openModal('训练历史', node);
  }

  /* ============================================================
     【区】训练引导器（全屏）：reps 计次 / timer 计时 / game 认知游戏
     ============================================================ */
  function openTrainer(ex) {
    /* 换一个动作（游戏里"换个不用算的"）时复用同一个历史条目：
       "训练引导页开着"始终只对应一个条目，返回键一次就退出。 */
    const hadTrainer = !!document.getElementById('trainer');
    const trainerOrigin = document.getElementById('trainer')?._returnFocus;
    closeTrainer();
    const wrap = document.createElement('div');
    wrap.className = 'trainer';
    wrap.id = 'trainer';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', ex.name);

    let modeHTML = '';
    if (ex.mode.type === 'reps') {
      /* 大数字显示「还差几次」而不是已完成次数：患者不必自己做减法 */
      modeHTML = `
      <div class="timer-wrap">
        <div class="timer-label">做完一次点一下大按钮，剩几次它会告诉您</div>
        <button class="rep-btn" id="rep-btn">
          <span class="rep-count" id="rep-count">${ex.mode.target}</span>
          <span id="rep-hint">还差这么多次</span>
        </button>
        <div class="rep-track" id="rep-track">${repTrackHTML(0, ex.mode.target)}</div>
        <div class="rep-note" id="rep-note">做了 0 次 · 目标 ${ex.mode.target} 次（做不到也没关系，做几次都算）</div>
      </div>`;
    } else if (ex.mode.type === 'timer') {
      const m = Math.floor(ex.mode.seconds / 60), s = ex.mode.seconds % 60;
      modeHTML = `
      <div class="timer-wrap">
        <div class="timer-label">建议时长</div>
        <div class="timer-num" id="timer-num">${m}:${String(s).padStart(2, '0')}</div>
        <div class="timer-plain" id="timer-plain">${plainDuration(ex.mode.seconds)}</div>
        <div class="progress-bar" style="max-width:340px;margin:0.6rem auto 0"><div id="timer-bar" style="width:0%"></div></div>
        <div class="btn-row" style="max-width:340px;margin:0.6rem auto 0">
          <button class="btn" id="timer-toggle">▶ 开始计时</button>
          <button class="btn outline" id="timer-reset">重置</button>
        </div>
      </div>`;
    } else if (ex.mode.type === 'game') {
      modeHTML = `<div id="game-box"></div>`;
    }

    wrap.innerHTML = `
      <div class="trainer-head">
        <button class="modal-close" id="trainer-back" aria-label="返回">←</button>
        <div class="t-name" tabindex="-1">${ex.name}</div>
        <button class="btn-emergency" id="trainer-emergency">急救</button>
      </div>
      <div class="trainer-body">
        ${figureHTML(ex)}
        <div class="trainer-goal">${ex.goal}</div>
        ${speakBtnHTML('trainer-speak', '听一遍动作要领') ? `<div class="speak-row">${speakBtnHTML('trainer-speak', '听一遍动作要领')}</div>` : ''}
        <div class="trainer-steps">
          <div class="card-title" style="margin-bottom:0.4rem">动作要领</div>
          <ol>${ex.steps.map(s => `<li>${s}</li>`).join('')}</ol>
          <div class="muted" style="margin-top:0.4rem">建议量：${ex.dose}</div>
        </div>
        ${ex.caution ? `<div class="trainer-caution">⚠️ ${ex.caution}</div>` : ''}
        ${modeHTML}
        ${ex.mode.type !== 'game' ? `<button class="btn green block huge" id="trainer-done" style="margin-top:0.8rem">✓ 完成训练，打卡</button>` : ''}
      </div>`;

    document.body.appendChild(wrap);
    if (!hadTrainer) overlayPush();
    mountOverlay(wrap, wrap.querySelector('.t-name'));
    if (trainerOrigin) wrap._returnFocus = trainerOrigin;
    wrap.querySelector('#trainer-emergency').onclick = openEmergency;

    const finish = (gameResult = null) => {
      if (dismissPending) return;
      const ok = gameResult
        ? Store.logGameExercise(ex.id, gameResult.game, gameResult.score, gameResult.detail)
        : Store.logExercise(ex.id);
      if (!stored(ok)) return;
      dismissTopOverlay();
      /* 打卡反馈说清"今天第几项"，让每一次都看得见累积 */
      const n = Store.exercisesDoneToday().length;
      toast(`已打卡：${ex.name}　今天第 ${n} 项 👍`);
      /* 保留滚动位置：刚才翻到哪一项，回来还在那里 */
      render(currentView, { keepScroll: true });
    };

    wrap.querySelector('#trainer-back').onclick = dismissTopOverlay;
    bindSpeak(wrap.querySelector('#trainer-speak'), () => exerciseSpeechText(ex));
    const doneBtn = wrap.querySelector('#trainer-done');
    if (doneBtn) doneBtn.onclick = () => finish();

    if (ex.mode.type === 'reps') {
      const target = ex.mode.target;
      let count = 0;
      const btn = wrap.querySelector('#rep-btn');
      const cnt = wrap.querySelector('#rep-count');
      const hint = wrap.querySelector('#rep-hint');
      const track = wrap.querySelector('#rep-track');
      const note = wrap.querySelector('#rep-note');
      btn.onclick = () => {
        count++;
        const left = target - count;
        /* 主数字是"还差几次"；到量后改成对勾，多做的次数当作额外收获，不报错 */
        if (left > 0) {
          cnt.textContent = left;
          hint.textContent = '还差这么多次';
          note.textContent = `做了 ${count} 次 · 目标 ${target} 次`;
        } else {
          cnt.textContent = '✓';
          hint.textContent = left === 0 ? '够了！' : '够了，多做的也算';
          note.textContent = left === 0
            ? `做满 ${target} 次了，随时可以打卡`
            : `做了 ${count} 次，比目标还多 ${-left} 次`;
        }
        track.innerHTML = repTrackHTML(Math.min(count, target), target);
        if (navigator.vibrate) navigator.vibrate(30);
        if (count === target) {
          beep();
          toast('到量了，真棒！点下方按钮打卡');
        }
      };
    } else if (ex.mode.type === 'timer') {
      const total = ex.mode.seconds;
      let remain = total, running = false;
      const num = wrap.querySelector('#timer-num');
      const plain = wrap.querySelector('#timer-plain');
      const bar = wrap.querySelector('#timer-bar');
      const tog = wrap.querySelector('#timer-toggle');
      const rst = wrap.querySelector('#timer-reset');
      const show = () => {
        num.textContent = `${Math.floor(remain / 60)}:${String(remain % 60).padStart(2, '0')}`;
        /* 同时给一句人话，避免患者去换算"还剩多久" */
        plain.textContent = remain <= 0 ? '时间到了' : `还剩${plainDuration(remain).replace('大约 ', '约 ')}`;
        bar.style.width = `${Math.round((total - remain) / total * 100)}%`;
      };
      const stopT = () => { if (trainerTimer) { clearInterval(trainerTimer); trainerTimer = null; } running = false; tog.textContent = '▶ 继续'; };
      wrap._pause = stopT;
      tog.onclick = () => {
        if (running) { stopT(); return; }
        running = true; tog.textContent = '⏸ 暂停';
        trainerTimer = setInterval(() => {
          remain--;
          if (remain <= 0) {
            remain = 0; show(); stopT(); beep(); toast('时间到！可以点下方按钮打卡');
            tog.textContent = '▶ 开始计时';
            return;
          }
          show();
        }, 1000);
      };
      rst.onclick = () => {
        stopT(); remain = total; show();
        plain.textContent = plainDuration(total);
        tog.textContent = '▶ 开始计时';
      };
    } else if (ex.mode.type === 'game') {
      Games.start(ex.mode.game, wrap.querySelector('#game-box'), (score, detail) => {
        finish({ game: ex.mode.game, score, detail });
      }, {
        /* 游戏里想换一个玩（比如今天不想算数）：直接打开另一个动作，不算失败 */
        onSwitch: key => {
          const target = EXERCISES.find(x => x.mode && x.mode.type === 'game' && x.mode.game === key);
          if (target) openTrainer(target);
        },
        /* 中途收工也给打卡：参与本身就是训练 */
        onQuit: () => finish(),
      });
    }
  }

  function closeTrainer() {
    if (trainerTimer) { clearInterval(trainerTimer); trainerTimer = null; }
    Speech.stop();   // 不停会在 iOS 上继续念
    Games.stop();
    const t = document.getElementById('trainer');
    if (t) {
      const index = overlayStack.indexOf(t);
      if (index !== -1) overlayStack.splice(index, 1);
      t.remove();
      syncOverlays();
    }
  }

  /* ============================================================
     【区】记录页：判定 → 格式化 → 比上次 → 图表 → 三个表单 → 导出
     ============================================================ */
  const REC_KINDS = {
    bp: { name: '血压', icon: '🩺' },
    glucose: { name: '血糖', icon: '🩸' },
    weight: { name: '体重', icon: '⚖️' },
  };

  function bpBadge(sys, dia) {
    const t = Store.data.profile.targets; // 个人目标值（遵医嘱）
    if (sys >= 180 || dia >= 110) return ['bad', '血压很高，尽快联系医生'];   // 绝对安全线，不随目标变
    if (sys < 90 || dia < 60) return ['warn', '偏低，注意头晕跌倒'];
    if (sys > t.bpSys || dia > t.bpDia) return ['warn', '偏高（超过您的目标值）'];
    return ['ok', '在您的目标值内（遵医嘱）'];
  }
  function gluBadge(gtype, v) {
    const t = Store.data.profile.targets;
    if (v <= 3.9) return ['bad', '偏低，警惕低血糖'];   // 绝对安全线
    if (gtype === '空腹') {
      if (v <= t.gluFast) return ['ok', '空腹在您的目标内（遵医嘱）'];
      if (v <= 10) return ['warn', '空腹偏高（超过您的目标值）'];
      return ['bad', '明显偏高，联系医生'];   // 绝对安全线，不随目标变
    }
    if (v <= t.gluPost) return ['ok', '在您的目标内（遵医嘱）'];
    if (v < 13.9) return ['warn', '偏高（超过您的目标值）'];
    return ['bad', '明显偏高，联系医生'];   // 绝对安全线，不随目标变
  }
  function bmiBadge(bmi) {
    if (bmi < 18.5) return ['warn', '偏瘦，注意营养'];
    if (bmi < 24) return ['ok', '体重适中'];
    if (bmi < 28) return ['warn', '超重'];
    return ['bad', '肥胖，建议咨询医生'];
  }

  /* 单条记录的显示文本与红黄绿状态（历史列表的小圆点用同一套判定） */
  const VITAL_FMT = {
    bp: v => `${esc(v.sys)}/${esc(v.dia)} mmHg${v.pulse ? ' · 脉搏 ' + esc(v.pulse) : ''}`,
    glucose: v => `${esc(v.value)} mmol/L · ${esc(v.gtype)}`,
    weight: v => `${esc(v.value)} 公斤`,
  };
  function vitalStatus(kind, v) {
    if (kind === 'bp') return bpBadge(+v.sys, +v.dia);
    if (kind === 'glucose') return gluBadge(v.gtype, +v.value);
    const h = +Store.data.profile.height;
    if (!h) return ['', ''];
    const bmi = +v.value / Math.pow(h / 100, 2);
    const [cls, txt] = bmiBadge(bmi);
    /* 结论在前、数字在后：BMI 是个算出来的抽象数，先说人话 */
    return [cls, `${txt}（BMI ${bmi.toFixed(1)}）`];
  }

  /* ---------- 「比上次…」：应用把减法做完，直接说结论 ---------- */
  const UP_DOWN = d => (d > 0 ? '高' : '低');
  function deltaLineHTML(kind) {
    const d = Store.vitalDelta(kind);
    if (!d) return '';
    let body;
    if (kind === 'bp') {
      if (!d.sys && !d.dia) body = '和上次一样';
      else {
        const parts = [];
        if (d.sys) parts.push(`高压${UP_DOWN(d.sys)}了 ${Math.abs(d.sys)}`);
        if (d.dia) parts.push(`低压${UP_DOWN(d.dia)}了 ${Math.abs(d.dia)}`);
        body = parts.join('，');
      }
    } else {
      const unit = kind === 'weight' ? '公斤' : '';
      if (!d.value) body = '和上次一样';
      else body = `比上次${UP_DOWN(d.value)}了 ${Math.abs(d.value)}${unit}`;
    }
    const prefix = (kind === 'bp' && body !== '和上次一样') ? '比上次：' : '';
    return `<div class="delta-line">↕ ${prefix}${esc(body)}<span class="muted">（上次 ${esc(d.prevDate)}${d.prevTime ? ' ' + esc(d.prevTime) : ''}）</span></div>`;
  }

  /* 图表上方一句话小结：不看图也能知道大概情况，避免"看图 + 心算"双重负担 */
  function chartSummaryHTML(kind, list) {
    if (list.length < 2) return '';
    const first = list[0], last = list[list.length - 1];
    const val = v => (kind === 'bp' ? +v.sys : +v.value);
    const diff = val(last) - val(first);
    const nameOf = { bp: '高压', glucose: '血糖', weight: '体重' }[kind];
    const unit = kind === 'weight' ? ' 公斤' : '';
    const amount = Math.round(Math.abs(diff) * 10) / 10;
    let trend;
    if (!amount) trend = `${nameOf}和最早一条差不多`;
    else trend = `这 ${list.length} 条里，${nameOf}比最早一条${UP_DOWN(diff)}了 ${amount}${unit}`;

    let inTarget = '';
    if (kind !== 'weight') {
      const ok = list.filter(v => vitalStatus(kind, v)[0] === 'ok').length;
      /* 说"有几次在目标内"而不是百分比；一次都没有也不说重话 */
      inTarget = ok
        ? `　·　其中 ${ok} 次在您的目标内`
        : '　·　这段时间都超过了目标值，可以带记录去问问医生';
    }
    return `<div class="chart-summary">${esc(trend)}${inTarget}</div>`;
  }
  /* 趋势图颜色与图例的单一数据源：canvas 画线与下方图例都从这里读，保证颜色一一对应。
     series.key 对应记录字段；refs 为参考线（y=目标值，label 画在图上，legend 出现在图例）。
     调色板对齐 css/style.css：高压=--red、低压=--primary、血糖=--green、参考线=--orange。 */
  const VITAL_SERIES = {
    bp: {
      series: [
        { key: 'sys', label: '高压', color: '#D93A3A', marker: 'dot' },
        { key: 'dia', label: '低压', color: '#2E6FE0', marker: 'square' },
      ],
      note: '',
    },
    glucose: {
      series: [
        { key: 'value', label: '血糖', color: '#1E8E5A', marker: 'dot' },
      ],
      note: '目标遵医嘱',
    },
    weight: {
      series: [
        { key: 'value', label: '体重', color: '#7C5CD9', marker: 'dot' },
      ],
      note: '',
    },
  };
  /* 由个人目标值生成参考线与目标区（目标值遵医嘱、用户可调）。
     血压：目标区着色（低压~高压）；与默认 140/90 不同才补淡色 140/90 参考线。
     血糖：空腹/餐后参考线用个人值。绝对安全线（180/110、3.9、13.9 等）不在此。 */
  function targetConfig(kind) {
    const t = Store.data.profile.targets;
    const g = n => n.toFixed(1);
    if (kind === 'bp') {
      const isDefault = t.bpSys === 140 && t.bpDia === 90;
      return {
        zones: [{ from: t.bpDia, to: t.bpSys, color: 'rgba(30,142,90,0.10)' }],
        refLines: [
          { y: t.bpSys, color: '#1E8E5A' },
          { y: t.bpDia, color: '#1E8E5A' },
          ...(isDefault ? [] : [
            { y: 140, color: '#C8B48F', label: '140' },
            { y: 90, color: '#C8B48F' },
          ]),
        ],
        legend: [
          { band: true, label: '目标区（遵医嘱）' },
          ...(isDefault ? [] : [{ color: '#C8B48F', label: '140/90 提示线', dash: true }]),
        ],
      };
    }
    if (kind === 'glucose') {
      return {
        zones: [],
        refLines: [
          { y: t.gluFast, color: '#D97706', label: `空腹参考${g(t.gluFast)}` },
          { y: t.gluPost, color: '#0E7490', label: `餐后参考${g(t.gluPost)}` },
        ],
        legend: [
          { color: '#D97706', label: `空腹目标 ${g(t.gluFast)}`, dash: true },
          { color: '#0E7490', label: `餐后2h目标 ${g(t.gluPost)}`, dash: true },
        ],
      };
    }
    return { zones: [], refLines: [], legend: [] };
  }
  /* 图例：一小段和图上完全一致的线（实线=数据、同色虚线=参考线/目标区带）+ 深色标签 */
  function chartLegendHTML(kind) {
    const def = VITAL_SERIES[kind];
    const tc = targetConfig(kind);
    const items = [];
    def.series.forEach(s => items.push(
      `<span class="lg-item"><span class="lg-sw" style="border-color:${s.color}"></span>${esc(s.label)}</span>`));
    tc.legend.forEach(l => items.push(l.band
      ? `<span class="lg-item"><span class="lg-band"></span>${esc(l.label)}</span>`
      : `<span class="lg-item"><span class="lg-sw ${l.dash ? 'lg-dash' : ''}" style="border-color:${l.color}"></span>${esc(l.label)}</span>`));
    return `<div class="chart-legend"><div class="lg-hint">👆 点一下图上的点，看当天数值</div>${items.join('')}${def.note ? `<span class="lg-note">${esc(def.note)}</span>` : ''}</div>`;
  }
  /* 趋势图（记录页与历史弹窗共用，只是取的条数不同）；点选某列弹 tooltip 显示该条详情 */
  function drawVitalChart(kind, canvas, recent) {
    if (!canvas || recent.length < 2) return;
    const def = VITAL_SERIES[kind];
    const tc = targetConfig(kind);
    const x = v => v.date.slice(5);
    const series = def.series.map(s => ({
      label: s.label, color: s.color, marker: s.marker,
      values: recent.map(v => ({ x: x(v), y: +v[s.key] })),
    }));
    const opts = kind === 'weight' ? {} : { yFloor: 0 }; // 体重不压 0，否则曲线被压扁
    if (tc.refLines.length) opts.refLines = tc.refLines;
    if (tc.zones.length) opts.zones = tc.zones;
    opts.onTap = (i, pos) => { const rec = recent[i]; if (rec) showVitalTooltip(canvas.parentElement, kind, rec, pos.x, pos.y); };
    opts.onLeave = () => hideVitalTooltip();
    Charts.line(canvas, series, opts);
  }
  /* tooltip：画布上方浮层，显示日期/时间/数值/判定（关键信息仍在下方列表，这里只做补充） */
  function showVitalTooltip(box, kind, v, px, py) {
    hideVitalTooltip();
    const [cls, txt] = vitalStatus(kind, v);
    let html = `<div class="vt-t">${esc(v.date)}${v.time ? ' ' + esc(v.time) : ''}</div>`;
    if (kind === 'bp') {
      /* 高压/低压颜色从 VITAL_SERIES 取，别再在这里硬写一遍 hex——
         图表画线与这里的 tooltip 数字要同色，只能有一个真源。 */
      const bpColor = key => (VITAL_SERIES.bp.series.find(s => s.key === key) || {}).color || '';
      html += `<div class="vt-v"><span style="color:${bpColor('sys')}">${esc(v.sys)}</span>/<span style="color:${bpColor('dia')}">${esc(v.dia)}</span> mmHg${v.pulse ? ' · ♥ ' + esc(v.pulse) : ''}</div>`;
    } else {
      html += `<div class="vt-v">${VITAL_FMT[kind](v)}</div>`;
    }
    html += `<div class="vt-s ${cls}">${esc(txt)}</div>`;
    const tip = document.createElement('div');
    tip.className = 'vital-tooltip';
    tip.innerHTML = html;
    box.appendChild(tip);
    const w = tip.offsetWidth || 170, h = tip.offsetHeight || 70;
    const bw = box.clientWidth;
    let left = px - w / 2;
    left = Math.max(6, Math.min(left, bw - w - 6));
    let top = py - h - 12;
    if (top < 6) top = py + 12;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  function hideVitalTooltip() {
    const el = document.querySelector('.vital-tooltip');
    if (el) el.remove();
  }
  function histBtnHTML(kind, count) {
    if (!count) return '';
    return `<button class="btn ghost block" data-hist="${kind}" style="margin-top:0.8rem">📄 查看全部历史记录（${count} 条）</button>`;
  }
  function bindHist(body) {
    body.querySelectorAll('[data-hist]').forEach(b => b.onclick = () => openVitalHistory(b.dataset.hist));
  }

  /* 历史弹窗：趋势图 + 全部记录（每条带红黄绿状态点），可删除 */
  function openVitalHistory(kind) {
    const meta = REC_KINDS[kind];
    const node = document.createElement('div');
    openModal(`${meta.icon} ${meta.name}历史`, node);

    const paint = () => {
      const sorted = Store.vitalsSorted(kind);
      if (!sorted.length) {
        node.innerHTML = '<div class="empty-tip">没有记录了</div>';
        return;
      }
      const recent = sorted.slice(-30);
      const rows = [...sorted].reverse().map(v => {
        const [cls, txt] = vitalStatus(kind, v);
        return `
        <div class="rec-row">
          <span class="rec-dot ${cls}"></span>
          <span class="rec-date">${esc(v.date)}<br>${esc(v.time || '')}</span>
          <span class="rec-val">${VITAL_FMT[kind](v)}${txt ? `<br><span class="rec-note ${cls}">${txt}</span>` : ''}</span>
          <button class="rec-del" data-del="${esc(v.id)}" aria-label="删除">🗑</button>
        </div>`;
      }).join('');

      node.innerHTML = `
      ${recent.length >= 2 ? `
      <div class="card">
        <div class="card-title">📈 趋势（近 ${recent.length} 条）</div>
        ${chartSummaryHTML(kind, recent)}
        <div class="chart-box"><canvas id="vh-chart"></canvas></div>
        ${chartLegendHTML(kind)}
      </div>` : ''}
      <div class="card">
        <div class="card-title">📄 全部记录（${sorted.length} 条）</div>
        <div class="rec-list">${rows}</div>
      </div>`;

      node.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
        if (confirm('删除这条记录？')) {
          if (!stored(Store.removeVital(kind, b.dataset.del))) return;
          paint();
          render('records', { keepScroll: true, preserveInputs: true });
        }
      });
      drawVitalChart(kind, node.querySelector('#vh-chart'), recent);
    };
    paint();
  }

  function renderRecords() {
    let html = `
    ${pageHeading('健康记录', '记录测量结果，复诊时方便核对。')}
    <div class="rec-tabs" role="group" aria-label="记录类型">
      ${Object.entries(REC_KINDS).map(([k, v]) =>
        `<button class="rec-tab ${recTab === k ? 'active' : ''}" aria-pressed="${recTab === k}" aria-controls="rec-body" data-rectab="${k}">${v.name}</button>`).join('')}
    </div>
    <div id="rec-body"></div>
    <button class="btn ghost block" id="btn-export" style="margin-top:0.2rem">📤 导出记录给医生看</button>
    <div class="disclaimer">浅绿为目标区（遵医嘱，可在设置里调整）；140/90 为一般提示线。指南建议多数患者在能耐受时降至 130/80 以下（部分情况例外），你的控制目标以医生要求为准。</div>`;
    $view().innerHTML = html;

    $view().querySelectorAll('[data-rectab]').forEach(b => b.onclick = () => {
      if (recTab === b.dataset.rectab) return;
      captureRecordDraft();
      recTab = b.dataset.rectab;
      render('records', { keepScroll: true });
      $view().querySelector(`[data-rectab="${recTab}"]`).focus({ preventScroll: true });
    });
    document.getElementById('btn-export').onclick = openExport;

    const body = document.getElementById('rec-body');
    if (recTab === 'bp') renderBP(body);
    else if (recTab === 'glucose') renderGlucose(body);
    else renderWeight(body);
    restoreRecordDraft();
    const form = body.querySelector('.vital-form');
    const status = document.createElement('p');
    status.className = 'form-status';
    status.setAttribute('role', 'status');
    form.appendChild(status);
    const markDraft = () => {
      form.dataset.dirty = 'true';
      status.className = 'form-status';
      status.textContent = '尚未保存，填写后请点保存。';
      if (recordSaved?.kind === recTab) recordSaved = null;
    };
    form.addEventListener('input', markDraft);
    form.addEventListener('change', markDraft);
    if (recordDrafts[recTab]) markDraft();
    else if (recordSaved?.kind === recTab) {
      status.classList.add('saved');
      status.textContent = recordSaved.message;
    } else status.textContent = '填好后请点保存，记录仅保存在本机。';
  }

  function captureRecordDraft() {
    const body = document.getElementById('rec-body');
    if (!body) return;
    const form = body.querySelector('.vital-form');
    const typed = [...form.querySelectorAll('input[type="number"]')].some(el => el.value !== '');
    if (!typed && !form.dataset.dirty) return;
    recordDrafts[recTab] = {
      values: [...form.querySelectorAll('input[id], select[id]')].map(el => [el.id, el.value]),
      expanded: !form.querySelector('.dt-row').hidden,
    };
  }
  function restoreRecordDraft() {
    const draft = recordDrafts[recTab];
    if (!draft) return;
    draft.values.forEach(([id, value]) => { document.getElementById(id).value = value; });
    const prefix = { bp: 'bp', glucose: 'glu', weight: 'wt' }[recTab];
    document.getElementById(prefix + '-dt-row').hidden = !draft.expanded;
    bindWhenToggle(prefix);
  }
  function recordSaveDone(message) {
    delete recordDrafts[recTab];
    recordSaved = { kind: recTab, message };
    render('records', { keepScroll: true });
    const status = document.querySelector('.form-status');
    status.tabIndex = -1;
    status.focus({ preventScroll: true });
    toast('记录已保存');
  }
  function clearRecordSession() {
    Object.keys(recordDrafts).forEach(key => delete recordDrafts[key]);
    recordSaved = null;
  }

  function formDefaults() {
    return { d: Store.today(), t: Store.timeStr() };
  }

  /* 日期时间的口语化短显示：绝大多数记录就是"刚刚"，低频修改不值得占一级大字段 */
  function fmtWhen(date, time) {
    if (!date) return '请选择日期';
    const today = Store.today();
    const head = date === today ? '今天'
      : date === Store.addDays(today, -1) ? '昨天'
        : `${+date.slice(5, 7)}-${+date.slice(8, 10)}`;
    return time ? `${head} ${time}` : head;
  }

  /* 「记录时间」收敛成一个小条：点开才显示日期/时间原生输入（同前缀约定：*-dt-chip / *-dt-row / *-date / *-time） */
  function bindWhenToggle(prefix) {
    const row = document.getElementById(prefix + '-dt-row');
    const chip = document.getElementById(prefix + '-dt-chip');
    if (!row || !chip) return;
    const dateEl = document.getElementById(prefix + '-date');
    const timeEl = document.getElementById(prefix + '-time');
    const fmt = () => { chip.textContent = fmtWhen(dateEl.value, timeEl ? timeEl.value : '') + ' · 修改'; };
    chip.setAttribute('aria-controls', row.id);
    chip.setAttribute('aria-expanded', String(!row.hidden));
    chip.onclick = () => {
      row.hidden = !row.hidden;
      chip.setAttribute('aria-expanded', String(!row.hidden));
    };
    dateEl.onchange = fmt;
    if (timeEl) timeEl.onchange = fmt;
    fmt();
  }

  function renderBP(body) {
    const { d, t } = formDefaults();
    const sorted = Store.vitalsSorted('bp');
    const latest = sorted[sorted.length - 1];
    let latestHTML = '<div class="empty-tip">还没有血压记录，从今天开始吧</div>';
    if (latest) {
      const [cls, txt] = bpBadge(+latest.sys, +latest.dia);
      latestHTML = `
      <div class="latest-value">
        <span class="big">${esc(latest.sys)}/${esc(latest.dia)}</span><span class="muted">mmHg</span>
        <span class="badge ${cls}">${txt}</span>
      </div>
      ${deltaLineHTML('bp')}
      <div class="muted">最近记录：${esc(latest.date)} ${esc(latest.time || '')}${latest.pulse ? ' · 脉搏 ' + esc(latest.pulse) + ' 次/分' : ''}</div>`;
    }

    body.innerHTML = `
    <div class="card">
      <h2 class="card-title">记一次血压</h2>
      <div class="vital-form">
        <div class="form-row">
          <div class="field"><label for="bp-sys">高压<span class="label-opt">（收缩压）</span></label><input id="bp-sys" type="number" inputmode="numeric" placeholder="如 135"></div>
          <div class="field"><label for="bp-dia">低压<span class="label-opt">（舒张压）</span></label><input id="bp-dia" type="number" inputmode="numeric" placeholder="如 85"></div>
        </div>
        <div class="form-inline">
          <label class="fi-label" for="bp-pulse">脉搏<span class="label-opt">（选填）</span></label>
          <input id="bp-pulse" type="number" inputmode="numeric" placeholder="次/分">
        </div>
        <div class="form-inline">
          <span class="fi-label">记录时间</span>
          <button type="button" class="dt-chip" id="bp-dt-chip"></button>
        </div>
        <div class="form-row dt-row" id="bp-dt-row" hidden>
          <div class="field wide"><label for="bp-date">日期</label><input id="bp-date" type="date" value="${d}"></div>
          <div class="field wide"><label for="bp-time">时间</label><input id="bp-time" type="time" value="${t}"></div>
        </div>
        <button class="btn block" id="bp-save">保存血压记录</button>
      </div>
    </div>
    <div class="card">
      <h2 class="card-title">最近血压</h2>
      ${latestHTML}
      ${sorted.length >= 2 ? `${chartSummaryHTML('bp', sorted.slice(-14))}<div class="chart-box"><canvas id="bp-chart"></canvas></div>${chartLegendHTML('bp')}` : ''}
      ${histBtnHTML('bp', sorted.length)}
    </div>`;

    bindWhenToggle('bp');
    document.getElementById('bp-save').onclick = () => {
      clearFieldErrors(body);
      const sys = +document.getElementById('bp-sys').value;
      const dia = +document.getElementById('bp-dia').value;
      const pulse = document.getElementById('bp-pulse').value;
      const date = document.getElementById('bp-date').value;
      const time = document.getElementById('bp-time').value;
      if (!sys || sys < 50 || sys > 300) { fieldError('bp-sys', '请核对血压计上的高压读数，再填写高压。'); return; }
      if (!dia || dia < 30 || dia > 200) { fieldError('bp-dia', '请核对血压计上的低压读数，再填写低压。'); return; }
      if (pulse && !(+pulse > 0 && +pulse <= 400)) { fieldError('bp-pulse', '请核对脉搏读数，不记录时可以留空。'); return; }
      if (!date) { fieldError('bp-date', '请选择这次测量的日期。'); return; }
      if (!stored(Store.addVital('bp', { date, time, sys, dia, pulse: pulse ? +pulse : '' }))) return;
      const [cls, txt] = bpBadge(sys, dia);
      recordSaveDone(`✓ 已保存血压 ${sys}/${dia} mmHg · ${fmtWhen(date, time)}${cls === 'bad' ? '。' + txt : ''}`);
    };
    bindHist(body);
    drawVitalChart('bp', document.getElementById('bp-chart'), sorted.slice(-14));
  }

  function renderGlucose(body) {
    const { d, t } = formDefaults();
    const sorted = Store.vitalsSorted('glucose');
    const latest = sorted[sorted.length - 1];
    let latestHTML = '<div class="empty-tip">还没有血糖记录（没有糖尿病也可偶尔测测）</div>';
    if (latest) {
      const [cls, txt] = gluBadge(latest.gtype, +latest.value);
      latestHTML = `
      <div class="latest-value">
        <span class="big">${esc(latest.value)}</span><span class="muted">mmol/L（${esc(latest.gtype)}）</span>
        <span class="badge ${cls}">${txt}</span>
      </div>
      ${deltaLineHTML('glucose')}
      <div class="muted">最近记录：${esc(latest.date)} ${esc(latest.time || '')}</div>`;
    }

    body.innerHTML = `
    <div class="card">
      <h2 class="card-title">记一次血糖</h2>
      <div class="vital-form">
        <div class="form-row">
          <div class="field"><label for="glu-type">测量类型</label>
            <select id="glu-type"><option>空腹</option><option>餐后2小时</option><option>随机</option></select>
          </div>
          <div class="field"><label for="glu-val">数值 mmol/L</label><input id="glu-val" type="number" step="0.1" inputmode="decimal" placeholder="如 6.2"></div>
        </div>
        <div class="form-inline">
          <span class="fi-label">记录时间</span>
          <button type="button" class="dt-chip" id="glu-dt-chip"></button>
        </div>
        <div class="form-row dt-row" id="glu-dt-row" hidden>
          <div class="field wide"><label for="glu-date">日期</label><input id="glu-date" type="date" value="${d}"></div>
          <div class="field wide"><label for="glu-time">时间</label><input id="glu-time" type="time" value="${t}"></div>
        </div>
        <button class="btn block" id="glu-save">保存血糖记录</button>
      </div>
    </div>
    <div class="card">
      <h2 class="card-title">最近血糖</h2>
      ${latestHTML}
      ${sorted.length >= 2 ? `${chartSummaryHTML('glucose', sorted.slice(-14))}<div class="chart-box"><canvas id="glu-chart"></canvas></div>${chartLegendHTML('glucose')}` : ''}
      ${histBtnHTML('glucose', sorted.length)}
    </div>`;

    bindWhenToggle('glu');
    document.getElementById('glu-save').onclick = () => {
      clearFieldErrors(body);
      const gtype = document.getElementById('glu-type').value;
      const value = +document.getElementById('glu-val').value;
      const date = document.getElementById('glu-date').value;
      const time = document.getElementById('glu-time').value;
      if (!value || value < 1 || value > 40) { fieldError('glu-val', '请核对血糖读数，按 mmol/L 填写。'); return; }
      if (!date) { fieldError('glu-date', '请选择这次测量的日期。'); return; }
      if (!stored(Store.addVital('glucose', { date, time, gtype, value }))) return;
      recordSaveDone(`✓ 已保存${gtype}血糖 ${value} mmol/L · ${fmtWhen(date, time)}`);
    };
    bindHist(body);
    drawVitalChart('glucose', document.getElementById('glu-chart'), sorted.slice(-14));
  }

  function renderWeight(body) {
    const { d } = formDefaults();
    const sorted = Store.vitalsSorted('weight');
    const latest = sorted[sorted.length - 1];
    const height = +Store.data.profile.height;
    let latestHTML = '<div class="empty-tip">还没有体重记录，每周记 1～2 次就够了</div>';
    if (latest) {
      let bmiHTML = '';
      if (height) {
        const bmi = +latest.value / Math.pow(height / 100, 2);
        const [cls, txt] = bmiBadge(bmi);
        /* 先给结论"体重适中"，BMI 数字放括号里降为参考 */
        bmiHTML = `<span class="badge ${cls}">${txt}（BMI ${bmi.toFixed(1)}）</span>`;
      } else {
        bmiHTML = '<span class="muted">在「设置」里填身高，就能帮您算胖瘦</span>';
      }
      latestHTML = `
      <div class="latest-value">
        <span class="big">${esc(latest.value)}</span><span class="muted">公斤</span>
        ${bmiHTML}
      </div>
      ${deltaLineHTML('weight')}
      <div class="muted">最近记录：${esc(latest.date)}</div>`;
    }

    body.innerHTML = `
    <div class="card">
      <h2 class="card-title">记一次体重</h2>
      <div class="vital-form">
        <div class="form-row">
          <div class="field"><label for="wt-val">体重（公斤）</label><input id="wt-val" type="number" step="0.1" inputmode="decimal" placeholder="如 62.5"></div>
        </div>
        <div class="form-inline">
          <span class="fi-label">记录日期</span>
          <button type="button" class="dt-chip" id="wt-dt-chip"></button>
        </div>
        <div class="form-row dt-row" id="wt-dt-row" hidden>
          <div class="field wide"><label for="wt-date">日期</label><input id="wt-date" type="date" value="${d}"></div>
        </div>
        <button class="btn block" id="wt-save">保存体重记录</button>
      </div>
    </div>
    <div class="card">
      <h2 class="card-title">最近体重</h2>
      ${latestHTML}
      ${sorted.length >= 2 ? `${chartSummaryHTML('weight', sorted.slice(-14))}<div class="chart-box"><canvas id="wt-chart"></canvas></div>${chartLegendHTML('weight')}` : ''}
      ${histBtnHTML('weight', sorted.length)}
    </div>`;

    bindWhenToggle('wt');
    document.getElementById('wt-save').onclick = () => {
      clearFieldErrors(body);
      const value = +document.getElementById('wt-val').value;
      const date = document.getElementById('wt-date').value;
      if (!value || value < 20 || value > 300) { fieldError('wt-val', '请核对体重读数，以公斤填写。'); return; }
      if (!date) { fieldError('wt-date', '请选择这次测量的日期。'); return; }
      if (!stored(Store.addVital('weight', { date, value }))) return;
      recordSaveDone(`✓ 已保存体重 ${value} 公斤 · ${fmtWhen(date)}`);
    };
    bindHist(body);
    drawVitalChart('weight', document.getElementById('wt-chart'), sorted.slice(-14));
  }

  function openExport() {
    const text = Store.exportReport();
    const node = nodeFromHTML(`
      <p class="muted" style="margin-bottom:0.5rem">复诊时把这份记录给医生看，或复制后发给家人打印。</p>
      <textarea id="export-text" style="width:100%;height:45vh;border:1.5px solid var(--border);border-radius:12px;padding:0.7rem;font-size:0.9rem;line-height:1.5" readonly></textarea>
      <button class="btn block" id="copy-export" style="margin-top:0.7rem">📋 复制全部内容</button>`);
    node.querySelector('#export-text').value = text;
    openModal('导出健康记录', node);
    node.querySelector('#copy-export').onclick = async () => {
      const ta = node.querySelector('#export-text');
      try {
        await navigator.clipboard.writeText(ta.value);
        toast('已复制，可粘贴到微信发给家人');
      } catch (e) {
        ta.focus(); ta.select();
        document.execCommand && document.execCommand('copy');
        toast('已选中内容，长按可复制');
      }
    };
  }

  /* ============================================================
     【区】用药页：核对表 → 药物清单 → 服药历史 → 登记/停用/新疗程表单
     ============================================================ */
  function renderMeds() {
    const meds = Store.data.meds;
    const ad = Store.adherence7d();

    /* 按时间分组的今日核对表：只列**今天在吃**的药（已停用的不出现在核对表里，
       否则会天天显示"漏服"，冤枉患者） */
    const todayMeds = Store.medsOn();
    const slots = {};
    todayMeds.forEach(m => (m.times || []).forEach(t => {
      if (!slots[t]) slots[t] = [];
      slots[t].push(m);
    }));
    const times = Object.keys(slots).sort();

    let checkHTML;
    if (!meds.length) {
      checkHTML = '<div class="empty-tip">还没有登记药物。<br>请按医生处方，点下方按钮添加。</div>';
    } else if (!todayMeds.length) {
      checkHTML = '<div class="empty-tip">今天没有需要核对的药。<br>（清单里的药都已停用，或还没到开始服用的日期）</div>';
    } else {
      checkHTML = times.map(t => `
        <div class="med-time-group">
          <div class="med-time-label">🕐 ${esc(t)}</div>
          ${slots[t].map(m => {
            const taken = Store.isMedTaken(m.id, t);
            return `
            <div class="med-check ${taken ? 'checked' : ''}" data-med="${esc(m.id)}" data-time="${esc(t)}" role="checkbox" aria-checked="${taken}" tabindex="0">
              <div class="mc-box">${taken ? '✓' : ''}</div>
              <div>
                <div class="mc-name">${esc(m.name)}</div>
                <div class="mc-dose">${esc(m.dose || '')}${m.note ? ' · ' + esc(m.note) : ''}</div>
              </div>
            </div>`;
          }).join('')}
        </div>`).join('');
    }

    /* 今日核对：把"还差几次"说在最前面，患者不用去数勾了几个 */
    const mp = Store.medProgressToday();
    const todayLine = mp.total
      ? (mp.done >= mp.total
        ? `<div class="today-summary">今天该吃的 ${mp.total} 次都核对完了 ✓</div>`
        : `<div class="today-summary">今天一共 ${mp.total} 次，${leftText(mp.done, mp.total, '次还没核对')}${dotsHTML(mp.done, mp.total)}</div>`)
      : '';

    /* 近 7 天：主指标改成"几天全吃到"（整数天数，好懂），百分比降为给医生看的次要信息。
       医学内容不删：依从性与复发风险的科普保留，但从"指责漏服"改成中性知识 + 可执行的办法。 */
    const fd = Store.medFullDays(7);
    let adBody = '';
    if (fd.days) {
      if (fd.full >= fd.days) {
        adBody = `<div class="ad-main">最近 ${fd.days} 天，每天该吃的都核对到了</div>
          <div class="muted">这件事做得很到位，继续保持就好。</div>`;
      } else if (fd.full > 0) {
        adBody = `<div class="ad-main">最近 ${fd.days} 天里，有 <b>${fd.full}</b> 天全都吃到了</div>
          <div class="muted">已经记住大部分了。剩下容易忘的那几次，可以试试：手机设闹钟、把药盒放在饭桌上、或让家人在服药时间提一句。</div>`;
      } else {
        adBody = `<div class="ad-main">最近这几天还没有哪天全部核对上</div>
          <div class="muted">忘吃药很常见，不是您的问题，多半是没有提醒。可以试试：手机设闹钟、把药盒放在饭桌上、请家人在服药时间提一句。吃完在这一页点一下就行。</div>`;
      }
    }

    let html = `
    ${pageHeading('用药核对', '按医生处方服药，吃完再做标记。')}
    <div class="card">
      <h2 class="card-title">今日服药核对 <span class="card-meta">吃完点一下</span></h2>
      ${todayLine}
      ${checkHTML}
    </div>
    ${ad !== null ? `
    <div class="card">
      <div class="card-title">📊 最近 7 天吃药情况</div>
      ${adBody}
      <div class="muted" style="margin-top:0.5rem">按次数算的完成率是 ${ad}%（这个数字是给医生看的）。坚持按医嘱服药，是预防再次中风最有效的一件事。</div>
      <button class="btn ghost block" id="btn-med-hist" style="margin-top:0.7rem">📄 查看服药历史（近14天）</button>
    </div>` : ''}
    ${medListHTML()}`;

    $view().innerHTML = html;

    $view().querySelectorAll('.med-check').forEach(elm => {
      const act = () => {
        if (!stored(Store.toggleMed(elm.dataset.med, elm.dataset.time))) return;
        render('meds', { keepScroll: true });
      };
      elm.onclick = act;
      elm.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } };
    });
    document.getElementById('btn-add-med').onclick = () => openMedForm();
    $view().querySelectorAll('[data-edit-med]').forEach(b => b.onclick = () => {
      const m = Store.data.meds.find(x => x.id === b.dataset.editMed);
      if (m) openMedForm(m);
    });
    const medHistBtn = document.getElementById('btn-med-hist');
    if (medHistBtn) medHistBtn.onclick = openMedHistory;
  }

  /* 药物清单：在吃的和已停用的分开列。
     停用的药**保留在清单里**（复诊要说清吃过什么），但灰显、不参与核对与依从率。 */
  function medRowHTML(m, stopped) {
    const times = m.times || [];
    const period = stopped
      ? `${m.from ? esc(m.from) + ' ' : ''}至 ${esc(m.to)} 停用`
      : (m.from ? `${esc(m.from)} 开始` : '');
    return `
    <div class="med-item${stopped ? ' stopped' : ''}">
      <div class="mi-body">
        <div class="mi-name">${esc(m.name)}${stopped ? '<span class="badge info mi-tag">已停用</span>' : ''}</div>
        <div class="mi-sub">${esc(m.dose || '')} · 每日${times.length}次（${times.map(esc).join('、')}）${m.note ? ' · ' + esc(m.note) : ''}</div>
        ${period ? `<div class="mi-period">${period}</div>` : ''}
      </div>
      <button class="btn small outline" data-edit-med="${esc(m.id)}" aria-label="${stopped ? '查看' : '修改'}：${esc(m.name)}">${stopped ? '查看' : '修改'}</button>
    </div>`;
  }
  function medListHTML() {
    const active = Store.activeMeds();
    const stopped = Store.stoppedMeds();
    return `
    <div class="card">
      <h2 class="card-title">我的药物清单</h2>
      ${active.map(m => medRowHTML(m, false)).join('')}
      ${!active.length && !stopped.length ? '' : ''}
      <button class="btn ghost block" id="btn-add-med" style="margin-top:0.7rem">＋ 添加药物</button>
      <div class="muted" style="margin-top:0.5rem">请严格按医生处方登记。任何加药、减药、停药都要先问医生。</div>
    </div>
    ${stopped.length ? `
    <div class="card">
      <div class="card-title">📋 已停用的药 <span class="muted" style="font-weight:400">（留着给医生看）</span></div>
      ${stopped.map(m => medRowHTML(m, true)).join('')}
      <div class="muted" style="margin-top:0.5rem">停用的药不再出现在每日核对里，也不计入完成率，但记录保留下来——复诊时医生常会问"这个药吃到什么时候"。</div>
    </div>` : ''}`;
  }

  /* 服药历史：每天一行，一个圆点代表一次应服的药 */
  function openMedHistory() {
    const days = Store.medHistory(14);
    const sum = days.reduce((a, d) => ({ total: a.total + d.total, done: a.done + d.done }), { total: 0, done: 0 });
    const pct = sum.total ? Math.round(sum.done / sum.total * 100) : 0;
    const t = Store.today();

    const rows = days.map(d => `
      <div class="day-row">
        <span class="day-date">${esc(d.date.slice(5))}${d.date === t ? '（今天）' : ''}<br>${weekdayOf(d.date)}</span>
        <span class="dot-row">${d.items.map(i =>
          `<i class="dose-dot ${i.taken ? 'taken' : ''}" aria-label="${esc(i.time)} ${esc(i.name)} ${i.taken ? '已服' : '未记录'}"></i>`).join('')}</span>
        <span class="day-score ${d.total && d.done >= d.total ? 'ok' : ''}">${!d.total ? '—' : d.done >= d.total ? '全吃到' : `差 ${d.total - d.done} 次`}</span>
      </div>`).join('');

    const fd14 = Store.medFullDays(14);
    const node = nodeFromHTML(`
      <div class="card">
        <div class="card-title">📊 最近 14 天</div>
        <div class="ad-main">有 <b>${fd14.full}</b> 天该吃的全都核对到了${fd14.days ? `（共 ${fd14.days} 天有记录）` : ''}</div>
        <div class="muted">按次数算：${sum.total} 次里核对了 ${sum.done} 次，完成率 ${pct}%（给医生看的数字）</div>
      </div>
      <div class="card">
        <div class="card-title">📄 每天核对情况</div>
        <div class="day-legend"><i class="dose-dot taken"></i> 已核对　<i class="dose-dot"></i> 未记录</div>
        ${rows}
      </div>
      <div class="disclaimer">应服次数按「当前药物清单」计算；如果最近改过处方，更早日期的次数会按新处方显示。漏服记录仅供自我提醒，用药调整请遵医嘱。</div>`);
    openModal('服药历史', node);
  }

  const COMMON_TIMES = ['06:30', '07:30', '08:00', '11:30', '12:00', '17:30', '18:00', '20:00', '21:00'];
  const COMMON_MEDS = ['阿司匹林肠溶片', '硫酸氢氯吡格雷片', '阿托伐他汀钙片', '瑞舒伐他汀钙片'];

  function openMedForm(med, seed = null) {
    const isEdit = !!med;
    const stopped = isEdit && Store.isMedStopped(med);
    const formData = med || seed || {};
    const sel = new Set(Array.isArray(formData.times) && formData.times.length ? formData.times : ['08:00']);

    const node = nodeFromHTML(`
      <div class="vital-form">
        <div class="field" style="margin-bottom:0.7rem">
          <label for="med-name">药物名称（按处方填写）</label>
          <input id="med-name" type="text" placeholder="如 阿司匹林肠溶片" value="${esc(formData.name || '')}">
          <div class="time-chip-row" style="margin-top:0.4rem">
            ${COMMON_MEDS.map(n => `<button class="time-chip" data-preset="${esc(n)}" style="font-size:0.88rem">${esc(n)}</button>`).join('')}
          </div>
        </div>
        <div class="field" style="margin-bottom:0.7rem">
          <label for="med-dose">每次用量</label>
          <input id="med-dose" type="text" placeholder="如 100mg，1片" value="${esc(formData.dose || '')}">
        </div>
        <div class="field" style="margin-bottom:0.7rem">
          <label for="custom-time" id="med-time-label">每天服药时间（可多选）</label>
          <div class="time-chip-row" id="time-chips" role="group" aria-labelledby="med-time-label">
            ${COMMON_TIMES.map(t => `<button class="time-chip ${sel.has(t) ? 'active' : ''}" data-t="${t}" aria-pressed="${sel.has(t)}">${t}</button>`).join('')}
          </div>
          <div style="display:flex;gap:0.5rem;margin-top:0.5rem;align-items:center">
            <input id="custom-time" type="time" style="flex:1">
            <button class="btn small outline" id="add-custom-time">添加自定时间</button>
          </div>
          <div class="muted" style="margin-top:0.3rem">已选：<span id="sel-times">${[...sel].sort().join('、') || '无'}</span></div>
        </div>
        <div class="field" style="margin-bottom:0.7rem">
          <label for="med-note">备注（可不填）</label>
          <input id="med-note" type="text" placeholder="如 饭后服、别嚼碎" value="${esc(formData.note || '')}">
        </div>
        <div class="field" style="margin-bottom:0.9rem">
          <label for="med-from">从哪天开始吃</label>
          <input id="med-from" type="date" value="${esc(formData.from || Store.today())}">
          <div class="muted" style="margin-top:0.3rem">用来算完成率：开始之前的日子不会算你漏服。</div>
        </div>
        <button class="btn block" id="med-save">${isEdit ? '保存修改' : seed ? '登记新疗程' : '添加药物'}</button>
        ${isEdit && stopped ? `
        <div class="stop-box">
          <div class="sb-title">已停用：${esc(med.from || '')} 至 ${esc(med.to)}</div>
          <div class="muted">这个药已经不在每日核对里了，记录保留着给医生看。</div>
          ${Store.canUndoStop(med.id)
            ? '<button class="btn outline block" id="med-undo-stop" style="margin-top:0.6rem">停错了，撤销停用</button>'
            : '<div class="muted" style="margin-top:0.5rem">已经登记了后续新疗程，这段旧停药记录不能再撤销。</div>'}
          <button class="btn ghost block" id="med-new-course" style="margin-top:0.6rem">医生重新开了，登记新疗程</button>
        </div>` : ''}
        ${isEdit && !stopped ? `
        <div class="stop-box">
          <div class="sb-title">医生让停这个药了？</div>
          <div class="muted">选「已停用」——它会从每日核对里消失、不再算漏服，但记录留着（复诊时医生常问"吃到什么时候"）。<b>不要用删除</b>，删了历史里就查不到吃过这个药。</div>
          <div style="display:flex;gap:0.5rem;margin-top:0.5rem;align-items:center">
            <input id="med-stop-date" aria-label="最后服药日期" type="date" value="${Store.today()}" min="${esc(med.from || '')}" max="${Store.today()}" style="flex:1;min-height:54px;border:1.5px solid var(--border);border-radius:12px;padding:0 0.6rem;font-size:1.05rem">
            <button class="btn small outline" id="med-stop">吃到这天为止</button>
          </div>
        </div>` : ''}
        ${isEdit ? '<button class="btn red block" id="med-del" style="margin-top:0.6rem">删除（登记错了才用）</button>' : ''}
      </div>`);

    const close = openModal(isEdit ? '修改药物' : seed ? '登记新疗程' : '添加药物', node);

    const refreshSel = () => {
      node.querySelector('#sel-times').textContent = [...sel].sort().join('、') || '无';
      node.querySelectorAll('#time-chips .time-chip').forEach(c => {
        c.classList.toggle('active', sel.has(c.dataset.t));
        c.setAttribute('aria-pressed', String(sel.has(c.dataset.t)));
      });
    };
    node.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
      node.querySelector('#med-name').value = b.dataset.preset;
    });
    node.querySelectorAll('#time-chips .time-chip').forEach(c => c.onclick = () => {
      const t = c.dataset.t;
      if (sel.has(t)) sel.delete(t); else sel.add(t);
      refreshSel();
    });
    node.querySelector('#add-custom-time').onclick = () => {
      const v = node.querySelector('#custom-time').value;
      if (v) { sel.add(v); refreshSel(); }
    };
    node.querySelector('#med-save').onclick = () => {
      clearFieldErrors(node);
      const name = node.querySelector('#med-name').value.trim();
      const dose = node.querySelector('#med-dose').value.trim();
      const note = node.querySelector('#med-note').value.trim();
      if (!name) { fieldError('med-name', '请按医生处方填写药物名称。'); return; }
      if (!sel.size) { showError(node, '请至少选择一个服药时间'); return; }
      const from = node.querySelector('#med-from').value;
      if (!from) { showError(node, '请选择开始服用日期'); return; }
      if (seed && seed.from && from < seed.from) { showError(node, '新疗程不能早于上次停药后的第一天'); return; }
      const payload = { name, dose, note, times: [...sel].sort(), from, previousCourseId: seed ? seed.previousCourseId || '' : formData.previousCourseId || '' };
      const ok = isEdit ? Store.updateMed(med.id, payload) : Store.addMed(payload);
      if (!stored(ok)) return;
      close();
      toast(isEdit ? '已保存修改' : seed ? '已登记新疗程' : '已添加药物');
      render('meds', { keepScroll: true });
    };
    const stopBtn = node.querySelector('#med-stop');
    if (stopBtn) stopBtn.onclick = () => {
      const d = node.querySelector('#med-stop-date').value || Store.today();
      if (d > Store.today()) { showError(node, '停用日期不能晚于今天'); return; }
      if (med.from && d < med.from) { showError(node, '停用日期不能早于开始服用日期'); return; }
      if (!stored(Store.stopMed(med.id, d))) return;
      close();
      toast(`已记为停用（吃到 ${d}）`);
      render('meds', { keepScroll: true });
    };
    const undoStopBtn = node.querySelector('#med-undo-stop');
    if (undoStopBtn) undoStopBtn.onclick = () => {
      if (!stored(Store.undoStopMed(med.id))) return;
      close();
      toast('已撤销停用，重新进入每日核对');
      render('meds', { keepScroll: true });
    };
    const newCourseBtn = node.querySelector('#med-new-course');
    if (newCourseBtn) newCourseBtn.onclick = () => {
      const nextDay = med.to && med.to >= Store.today() ? Store.addDays(med.to, 1) : Store.today();
      const seedData = { name: med.name, dose: med.dose, times: med.times, note: med.note, from: nextDay, previousCourseId: med.id };
      close.replace(() => openMedForm(null, seedData));
    };
    if (isEdit) node.querySelector('#med-del').onclick = () => {
      /* 删除 vs 停用：明确告诉用户区别，避免为了"停药"而删掉历史 */
      if (confirm(`确定删除「${med.name}」？\n\n删除会连历史记录一起消失。\n如果是遵医嘱停药，请用「吃到这天为止」，不要删除。`)) {
        if (!stored(Store.removeMed(med.id))) return;
        close();
        toast('已删除');
        render('meds', { keepScroll: true });
      }
    };
  }

  /* ============================================================
     【区】知识页
     ============================================================ */
  function renderLearn() {
    const groups = [];
    ARTICLES.forEach(a => { if (!groups.includes(a.group)) groups.push(a.group); });

    let html = `
    ${pageHeading('康复知识', '常用知识，和家人一起慢慢了解。')}
    <div class="card" style="border:2px solid var(--red)">
      <div class="card-title" style="color:var(--red)">🚨 出现这些情况，立即拨打120</div>
      <div class="muted" style="margin-bottom:0.5rem">口角歪斜 · 单侧肢体无力 · 说话不清 · 突然看不清 · 走不稳</div>
      <button class="btn red block" id="btn-open-emergency">查看急救指引 + 拨打120</button>
    </div>
    ${groups.map(g => `
      <h2 class="section-label">${esc(g)}</h2>
      <div class="list-group">
        ${ARTICLES.filter(a => a.group === g).map(a => `
          <div class="art-item" data-art="${a.id}" role="button" tabindex="0">
            <div class="art-icon" aria-hidden="true">${a.icon}</div>
            <div class="art-body">
              <div class="art-title">${a.title}</div>
              <div class="art-sub">${a.sub}</div>
            </div>
            <div class="art-arrow" aria-hidden="true">›</div>
          </div>`).join('')}
      </div>
    `).join('')}
    <div class="disclaimer">内容参考国内卒中防治与康复指南整理，仅作健康教育用途，<br>不能替代医生的诊断和治疗建议。</div>`;

    $view().innerHTML = html;

    document.getElementById('btn-open-emergency').onclick = openEmergency;
    $view().querySelectorAll('[data-art]').forEach(elm => {
      const open = () => {
        const a = ARTICLES.find(x => x.id === elm.dataset.art);
        if (a) {
          const sb = speakBtnHTML('art-speak', '听这篇');
          const node = nodeFromHTML(
            `${sb ? `<div class="speak-row">${sb}</div>` : ''}<div class="article-view">${a.body}</div>`);
          openModal(a.title, node);
          bindSpeak(node.querySelector('#art-speak'), () => articleSpeechText(a));
        }
      };
      elm.onclick = open;
      elm.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    });
  }

  /* ============================================================
     【区】紧急弹窗（BE-FAST + 拨 120）
     ============================================================ */
  function openEmergency() {
    if (document.querySelector('.emergency-view')) return;
    document.getElementById('trainer')?._pause?.();
    const node = nodeFromHTML(`
      <div class="emergency-view">
        <div class="emergency-action">
          <div class="ev-title">疑似中风，立即行动！</div>
          <a class="call-120" href="tel:120">📞 立即拨打 120</a>
          <p class="muted">未打开拨号界面时，请用手机直接拨打 120。</p>
        </div>
        <div class="card" style="margin-bottom:0.8rem">
          ${BEFAST.map(b => `
            <div class="befast-item">
              <div class="bf-letter">${b.letter}</div>
              <div><div class="bf-name">${b.name}</div><div class="bf-desc">${b.desc}</div></div>
            </div>`).join('')}
        </div>
        <div class="card">
          <div class="card-title">同时要做的事</div>
          <ul style="padding-left:1.3rem">
            <li><b>记下发病时间</b>（最后一次看起来正常是几点）</li>
            <li>让患者平卧，头偏向一侧，解开衣领</li>
            <li><b>不要喂水、喂药、喂任何东西</b></li>
            <li>症状缓解了也要就医，不要"再观察观察"</li>
          </ul>
        </div>
      </div>`);
    openModal('紧急识别', node, { emergency: true });
  }

  /* ############################################################
     三、设置与备份：设置弹窗 + 恢复预览 + 加密恢复 + applyFont/applyVoice
     ############################################################ */

  /* ============================================================
     【区】设置弹窗（含从备份恢复的两个前置弹窗）
     ============================================================ */
  function openRestorePreview(parsed, fileName) {
    const s = Store.backupSummary(parsed.data);
    const confirmNode = nodeFromHTML(`
      <p class="muted" style="margin-bottom:0.5rem">备份文件：<b>${esc(fileName)}</b>${parsed.exportedAt ? '<br>导出时间：' + esc(parsed.exportedAt) : ''}</p>
      <div class="card" style="margin-bottom:0.7rem">
        <div class="card-title">恢复后将包含</div>
        <div class="guide-line">💊 药物 ${s.meds} 种　·　🩺 血压 ${s.bp} 条</div>
        <div class="guide-line">🩸 血糖 ${s.glucose} 条　·　⚖️ 体重 ${s.weight} 条</div>
        <div class="guide-line">💪 训练打卡 ${s.checkinDays} 天</div>
      </div>
      <div class="disclaimer" style="padding:0.2rem 0 0.6rem">恢复会用备份<b>覆盖本机现有全部数据</b>。应用会自动保留恢复前的数据，可在设置中撤销一次。</div>
      <button class="btn block" id="restore-confirm">确认恢复</button>`);
    const closeConfirm = openModal('从备份恢复', confirmNode, { center: true });
    confirmNode.querySelector('#restore-confirm').onclick = () => {
      if (!Store.applyBackup(parsed.data)) {
        showError(confirmNode, Store.backupError() || '恢复失败，原有数据未改变');
        renderStorageNotice();
        return;
      }
      applyFont(Store.data.profile.font);
      applyVoice(Store.data.profile.speechVoice);
      settingsRevision++;
      clearRecordSession();
      closeConfirm();
      render(currentView, { keepScroll: true });
      toast('已从备份恢复，可在设置中撤销一次');
    };
  }

  function openEncryptedRestore(jsonText, fileName) {
    const node = nodeFromHTML(`
      <div class="vital-form">
        <div class="muted" style="margin-bottom:0.7rem">这是密码加密的备份。密码只在本机用于解密，不会保存或上传。</div>
        <div class="field">
          <label for="restore-password">备份密码</label>
          <input id="restore-password" type="password" maxlength="200" autocomplete="current-password">
        </div>
        <label style="display:flex;align-items:center;gap:0.6rem;min-height:48px;margin:0.35rem 0">
          <input id="restore-password-show" type="checkbox" style="width:24px;height:24px">显示密码
        </label>
        <div id="restore-password-error" role="alert" style="min-height:1.6em;color:var(--red);font-weight:600"></div>
        <button class="btn block" id="restore-decrypt">解密并查看内容</button>
      </div>`);
    const closePassword = openModal('打开加密备份', node, { center: true });
    const input = node.querySelector('#restore-password');
    const button = node.querySelector('#restore-decrypt');
    const error = node.querySelector('#restore-password-error');
    node.querySelector('#restore-password-show').onchange = e => { input.type = e.target.checked ? 'text' : 'password'; };
    let decrypting = false;
    const decrypt = async () => {
      if (decrypting || !closePassword.active()) return;
      if (!input.value) { error.textContent = '请输入备份密码'; input.focus(); return; }
      button.disabled = true;
      decrypting = true;
      button.textContent = '正在验证，请稍候…';
      error.textContent = '';
      try {
        const parsed = await Store.parseEncryptedBackup(jsonText, input.value);
        if (!closePassword.active()) return;
        input.value = '';
        closePassword.replace(() => openRestorePreview(parsed, fileName));
      } catch (e) {
        error.textContent = e.message || '没有解密成功';
        input.focus();
        input.select();
      } finally {
        decrypting = false;
        if (!dismissPending) button.disabled = false;
        button.textContent = '解密并查看内容';
      }
    };
    button.onclick = decrypt;
    input.onkeydown = e => { if (e.key === 'Enter') decrypt(); };
    setTimeout(() => { if (closePassword.active()) input.focus(); }, 80);
  }

  function openSettings() {
    const p = Store.data.profile;
    const revision = settingsRevision;
    /* 音色选项＝这台机器上真有的中文音色，只有两个以上才值得让用户选。
       不做"跟随系统"这一档：那是给开发者的概念，患者只想知道"现在是哪个声音"。
       高亮取真正在用的那个（存的名字在本机不存在时 Speech 已回落），
       保证"看到高亮的"和"按下听到的"永远是同一个声音。 */
    const voiceOpts = (Speech.supported() ? Speech.voices() : [])
      .map(v => ({ key: v.name, label: v.label, cls: 'f1' }));
    const voiceCurrent = () => {
      const want = Store.data.profile.speechVoice;
      return voiceOpts.some(o => o.key === want) ? want : Speech.voiceName();
    };
    const node = nodeFromHTML(`
      <div class="card">
        <div class="setting-row">
          <label class="sr-label" for="set-name">怎么称呼您</label>
          <input id="set-name" class="set-input" type="text" value="${esc(p.name)}" placeholder="如 王叔叔">
        </div>
        <div class="setting-row">
          <label class="sr-label" for="set-stroke-date">发病日期</label>
          <input id="set-stroke-date" class="set-input" type="date" value="${esc(p.strokeDate)}">
        </div>
        <div class="setting-row">
          <label class="sr-label" for="set-height">身高(cm)</label>
          <input id="set-height" class="set-input" type="number" inputmode="numeric" value="${esc(p.height)}" placeholder="算BMI用">
        </div>
        <div class="setting-row">
          <div class="sr-label">字体大小</div>
          ${segGroupHTML('font', '字体大小', FONT_OPTIONS, p.font)}
        </div>
        <div class="muted seg-hint">点一下立刻变大，不用再按保存。</div>
        ${Speech.supported() ? `
        <div class="setting-row">
          <div class="sr-label">朗读语速</div>
          ${segGroupHTML('rate', '朗读语速', RATE_OPTIONS, p.speechRate)}
        </div>
        <div class="muted">点一下就按这个速度念一句给您听，选好即生效。训练动作和科普文章里都有「<span class="nowrap">🔊 听一遍</span>」，读字费劲时可以让它念。<button class="link-btn" id="set-rate-try">再听一句</button></div>
        <div class="muted seg-hint">觉得声音太生硬？<button class="link-btn" id="set-voice-guide">教您换更自然的声音 →</button></div>
        ${voiceOpts.length > 1 ? `
        <div class="setting-row setting-stack">
          <div class="sr-label">朗读声音</div>
          ${segGroupHTML('voice', '朗读声音', voiceOpts, voiceCurrent())}
        </div>
        <div class="muted seg-hint">这台手机装了 ${voiceOpts.length} 个中文声音，点一下试听，挑个您听着舒服的。</div>
        ` : ''}
        ` : '<div class="muted">这个浏览器不支持语音朗读（换手机自带浏览器打开通常可用）。</div>'}
      </div>
      <div class="card">
        <div class="card-title">🎯 个人目标值（遵医嘱）</div>
        <div class="setting-row">
          <label class="sr-label" for="set-bpsys">血压高压目标</label>
          <input id="set-bpsys" class="set-input" type="number" inputmode="numeric" value="${esc(p.targets.bpSys)}"><span class="muted"> mmHg</span>
        </div>
        <div class="setting-row">
          <label class="sr-label" for="set-bpdia">血压低压目标</label>
          <input id="set-bpdia" class="set-input" type="number" inputmode="numeric" value="${esc(p.targets.bpDia)}"><span class="muted"> mmHg</span>
        </div>
        <div class="setting-row">
          <label class="sr-label" for="set-glufast">血糖空腹目标</label>
          <input id="set-glufast" class="set-input" type="number" step="0.1" inputmode="decimal" value="${esc(p.targets.gluFast)}"><span class="muted"> mmol/L</span>
        </div>
        <div class="setting-row">
          <label class="sr-label" for="set-glupost">血糖餐后2h目标</label>
          <input id="set-glupost" class="set-input" type="number" step="0.1" inputmode="decimal" value="${esc(p.targets.gluPost)}"><span class="muted"> mmol/L</span>
        </div>
        <div class="muted" style="margin-top:0.4rem">目标值按医生要求填写，图上会画出目标区、超过会提示"偏高"；血压 180/110、血糖极低/明显偏高等危险情况仍会单独警示。默认 140/90、空腹 7.0、餐后 10.0 仅为一般参考，以医嘱为准。</div>
      </div>
      <div class="section-label">使用帮助</div>
      <div class="card action-list">
        <button class="btn ghost block" id="set-guide">❓ 查看使用指引</button>
        <button class="btn ghost block" id="set-export" style="margin-top:0.6rem">📤 导出健康记录（给医生）</button>
      </div>
      <div class="section-label">数据与备份</div>
      <div class="card action-list">
        <div class="notice">记录只在当前浏览器里。换手机、换浏览器或换网址前，请先下载备份。</div>
        ${Store.originalData() !== null ? '<button class="btn outline block" id="set-original">下载原始数据副本（供排查）</button>' : ''}
        <button class="btn ghost block" id="set-backup" style="margin-top:0.6rem">📦 备份全部数据（下载文件）</button>
        <button class="btn ghost block" id="set-restore" style="margin-top:0.6rem">♻️ 从备份恢复</button>
        <input type="file" id="set-restore-input" accept=".json,application/json" style="display:none">
        ${Store.hasRecoveryBackup() ? `
          <button class="btn outline block" id="set-undo-restore" style="margin-top:0.6rem">↩️ 撤销上次恢复</button>
          <div class="muted" style="margin-top:0.35rem">可恢复到上次导入备份前的数据，只能撤销一次。</div>` : ''}
        <button class="btn outline block" id="set-reset" style="margin-top:0.6rem;color:var(--red)">清空全部数据</button>
        <div class="muted" style="margin-top:0.6rem">本应用不会上传数据。健康记录保存在这台设备的浏览器里；共用手机时，能使用这个浏览器的人可能看到这些记录。清空缓存或换手机会丢数据，请定期备份。</div>
      </div>
      <p class="muted">称呼、发病日期、身高和目标值填写后，请按「保存设置」。</p>
      <button class="btn block" id="set-save">保存设置</button>`);

    const close = openModal('设置', node);
    close.onResume(() => {
      if (revision !== settingsRevision) {
        const y = node.closest('.modal-panel').scrollTop;
        close.replace(openSettings);
        topOverlay().querySelector('.modal-panel').scrollTop = y;
      }
    });
    const original = node.querySelector('#set-original');
    if (original) original.onclick = () => {
      if (!confirm('原始副本可能包含健康隐私，仅供本人或可信家人排查。继续下载吗？')) return;
      try {
        saveBackupFile(Store.originalData(), false, '原始数据待修复');
        toast('已发起下载；这不是可直接恢复的备份，请妥善保存');
      } catch (e) { showError(node, '没有下载成功，请重试；原始内容仍保留在浏览器里'); }
    };

    /* 字号/语速是「即时生效」型设置：点一下就落盘。
       绝不能等「保存设置」——弹窗有 ✕/返回键/Esc/点遮罩四种关法，
       等保存会让已经生效的字号丢掉，下次打开回显成旧值（v0.2.25 修复的 bug）。 */
    bindSegGroup(node, 'font', {
      current: () => Store.data.profile.font,
      commit: key => commitProfile(
        pf => { pf.font = key; },
        () => applyFont(Store.data.profile.font),
      ),
    });
    /* 语速：点一下即按新速度念一句，让用户用耳朵选而不是猜"适中"是多快 */
    bindSegGroup(node, 'rate', {
      current: () => Store.data.profile.speechRate,
      commit: key => {
        const ok = commitProfile(pf => { pf.speechRate = key; });
        if (ok) Speech.speak('这是朗读速度，听得清吗？', { rateKey: Store.data.profile.speechRate });
        return ok;
      },
    });
    /* 音色：同样点一下即试听。先 setVoice 再念，让耳朵听到的就是刚点的那个。
       落盘失败时 commitProfile 已把 profile 读回旧值，这里按旧值再套一次，
       免得"存没存上"和"正在用哪个声音"对不上。 */
    bindSegGroup(node, 'voice', {
      current: voiceCurrent,
      commit: key => {
        const ok = commitProfile(pf => { pf.speechVoice = key; });
        applyVoice(Store.data.profile.speechVoice);
        if (ok) Speech.speak('您好，以后就用这个声音念给您听。', { rateKey: Store.data.profile.speechRate });
        return ok;
      },
    });
    const tryBtn = node.querySelector('#set-rate-try');
    if (tryBtn) tryBtn.onclick = () =>
      Speech.speak('每天坚持一点，慢慢会好起来。', { rateKey: Store.data.profile.speechRate });
    /* 帮助与独立任务作为子层打开，保留设置草稿；任务内部步骤才用 replace。 */
    const voiceGuideBtn = node.querySelector('#set-voice-guide');
    if (voiceGuideBtn) voiceGuideBtn.onclick = openVoiceGuide;
    node.querySelector('#set-guide').onclick = () => openGuide({ review: true });
    node.querySelector('#set-export').onclick = openExport;
    node.querySelector('#set-backup').onclick = openBackupWarning;
    node.querySelector('#set-restore').onclick = () => { node.querySelector('#set-restore-input').click(); };
    const undoRestore = node.querySelector('#set-undo-restore');
    if (undoRestore) undoRestore.onclick = () => {
      if (!confirm('撤销后，当前恢复进来的全部数据会被替换。确定回到恢复前的数据吗？')) return;
      if (!Store.undoLastRestore()) {
        showError(node, Store.backupError() || '没有撤销成功，当前数据未改变');
        renderStorageNotice();
        return;
      }
      close();
      clearRecordSession();
      applyFont(Store.data.profile.font);
      applyVoice(Store.data.profile.speechVoice);
      render(currentView, { keepScroll: true });
      toast('已撤销上次恢复');
    };
    node.querySelector('#set-restore-input').onchange = () => {
      const fileInput = node.querySelector('#set-restore-input');
      const file = fileInput.files[0];
      fileInput.value = ''; // 重选同一文件也必须触发 change。
      if (!file) return;
      if (file.size > Store.backupLimits.maxEncryptedBytes) { showError(node, '备份文件超过 8MB，未读取'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        if (!close.active()) return;
        const jsonText = String(reader.result);
        try {
          if (Store.isEncryptedBackup(jsonText)) {
            if (!Store.encryptionSupported()) { toast('这个浏览器不能打开加密备份，请换用最新版手机浏览器'); return; }
            openEncryptedRestore(jsonText, file.name);
          } else {
            const parsed = Store.parseBackup(jsonText);
            openRestorePreview(parsed, file.name);
          }
        } catch (e) { showError(node, '恢复失败：' + e.message); }
      };
      reader.onerror = () => { if (close.active()) showError(node, '文件没有读成功，请重新选择已下载到本机的备份文件'); };
      reader.readAsText(file);
    };
    node.querySelector('#set-reset').onclick = () => {
      if (confirm('确定清空全部数据？此操作无法恢复！')) {
        if (confirm('再次确认：血压记录、用药、训练打卡都会被删除。')) {
          if (!stored(Store.resetAll())) return;
          clearRecordSession();
          close();
          applyFont('normal');
          applyVoice('');
          render(currentView, { keepScroll: true });
          toast('已清空');
        }
      }
    };
    node.querySelector('#set-save').onclick = () => {
      /* 字号与语速不在这里读：它们点一下就已经落盘了（见上方 bindSegGroup）。
         若在此按 DOM 再赋一次值，任何时序差都会把已生效的偏好覆盖回旧值。 */
      const g = id => +node.querySelector(id).value;
      const bs = g('#set-bpsys'), bd = g('#set-bpdia'), gf = g('#set-glufast'), gp = g('#set-glupost');
      if (!(bs >= 60 && bs <= 260) || !(bd >= 30 && bd <= 200)) { showError(node, '请输入有效的血压目标值'); return; }
      if (bs <= bd) { showError(node, '高压目标应高于低压目标'); return; }
      if (!(gf >= 3 && gf <= 20) || !(gp >= 3 && gp <= 30)) { showError(node, '请输入有效的血糖目标值'); return; }
      const p2 = Store.data.profile;
      p2.name = node.querySelector('#set-name').value.trim();
      p2.strokeDate = node.querySelector('#set-stroke-date').value;
      p2.height = node.querySelector('#set-height').value;
      p2.targets = { bpSys: bs, bpDia: bd, gluFast: gf, gluPost: gp };
      if (!stored(Store.save())) return;
      close();
      render(currentView, { keepScroll: true, preserveInputs: true });
      toast('设置已保存');
    };
  }

  function applyFont(f) {
    if (f === 'large' || f === 'xlarge') document.documentElement.dataset.font = f;
    else delete document.documentElement.dataset.font;
  }
  /* 把存着的音色告诉朗读层。和 applyFont 一样，凡是整体换掉 data 的地方
     （启动、恢复备份、撤销恢复、清空）都要重新套一次，否则朗读还用着上一份数据的音色。
     机上没有这个音色时 Speech 内部静默回落，这里不需要判断。 */
  function applyVoice(name) {
    if (Speech.supported()) Speech.setVoice(name || '');
  }

  /* ============================================================
     【区】换更自然的朗读声音（图文引导）
     朗读"机器味"最有效的一招其实在手机系统里：多数手机能免费下载更自然的
     中文语音包，装一次长期可用。这里只教怎么找——不装任何东西、不联网、
     不碰第三方脚本（隐私红线）。系统菜单名各机型/版本不同，措辞留有余地，
     宁可让用户"搜一下"，也不给一个找不到的精确按钮名误导老人。 */
  function openVoiceGuide() {
    const node = nodeFromHTML(`
      <div class="guide">
        <p class="guide-sub">觉得声音生硬，多半是手机默认的声音不够好。很多手机里可以<b>免费下载更自然的中文声音</b>，装一次就一直能用。下面教您怎么找。</p>
        <div class="card">
          <div class="card-title">🍎 苹果手机（iPhone）</div>
          <div class="guide-line">大致这样找：<b>设置 → 辅助功能 → 朗读内容 → 声音 → 中文</b></div>
          <div class="guide-line">挑一个名字后面带「增强／高质量」的声音，点旁边的下载按钮，装好回到本应用就会更自然。</div>
          <div class="muted">不同 iOS 版本菜单名略有不同，找不到就在手机「设置」顶部搜索框里搜「朗读」。</div>
        </div>
        <div class="card">
          <div class="card-title">🤖 安卓手机</div>
          <div class="guide-line">大致这样找：在手机「设置」里搜<b>「文字转语音」</b>（有的在 系统 → 语言和输入 里）。</div>
          <div class="guide-line">打开「首选引擎／文字转语音输出」，选一个语音服务，再进去<b>下载／安装中文语音数据</b>，挑带「自然」字样的。</div>
          <div class="muted">各品牌（华为／小米／OPPO／vivo 等）菜单名不一样，找不到就搜「您的手机型号 + 文字转语音 下载中文」。</div>
        </div>
        <div class="card">
          <div class="card-title">💬 在微信里点了没声音？</div>
          <div class="guide-line">微信内置浏览器有时不出声。点微信右上角「···」→「在浏览器打开」，用手机<b>自带浏览器</b>打开本应用再试。</div>
        </div>
        <div class="guide-line" style="margin-top:0.3rem">换好声音后，回到「设置」，如果「朗读声音」里出现好几个，挑一个您听着最舒服的就行。</div>
        <div class="disclaimer">以上都是手机系统自带的功能。本应用<b>不会安装任何东西，也不联网</b>，只是用手机里已有的声音念给您听。</div>
        <button class="btn green block huge" id="voice-guide-done" style="margin-top:0.7rem">我知道了</button>
      </div>`);
    const close = openModal('换更自然的朗读声音', node, { center: true });
    node.querySelector('#voice-guide-done').onclick = close;
  }

  /* ============================================================
     【区】首次使用指引
     ============================================================ */
  function openGuide({ review = false } = {}) {
    const node = nodeFromHTML(`
      <div class="guide">
        <div class="guide-hero">🌱 欢迎使用<br>脑梗康复助手</div>
        <p class="guide-sub">帮脑梗恢复期的家人一起坚持康复。<br><b>所有数据只保存在这台设备</b>，不会上传到任何地方。</p>
        <div class="card">
          <div class="card-title">📋 每天先做这三件事</div>
          <div class="guide-step"><span class="gs-num">1</span><div><b>测血压</b><br><span class="muted">固定时间测量，「今日」页点「去记录」</span></div></div>
          <div class="guide-step"><span class="gs-num">2</span><div><b>按时服药</b><br><span class="muted">按医嘱吃完，在「用药」页点一下核对</span></div></div>
          <div class="guide-step"><span class="gs-num">3</span><div><b>康复训练</b><br><span class="muted">「训练」页按阶段选动作，做完点打卡</span></div></div>
        </div>
        <div class="card">
          <div class="card-title">🔧 还要会用</div>
          <div class="guide-line">📈 「记录」页：血压/血糖/体重，复诊时一键导出给医生</div>
          <div class="guide-line">📚 「知识」页：防复发科普；🚨 急救卡，疑似中风立即拨 120</div>
          <div class="guide-line">⚙️ 「设置」：填发病日期、身高，可调大字体</div>
        </div>
        <div class="card">
          <div class="card-title">🤝 用之前想说三句</div>
          <div class="guide-line">这里<b>不打分、不排名</b>。数字都由它替您算好，您只要照着做。</div>
          <div class="guide-line">中间<b>歇几天很正常</b>，回来做一个动作就又接上了。</div>
          <div class="guide-line">算数、说话、走路变难，都是<b>脑子在恢复中的常见情况</b>，不是您不行。认知练习里算不出来可以看提示、可以跳过、也可以换成不用算的。</div>
        </div>
        <div class="disclaimer">本应用是家庭康复辅助工具，不能替代医生的诊断和治疗。<br>训练前请经康复医生评估，身体不适立即停止并就医。</div>
        <button class="btn green block huge" id="guide-done" style="margin-top:0.7rem">${review ? '我知道了' : '我知道了，开始使用'}</button>
      </div>`);
    const close = openModal(review ? '使用指引' : '首次使用指引', node, { center: true });
    node.querySelector('#guide-done').onclick = () => {
      if (!review && !stored(Store.markGuideSeen())) return;
      close();
      if (!review) toast('可以开始了，按页面上的提示慢慢来');
    };
  }

  /* ============================================================
     【区】备份下载（隐私提醒 → 明文备份 / 密码加密备份）
     ============================================================ */
  function openBackupWarning() {
    const node = nodeFromHTML(`
      <div class="card">
        <div class="card-title">🔒 备份里有健康隐私</div>
        <div class="guide-line">备份文件包含称呼、用药、血压、血糖、体重和训练记录，内容是可以直接阅读的。</div>
        <div class="guide-line">请保存在自己的设备或可信位置，不要发到群聊，也不要交给无关人员。</div>
      </div>
      <div class="notice">
        <b>换手机或换网址时</b><br>先在这里下载备份并确认文件已保存，再到新网址的「设置 → 从备份恢复」选择这份文件。核对记录齐全后再使用新网址；旧网址的数据不会自动搬过去。
      </div>
      <button class="btn block" id="backup-plain">下载普通备份</button>
      ${Store.encryptionSupported() ? `
        <button class="btn outline block" id="backup-encrypted" style="margin-top:0.6rem">🔐 设置密码并加密</button>
        <div class="muted" style="margin-top:0.4rem">备份要放网盘或共享电脑时可选。应用不会保存密码，忘记后无法替您找回。</div>` : ''}`);
    const close = openModal('下载备份', node, { center: true });
    node.querySelector('#backup-plain').onclick = () => {
      try { downloadBackup(); close(); }
      catch (e) { showError(node, e.message || '没有生成备份，请重试'); }
    };
    const encrypted = node.querySelector('#backup-encrypted');
    if (encrypted) encrypted.onclick = () => close.replace(openEncryptedBackup);
  }

  function saveBackupFile(text, encrypted = false, label = '') {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `脑梗康复助手-${label || (encrypted ? '加密备份' : '备份')}-${Store.today()}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  function downloadBackup() {
    saveBackupFile(Store.exportBackup());
    toast('已发起备份下载，请到下载列表或「文件」中确认已保存');
  }

  function openEncryptedBackup() {
    const node = nodeFromHTML(`
      <div class="vital-form">
        <div class="muted" style="margin-bottom:0.7rem">密码只用于这份备份，不会保存或上传。以后恢复时必须输入完全相同的密码。</div>
        <div class="field" style="margin-bottom:0.7rem">
          <label for="backup-password">设置备份密码（至少 8 个字符）</label>
          <input id="backup-password" type="password" maxlength="200" autocomplete="new-password" placeholder="数字、字母或汉字都可以">
        </div>
        <div class="field">
          <label for="backup-password-again">再输入一次</label>
          <input id="backup-password-again" type="password" maxlength="200" autocomplete="new-password">
        </div>
        <label style="display:flex;align-items:center;gap:0.6rem;min-height:48px;margin:0.35rem 0">
          <input id="backup-password-show" type="checkbox" style="width:24px;height:24px">显示密码
        </label>
        <div id="backup-password-error" role="alert" style="min-height:1.6em;color:var(--red);font-weight:600"></div>
        <button class="btn block" id="backup-encrypt-confirm">加密并下载</button>
        <div class="disclaimer" style="margin-top:0.7rem">请使用只有本人或可信家人知道、但记得住的密码，并记在可信位置。忘记密码后本应用无法恢复；过于简单的密码仍可能被猜中。</div>
      </div>`);
    const close = openModal('密码加密备份', node, { center: true });
    const password = node.querySelector('#backup-password');
    const again = node.querySelector('#backup-password-again');
    const button = node.querySelector('#backup-encrypt-confirm');
    const error = node.querySelector('#backup-password-error');
    node.querySelector('#backup-password-show').onchange = e => {
      password.type = again.type = e.target.checked ? 'text' : 'password';
    };
    let encrypting = false;
    button.onclick = async () => {
      if (encrypting || !close.active()) return;
      if (password.value.length < 8) { error.textContent = '密码至少需要 8 个字符'; password.focus(); return; }
      if (password.value !== again.value) { error.textContent = '两次输入的密码不一样'; again.focus(); return; }
      button.disabled = true;
      encrypting = true;
      button.textContent = '正在加密，请稍候…';
      error.textContent = '';
      try {
        const text = await Store.exportEncryptedBackup(password.value);
        if (!close.active()) return;
        password.value = again.value = '';
        saveBackupFile(text, true);
        close();
        toast('已发起加密备份下载，请确认文件已保存，并保管好密码');
      } catch (e) {
        error.textContent = e.message || '没有生成加密备份';
      } finally {
        encrypting = false;
        if (!dismissPending) {
          button.disabled = false;
          button.textContent = '加密并下载';
        }
      }
    };
    setTimeout(() => { if (close.active()) password.focus(); }, 80);
  }

  /* ############################################################
     四、导航与初始化
     ############################################################ */
  const RENDERERS = {
    today: renderToday,
    train: renderTrain,
    records: renderRecords,
    meds: renderMeds,
    learn: renderLearn,
  };

  function render(view, { keepScroll = false, preserveInputs = false } = {}) {
    if (preserveInputs) captureRecordDraft();
    const details = keepScroll ? [...$view().querySelectorAll('details[id]')].map(el => [el.id, el.open]) : [];
    const focused = keepScroll ? document.activeElement : null;
    const focusSelector = focused?.id ? '#' + focused.id
      : focused?.dataset.stage ? `[data-stage="${focused.dataset.stage}"]` : null;
    const inputs = preserveInputs ? [...$view().querySelectorAll('input[id], select[id], textarea[id]')]
      .map(el => ({ id: el.id, value: el.value, checked: el.checked })) : [];
    const y = window.scrollY;
    (RENDERERS[view] || renderToday)();
    inputs.forEach(saved => {
      const el = document.getElementById(saved.id);
      if (el) { el.value = saved.value; el.checked = saved.checked; }
    });
    details.forEach(([id, open]) => { const el = document.getElementById(id); if (el) el.open = open; });
    if (focused && !focused.isConnected && focusSelector) document.querySelector(focusSelector)?.focus({ preventScroll: true });
    if (focused?.dataset.med && !focused.isConnected) {
      [...$view().querySelectorAll('[data-med][data-time]')]
        .find(el => el.dataset.med === focused.dataset.med && el.dataset.time === focused.dataset.time)?.focus({ preventScroll: true });
    }
    renderStorageNotice();
    /* 切页要回到顶部；但"数据变了重渲染"（打卡等）应该留在原处——
       否则在训练页往下翻着练，练完一个动作就被弹回页首。 */
    window.scrollTo(0, keepScroll ? y : 0);
  }

  function go(view) {
    if (topOverlay()) return;
    if (!RENDERERS[view]) view = 'today';
    if (view === currentView && $view().children.length) return;
    captureRecordDraft();
    Speech.stop();   // 切页停朗读，免得念着上一页的内容
    currentView = view;
    document.querySelectorAll('.nav-item').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
      if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    const url = new URL(location.href);
    url.searchParams.set('view', view);
    history.replaceState(history.state, '', url.href);
    render(view);
    document.title = { today: '今日', train: '康复训练', records: '健康记录', meds: '用药核对', learn: '康复知识' }[view] + ' · 脑梗康复助手';
    $view().querySelector('h1')?.focus({ preventScroll: true });
  }

  function init() {
    Store.load();
    applyFont(Store.data.profile.font);
    applyVoice(Store.data.profile.speechVoice);
    document.querySelectorAll('.nav-item').forEach(b => b.onclick = () => go(b.dataset.view));
    document.getElementById('btn-emergency').onclick = openEmergency;
    document.getElementById('btn-settings').onclick = openSettings;
    const urlView = new URLSearchParams(location.search).get('view');
    go(RENDERERS[urlView] ? urlView : 'today');

    /* 返回键与屏幕关闭统一在历史条目退掉后关闭浮层，保证 DOM 和历史状态同步。 */
    window.addEventListener('popstate', () => {
      dismissPending = false;
      closeTopOverlayDOM();
    });
    // 同一双击手势不能从刚关闭的子窗口穿透到父窗口的另一个操作。
    let clickSurface = null;
    document.addEventListener('click', e => {
      if (e.detail > 1 && clickSurface !== topOverlay()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      clickSurface = topOverlay();
      openingTrigger = e.target.closest('button, a, [role="button"]');
    }, true);
    /* 键盘：Esc 关浮层（家属用电脑帮着录数据时顺手） */
    document.addEventListener('keydown', e => {
      const top = topOverlay();
      if (!top) return;
      if (e.key === 'Escape') { e.preventDefault(); dismissTopOverlay(); }
      if (e.key === 'Tab') {
        const items = [...top.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
          .filter(el => el.tabIndex >= 0 && el.getClientRects().length);
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (!items.includes(document.activeElement) || document.activeElement === first)) {
          e.preventDefault(); last?.focus();
        } else if (!e.shiftKey && (!items.includes(document.activeElement) || document.activeElement === last)) {
          e.preventDefault(); first?.focus();
        }
      }
    });

    document.addEventListener('focusin', e => {
      const top = topOverlay();
      if (top && !top.contains(e.target)) top.querySelector('.m-title, .t-name').focus({ preventScroll: true });
    });
    if (!Store.guideSeen() && !Store.storageStatus()) openGuide();
  }

  return { init, go };
})();

document.addEventListener('DOMContentLoaded', App.init);
