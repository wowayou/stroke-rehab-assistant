/* ============================================================
   渲染与导航 + 跨天/跨页面重画 + 离线缓存注册 + 初始化（必须最后加载：
   RENDERERS 在加载时就要引用各页的 renderXxx）
   ============================================================ */

const RENDERERS = {
  today: renderToday,
  train: renderTrain,
  records: renderRecords,
  meds: renderMeds,
  learn: renderLearn,
};

/* ---------- 跨天与跨页面：页面不能停在"昨天"或"别处改之前" ----------
   手机浏览器切到后台并不会重新加载页面：晚上打开的用药页，第二天早上切回来，
   屏幕上还是昨天全打了勾的核对表——患者会以为今天已经吃过了。数据也一样：
   开了两个标签、或主屏图标和浏览器同时开着，一边记了，另一边还显示旧的，
   而且一保存就被冲突保护拦下。所以切回本页、拿到焦点、别的页面写过数据、
   以及开着时每分钟一次，都检查"日子换没换、数据换没换"，换了就重画。
   有浮层开着时先不动它（正在填的表单不能被冲掉），等浮层全关了再重画。 */
let renderedDay = '';
let refreshPending = false;
function refreshIfStale() {
  const synced = Store.reloadIfChanged();
  if (synced) {
    applyFont(Store.data.profile.font);
    applyVoice(Store.data.profile.speechVoice);
    settingsRevision++;
  }
  if (!synced && !refreshPending && Store.today() === renderedDay) return false;
  if (topOverlay()) { refreshPending = true; renderStorageNotice(); return true; }
  refreshPending = false;
  render(currentView, { keepScroll: true, preserveInputs: true });
  return true;
}

function render(view, { keepScroll = false, preserveInputs = false } = {}) {
  renderedDay = Store.today();
  if (preserveInputs) captureRecordDraft();
  const details = keepScroll ? [...$view().querySelectorAll('details[id]')].map(el => [el.id, el.open]) : [];
  const focused = keepScroll ? document.activeElement : null;
  const focusedData = (focused && focused.dataset) || {};
  const focusSelector = focused && focused.id ? '#' + focused.id
    : focusedData.stage ? `[data-stage="${focusedData.stage}"]` : null;
  const inputs = preserveInputs ? [...$view().querySelectorAll('input[id], select[id], textarea[id]')]
    .map(el => ({ id: el.id, value: el.value, checked: el.checked })) : [];
  const y = window.scrollY;
  (RENDERERS[view] || renderToday)();
  inputs.forEach(saved => {
    const el = document.getElementById(saved.id);
    if (el) { el.value = saved.value; el.checked = saved.checked; }
  });
  details.forEach(([id, open]) => { const el = document.getElementById(id); if (el) el.open = open; });
  const refocus = el => { if (el) el.focus({ preventScroll: true }); };
  if (focused && !focused.isConnected && focusSelector) refocus(document.querySelector(focusSelector));
  if (focusedData.med && !focused.isConnected) {
    refocus([...$view().querySelectorAll('[data-med][data-time]')]
      .find(el => el.dataset.med === focusedData.med && el.dataset.time === focusedData.time));
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
  const heading = $view().querySelector('h1');
  if (heading) heading.focus({ preventScroll: true });
}

/* ---------- 离线缓存与持久化存储（锦上添花：任何一步失败都静默，应用照常可用） ----------
   离线缓存只在线上 HTTPS 注册：file:// 双击打开本来就不需要；本地 http 预览若也注册，
   改了 js 刷新会拿到缓存里的旧文件（测试用 ?sw=1 显式打开）。sw.js 只缓存本站运行文件，
   不碰健康数据、不向别处发请求。 */
function registerOffline() {
  const want = location.protocol === 'https:' || new URLSearchParams(location.search).get('sw') === '1';
  if (want && 'serviceWorker' in navigator) {
    const reg = () => navigator.serviceWorker.register('sw.js').catch(() => {});
    if (document.readyState === 'complete') reg(); else window.addEventListener('load', reg, { once: true });
  }
  /* 请浏览器把本站存储标成"持久"：Safari 会清掉长期没打开的网站的 localStorage，
     安卓存储紧张时也可能清；持久化的不清。Safari/Chrome 按使用情况自行决定、不弹窗；
     Firefox 会弹一个老人看不懂的权限框，跳过。 */
  if (/^https?:$/.test(location.protocol) && navigator.storage && navigator.storage.persist && !/Firefox\//.test(navigator.userAgent)) {
    navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {});
  }
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

  /* 切回本页/拿到焦点/别的页面写过数据/开着时每分钟：检查跨天与数据同步（见 refreshIfStale） */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    refreshIfStale();
    Awake.poke();                                  // 浏览器在页面切走时释放了常亮，切回来再要
    const trainer = document.getElementById('trainer');
    if (trainer && trainer._tick) trainer._tick();  // 锁屏期间到点的计时，回来立刻报"时间到"
  });
  window.addEventListener('pageshow', e => { if (e.persisted) refreshIfStale(); });
  window.addEventListener('focus', () => refreshIfStale());
  window.addEventListener('storage', () => refreshIfStale());
  setInterval(() => { if (document.visibilityState === 'visible') refreshIfStale(); }, 60000);

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
        e.preventDefault(); if (last) last.focus();
      } else if (!e.shiftKey && (!items.includes(document.activeElement) || document.activeElement === last)) {
        e.preventDefault(); if (first) first.focus();
      }
    }
  });

  document.addEventListener('focusin', e => {
    const top = topOverlay();
    if (top && !top.contains(e.target)) top.querySelector('.m-title, .t-name').focus({ preventScroll: true });
  });
  if (!Store.guideSeen() && !Store.storageStatus()) openGuide();
  registerOffline();
}

const App = { init, go };

document.addEventListener('DOMContentLoaded', App.init);
