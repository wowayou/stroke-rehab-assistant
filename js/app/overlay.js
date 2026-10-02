/* ============================================================
   浮层与返回键 + 弹窗底座（硬约定 10，回归：node test/overlay.test.js --stress）
   依赖 core.js；所有弹窗/训练页都经由这里的 openModal/overlayPush/mountOverlay。
   ============================================================ */

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
  const trigger = openingTrigger && openingTrigger.isConnected && (!topOverlay() || topOverlay().contains(openingTrigger))
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
  /* 浮层开着时攒下的"跨天/别处改过数据"，最后一层关掉后再重画 */
  if (!topOverlay() && refreshPending) refreshIfStale();
  if (topOverlay() && topOverlay()._onResume) topOverlay()._onResume();
  const target = returnFocusTarget(top._returnFocus);
  if (target && target.isConnected && !target.closest('[inert]')) target.focus({ preventScroll: true });
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
