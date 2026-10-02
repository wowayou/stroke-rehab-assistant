/* 真实 Chromium 回归：备份弹窗的关闭与切换不能让应用离开当前页面。 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..');
const cliArgs = process.argv.slice(2);
const stressMode = cliArgs.includes('--stress');
const appBase = cliArgs.find(arg => !arg.startsWith('--')) || pathToFileURL(path.join(root, 'index.html')).href;
const remoteTimeout = /^https?:/.test(appBase) ? 20000 : 5000;

function caseURL(name) {
  const url = new URL(appBase);
  url.searchParams.set('view', 'today');
  url.searchParams.set('case', name);
  return url.href;
}

function chromiumBinary() {
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  const versions = fs.readdirSync(cache)
    .filter(name => name.startsWith('chromium_headless_shell-'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!versions.length) throw new Error('未找到 Playwright Chromium，请先安装 Chromium');
  return path.join(cache, versions.at(-1), 'chrome-headless-shell-linux64', 'chrome-headless-shell');
}

class CDP {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error('无法连接 Chromium DevTools'));
    });
    this.ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        this.events.push(message);
        if (message.method === 'Page.javascriptDialogOpening') this.send('Page.handleJavaScriptDialog', { accept: false });
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    };
    this.ws.onclose = () => {
      const error = new Error('Chromium DevTools 连接意外关闭');
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
    };
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chromium DevTools 命令超时：${method}`));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.ws.send(JSON.stringify({ id, method, params }));
    return result;
  }

  async eval(expression) {
    const out = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (out.exceptionDetails) {
      throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text);
    }
    return out.result.value;
  }

  close() { this.ws.close(); }
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(cdp, expression, label, timeout = 5000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      if (await cdp.eval(`Boolean(${expression})`)) return;
    } catch (error) { lastError = error; }
    await delay(25);
  }
  throw new Error(`${label}超时${lastError ? `：${lastError.message}` : ''}`);
}

// 通过 Chromium DevTools Protocol（浏览器调试协议）发送真实按键，包含浏览器默认的 Tab/回车行为。
async function pressKey(cdp, key, shift = false) {
  const keyCode = { Tab: 9, Enter: 13, Escape: 27 }[key];
  assert(keyCode, `未支持的测试按键：${key}`);
  const params = { key, code: key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers: shift ? 8 : 0 };
  await cdp.send('Input.dispatchKeyEvent', { ...params, type: key === 'Enter' ? 'keyDown' : 'rawKeyDown', ...(key === 'Enter' ? { text: '\r' } : {}) });
  await cdp.send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' });
}

async function click(cdp, selector) {
  await cdp.eval("Promise.all(document.getAnimations().filter(a => a.effect?.target?.matches('.modal-mask, .modal-panel, .trainer')).map(a => a.finished.catch(() => {}))).then(() => true)");
  if (selector === '.modal-close') selector = '.modal-mask:not([inert]) .modal-close';
  const point = await cdp.eval(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    if (!element.closest('.app-header')) element.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`找不到待点击元素：${selector}`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
}

async function rapidDoubleClick(cdp, selector) {
  const point = await cdp.eval(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    if (!element.closest('.app-header')) element.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`找不到待双击元素：${selector}`);
  for (let i = 0; i < 2; i++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: i + 1, ...point });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: i + 1, ...point });
  }
}

async function clickAndWait(cdp, selector, expression, label) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    await click(cdp, selector);
    try {
      await waitFor(cdp, expression, label, 1800);
      return;
    } catch (error) {
      lastError = error;
      await delay(180);
    }
  }
  throw lastError;
}

async function launch() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rehab-overlay-'));
  const firstURL = caseURL('boot');
  const args = [
    '--headless', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, `--download-default-directory=${profile}`, firstURL,
  ];
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (/^https?:/.test(appBase) && proxy) {
    args.splice(-1, 0, `--proxy-server=${proxy}`, '--ignore-certificate-errors');
  }
  const browser = spawn(chromiumBinary(), args, { stdio: ['ignore', 'ignore', 'pipe'] });

  let stderr = '';
  const browserURL = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chromium 启动超时\n${stderr}`)), 15000);
    browser.stderr.on('data', chunk => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    browser.once('exit', code => reject(new Error(`Chromium 提前退出：${code}\n${stderr}`)));
  });
  const port = new URL(browserURL).port;
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    const list = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
    target = list.find(item => item.type === 'page');
    if (!target) await delay(25);
  }
  if (!target) throw new Error('没有找到 Chromium 页面目标');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: firstURL });
  await waitFor(cdp, "document.readyState === 'complete' && typeof App !== 'undefined'", '应用启动', remoteTimeout);
  if (await cdp.eval("Boolean(document.querySelector('#guide-done'))")) {
    await delay(280);
    await click(cdp, '#guide-done');
    await waitFor(cdp, "!document.querySelector('.modal-mask')", '关闭首次指引');
  }
  return { browser, cdp, profile };
}

async function prepare(cdp, name) {
  const url = caseURL(name);
  await cdp.send('Page.navigate', { url });
  await waitFor(cdp, `document.readyState === 'complete' && location.href === ${JSON.stringify(url)} && typeof App !== 'undefined'`, `${name} 页面加载`, remoteTimeout);
  await delay(180);
  await openBackup(cdp, name);
  return url;
}

async function openBackup(cdp, name) {
  await clickAndWait(cdp, '#btn-settings', "document.querySelector('#set-backup')", `${name} 设置弹窗`);
  await delay(280);
  const settingsHistoryLength = await cdp.eval('history.length');
  await clickAndWait(cdp, '#set-backup', "document.querySelector('#backup-plain')", `${name} 备份提醒`);
  await delay(280);
  assert.strictEqual(await cdp.eval('history.length'), settingsHistoryLength + 1, `${name} 设置的子任务应有独立返回条目`);
  return settingsHistoryLength + 1;
}

async function assertAppAlive(cdp, expectedURL, label, expectedModal = '设置') {
  await delay(350);
  const state = await cdp.eval(`({
    url: location.href,
    title: document.querySelector('.modal-mask:not([inert]) .m-title')?.textContent || '',
    modals: document.querySelectorAll('.modal-mask').length,
    app: Boolean(document.querySelector('#view') && document.querySelector('#btn-settings')),
    historyLength: history.length,
    historyState: history.state,
  })`);
  const detail = JSON.stringify(state);
  assert.strictEqual(state.url, expectedURL, `${label}后 URL 不应变化：${detail}`);
  assert(state.app, `${label}后主应用应仍可用：${detail}`);
  assert.strictEqual(state.modals, expectedModal === '设置' ? 1 : expectedModal ? 2 : 0, `${label}后浮层数量错误：${detail}`);
  if (expectedModal) {
    assert.strictEqual(state.title, expectedModal, `${label}后弹窗错误`);
    assert(state.historyState?.rehabOverlay, `${label}后应保留一个浮层历史状态`);
  }
  else assert(!state.historyState?.rehabOverlay, `${label}后不应残留浮层历史状态`);
  if (expectedModal === '设置') {
    await clickAndWait(cdp, '.modal-close', "!document.querySelector('.modal-mask')", '关闭父级设置');
  }
  if (!expectedModal || expectedModal === '设置') {
    await click(cdp, '[data-view="records"]');
    await waitFor(cdp, "document.querySelector('#view')?.textContent.includes('记一次血压')", `${label}后主导航`);
  }
}

async function runOverlayStress(cdp) {
  const cycles = 40;
  console.log(`开始备份浮层压力回归：${cycles} 轮`);
  const url = caseURL('stress');
  await cdp.send('Page.navigate', { url });
  await waitFor(cdp, `document.readyState === 'complete' && location.href === ${JSON.stringify(url)} && typeof App !== 'undefined'`, '压力页加载', remoteTimeout);
  await delay(180);
  const initialLength = await cdp.eval('history.length');
  let stableLength = null;

  for (let i = 0; i < cycles; i++) {
    const label = `压力循环 ${i + 1}`;
    const overlayLength = await openBackup(cdp, label);
    if (i % 4 === 0) {
      await clickAndWait(cdp, '#backup-plain', "document.querySelectorAll('.modal-mask').length === 1 && document.querySelector('#set-save') && !document.querySelector('#set-save').closest('[inert]')", `${label} 普通备份`);
    } else if (i % 4 === 1) {
      await clickAndWait(cdp, '.modal-close', "document.querySelectorAll('.modal-mask').length === 1 && document.querySelector('#set-save') && !document.querySelector('#set-save').closest('[inert]')", `${label} 关闭`);
    } else {
      await clickAndWait(cdp, '#backup-encrypted', "document.querySelector('#backup-password')", `${label} 进入加密`);
      assert.strictEqual(await cdp.eval('history.length'), overlayLength, `${label} 加密弹窗不应增加历史条目`);
      await clickAndWait(cdp, '.modal-close', "document.querySelectorAll('.modal-mask').length === 1 && document.querySelector('#set-save') && !document.querySelector('#set-save').closest('[inert]')", `${label} 关闭加密`);
    }

    await clickAndWait(cdp, '.modal-close', "!document.querySelector('.modal-mask')", '压力循环关闭父级设置');
    const state = await cdp.eval(`({
      url: location.href,
      modals: document.querySelectorAll('.modal-mask').length,
      app: Boolean(document.querySelector('#view') && document.querySelector('#btn-settings')),
      historyLength: history.length,
      historyState: history.state,
    })`);
    assert.strictEqual(state.url, url, `${label} 后 URL 变化`);
    assert(state.app && state.modals === 0, `${label} 后应用或浮层状态异常`);
    assert(!state.historyState?.rehabOverlay, `${label} 后残留浮层历史状态`);
    if (stableLength === null) stableLength = state.historyLength;
    else assert.strictEqual(state.historyLength, stableLength, `${label} 后历史长度继续增长`);
    assert(state.historyLength <= initialLength + 2, `${label} 后历史栈超出两个浮层条目`);
    if ((i + 1) % 10 === 0) console.log(`PASS  压力循环 ${i + 1}/${cycles}`);
  }

  console.log(`PASS  连续 ${cycles} 轮备份浮层开关，历史栈未增长、页面未离开`);

  await cdp.eval(`(() => {
    window.__backupDownloadCount = 0;
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && this.download.includes('备份')) window.__backupDownloadCount++;
      return original.call(this);
    };
  })()`);
  await openBackup(cdp, '快速双击');
  await rapidDoubleClick(cdp, '#backup-plain');
  await waitFor(cdp, "document.querySelectorAll('.modal-mask').length === 1 && document.querySelector('#set-save') && !document.querySelector('#set-save').closest('[inert]')", '快速双击后关闭');
  assert.strictEqual(cdp.events.filter(e => e.method === 'Page.javascriptDialogOpening').length, 0, '双击不得穿透触发父窗口的清空确认');
  assert.strictEqual(await cdp.eval('window.__backupDownloadCount'), 1, '快速双击普通备份只能触发一次下载');
  assert.strictEqual(await cdp.eval('location.href'), url, '快速双击后 URL 不应变化');
  console.log('PASS  快速双击普通备份只下载一次，页面仍可用');
}

async function closeAll(cdp) {
  while (await cdp.eval("Boolean(document.querySelector('.modal-mask, #trainer'))")) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    await delay(100);
  }
}

async function runUXRegression(cdp) {
  await closeAll(cdp);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  // 打卡/保存重建了背景列表，返回位置必须跟随同一条目，而不是失效的旧节点。
  await cdp.eval("App.go('train')");
  const exercise = await cdp.eval("document.querySelector('[data-ex]').dataset.ex");
  await click(cdp, `[data-ex="${exercise}"]`);
  const originY = await cdp.eval('scrollY');
  await click(cdp, '#trainer-done');
  await waitFor(cdp, "!document.querySelector('#trainer')", '训练打卡返回');
  assert.strictEqual(await cdp.eval('document.activeElement.dataset.ex'), exercise, '打卡后焦点回同一个训练动作');
  assert(await cdp.eval(`Store.exercisesDoneToday().includes(${JSON.stringify(exercise)})`), '打卡已持久化');
  assert(await cdp.eval(`Math.abs(scrollY - ${originY}) <= 2`), '打卡返回不改变原列表位置');

  await cdp.eval("Store.addMed({ name: '回归用药物', dose: '按医嘱', times: ['08:00'], from: Store.today() }); App.go('meds');");
  const med = await cdp.eval("document.querySelector('[data-edit-med]').dataset.editMed");
  await click(cdp, `[data-edit-med="${med}"]`);
  await cdp.eval("document.querySelector('#med-note').value = '回归备注'");
  await click(cdp, '#med-save');
  await waitFor(cdp, "!document.querySelector('.modal-mask')", '药物修改返回');
  assert.strictEqual(await cdp.eval('document.activeElement.dataset.editMed'), med, '保存后焦点回同一药物');
  assert.strictEqual(await cdp.eval(`Store.data.meds.find(m => m.id === ${JSON.stringify(med)}).note`), '回归备注');
  console.log('PASS  训练打卡与药物修改后，焦点回重建列表的原条目');

  // 响应式只改变布局；跨断点和打开浮层不能重建输入或挪动底下页面。
  await cdp.eval("App.go('records'); document.querySelector('#bp-sys').value = '136'; window.__recordInput = document.querySelector('#bp-sys');");
  for (const width of [1280, 1024, 768, 390]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 1024 });
    assert(await cdp.eval("document.querySelector('#bp-sys') === window.__recordInput && window.__recordInput.value === '136'"), `${width} 改宽度不丢输入与节点`);
    const beforeX = await cdp.eval("document.querySelector('#view').getBoundingClientRect().x");
    await click(cdp, '#btn-settings');
    assert(await cdp.eval(`Math.abs(document.querySelector('#view').getBoundingClientRect().x - ${beforeX}) <= 2`), `${width} 弹窗打开不横向晃动`);
    await closeAll(cdp);
  }
  console.log('PASS  手机/桌面切换保留输入，浮层打开页面位置稳定');
  for (const view of ['today', 'train', 'records', 'meds', 'learn']) {
    await cdp.eval(`App.go('${view}')`);
    for (const exit of ['done', 'close', 'escape', 'back', 'mask']) {
      await cdp.eval(`window.scrollTo(0, 170); window.__mainNode = document.querySelector('#view').firstElementChild; window.__mainY = scrollY;`);
      const originalURL = await cdp.eval('location.href');
      await click(cdp, '#btn-settings');
      await delay(260);
      await cdp.eval("document.querySelector('#set-name').value = '尚未保存的称呼'");
      await cdp.eval("document.querySelector('#set-guide').addEventListener('click', () => document.activeElement.blur(), { once: true, capture: true })");
      await click(cdp, '#set-guide');
      await delay(260);
      const parentY = await cdp.eval("document.querySelector('#set-name').closest('.modal-panel').scrollTop");
      if (exit === 'done') await click(cdp, '#guide-done');
      if (exit === 'close') await click(cdp, '.modal-close');
      if (exit === 'escape') await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape' });
      if (exit === 'back') await cdp.eval('history.back()');
      if (exit === 'mask') {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: 2, y: 2 });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: 2, y: 2 });
      }
      await waitFor(cdp, "document.querySelectorAll('.modal-mask').length === 1", `${view}/${exit} 回到设置`);
      const result = await cdp.eval(`({
        name: document.querySelector('#set-name').value,
        unchanged: window.__mainNode === document.querySelector('#view').firstElementChild,
        parentY: document.querySelector('#set-name').closest('.modal-panel').scrollTop,
        focus: document.activeElement.id,
        active: document.querySelector('.nav-item.active').dataset.view,
        current: document.querySelector('[aria-current="page"]').dataset.view,
      })`);
      assert.strictEqual(result.name, '尚未保存的称呼', `${view}/${exit} 保留设置草稿`);
      assert(result.unchanged, `${view}/${exit} 不重建主页面`);
      assert(Math.abs(result.parentY - parentY) <= 2, `${view}/${exit} 保留设置滚动位置`);
      assert.strictEqual(result.focus, 'set-guide', `${view}/${exit} 焦点回原按钮`);
      assert.strictEqual(result.active, view);
      assert.strictEqual(result.current, view);
      await click(cdp, '.modal-close');
      await waitFor(cdp, "!document.querySelector('.modal-mask')", '关闭设置');
      assert.strictEqual(await cdp.eval('location.href'), originalURL, '关闭不跳转');
      assert(await cdp.eval('Math.abs(scrollY - window.__mainY) <= 2'), '保留主页面滚动位置');
    }
  }
  console.log('PASS  五页 × 五种指引退出方式，原页、草稿、滚动和焦点保留');

  await cdp.eval("App.go('records'); document.querySelector('#bp-sys').value = '137';");
  await click(cdp, '#btn-settings');
  await delay(260);
  const oldName = await cdp.eval('Store.data.profile.name');
  await cdp.eval("document.querySelector('#set-name').value = '校验未过'; document.querySelector('#set-bpsys').value = '10';");
  await click(cdp, '#set-save');
  assert.strictEqual(await cdp.eval('Store.data.profile.name'), oldName, '设置校验失败前不修改 Store');
  await click(cdp, '[data-seg="font"][data-seg-key="large"]');
  assert.strictEqual(await cdp.eval("JSON.parse(localStorage.getItem('strokeRehab.v1')).profile.name"), oldName, '即时偏好不能把失败表单顺带写盘');
  await cdp.eval("document.querySelector('#set-bpsys').value = '140';");
  await click(cdp, '#set-save');
  await waitFor(cdp, "!document.querySelector('.modal-mask')", '保存合法设置');
  assert.strictEqual(await cdp.eval("document.querySelector('#bp-sys').value"), '137', '保存设置不丢底下血压草稿');
  console.log('PASS  先校验后写入、保存设置保留底下记录草稿');
  await cdp.eval(`document.querySelector('#bp-dia').value = '85';
    window.__setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function() { throw new DOMException('测试写入失败', 'QuotaExceededError'); };`);
  await click(cdp, '#bp-save');
  assert.strictEqual(await cdp.eval("document.querySelector('#bp-sys').value"), '137', '保存失败保留血压输入');
  assert(await cdp.eval("Boolean(document.querySelector('.save-feedback')) && !document.querySelector('#storage-notice').hidden"), '保存失败持续显示而非短暂提示');
  await cdp.eval('Storage.prototype.setItem = window.__setItem;');
  await click(cdp, '#bp-save');
  assert.strictEqual(await cdp.eval('Store.data.vitals.bp.at(-1).sys'), 137, '权限恢复后原表单可重试保存');
  console.log('PASS  存储写入失败保留表单，恢复后可重试');

  await click(cdp, '#btn-settings');
  await delay(260);
  await click(cdp, '#set-backup');
  await delay(260);
  await click(cdp, '#backup-encrypted');
  await delay(260);
  await cdp.eval(`window.__downloadAfterCancel = 0;
    window.__originalAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() { window.__downloadAfterCancel++; };
    window.__originalEncrypt = Store.exportEncryptedBackup;
    Store.exportEncryptedBackup = () => new Promise(resolve => { window.__finishEncryption = resolve; });
    document.querySelector('#backup-password').value = '可信家人密码2026';
    document.querySelector('#backup-password-again').value = '可信家人密码2026';`);
  await click(cdp, '#backup-encrypt-confirm');
  await click(cdp, '.modal-close');
  await waitFor(cdp, "!document.querySelector('#backup-password')", '取消加密');
  await cdp.eval("window.__finishEncryption('{}')");
  await delay(50);
  assert.strictEqual(await cdp.eval('window.__downloadAfterCancel'), 0, '取消后加密结果不能触发下载');
  await cdp.eval('Store.exportEncryptedBackup = window.__originalEncrypt; HTMLAnchorElement.prototype.click = window.__originalAnchorClick;');

  await cdp.eval(`window.__restoreText = Store.exportBackup();
    const incoming = JSON.parse(window.__restoreText);
    incoming.data.profile.name = '迁移核对';
    incoming.data.profile.font = 'xlarge';
    window.__restoreText = JSON.stringify(incoming);
    window.__pickBackup = () => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([window.__restoreText], '迁移备份.json', { type: 'application/json' }));
      const input = document.querySelector('#set-restore-input');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change'));
    }; window.__pickBackup();`);
  await waitFor(cdp, "document.querySelector('#restore-confirm')", '恢复预览');
  await click(cdp, '.modal-close');
  await waitFor(cdp, "!document.querySelector('#restore-confirm')", '取消恢复');
  assert.strictEqual(await cdp.eval("document.querySelector('#set-restore-input').value"), '', '选择后清空文件输入，允许重选同一文件');
  await cdp.eval('window.__pickBackup()');
  await waitFor(cdp, "document.querySelector('#restore-confirm')", '重选恢复预览');
  await click(cdp, '#restore-confirm');
  await waitFor(cdp, "document.querySelector('#set-name')?.value === '迁移核对'", '恢复后设置从新数据重建');
  assert(await cdp.eval("Boolean(document.querySelector('#set-undo-restore'))"), '恢复成功后可撤销');
  assert.strictEqual(await cdp.eval('document.querySelectorAll(".modal-mask").length'), 1, '恢复后只保留一个设置窗口');
  await closeAll(cdp);
  console.log('PASS  加密取消无下载、同文件重选、恢复预览取消与设置更新');

  // 对实际 UI 做布局审计，不实际拨打急救电话。
  for (const width of [320, 360, 390, 768, 1024, 1280]) for (const font of ['normal', 'large', 'xlarge']) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.eval(`document.documentElement.dataset.font = '${font}'`);
    for (const view of ['today', 'train', 'records', 'meds', 'learn']) {
      await cdp.eval(`App.go('${view}')`);
      assert(await cdp.eval('document.documentElement.scrollWidth <= innerWidth'), `${width}/${font}/${view} 无横向滚动`);
      const smallControls = await cdp.eval(`Array.from(document.querySelectorAll('#view button, #view [role="button"], #view [role="checkbox"], .nav-item, .header-actions button'))
        .filter(el => el.getClientRects().length && !el.closest('details:not([open]) .disclosure-body'))
        .filter(el => { const r = el.getBoundingClientRect(); return r.width < 48 || r.height < 48; })
        .map(el => el.textContent.trim())`);
      assert.deepStrictEqual(smallControls, [], `${width}/${font}/${view} 可见控件触控面积至少 48px`);
      assert(await cdp.eval(`Array.from(document.querySelectorAll('.ci-name')).every(el =>
        el.getBoundingClientRect().height <= parseFloat(getComputedStyle(el).lineHeight) + 1
      )`), `${width}/${font}/${view} 今日任务名不被按钮挤成窄列`);
      assert(await cdp.eval(`Array.from(document.querySelectorAll('.nav-item')).every(el => {
        const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
      })`), `${width}/${font}/${view} 五个导航入口均在首屏`);
    }
    await click(cdp, '#btn-settings');
    await delay(260);
    assert(await cdp.eval("document.querySelector('.modal-panel').scrollWidth <= document.querySelector('.modal-panel').clientWidth"), `${width}/${font} 设置不溢出`);
    await click(cdp, '.modal-mask:not([inert]) .btn-emergency');
    await delay(260);
    assert(await cdp.eval(`(() => { const a = document.querySelector('.call-120'), r = a.getBoundingClientRect(); return a.getAttribute('href') === 'tel:120' && r.top >= 0 && r.bottom <= innerHeight && r.width >= 48 && r.height >= 48; })()`), `${width}/${font} 急救首屏可见可点`);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab' });
    assert(await cdp.eval("Boolean(document.activeElement.closest('.modal-mask:not([inert])'))"), '焦点限制在急救层');
    if (cliArgs.includes('--screenshots') && width === 390 && font === 'xlarge') {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync('/tmp/rehab-emergency.png', Buffer.from(shot.data, 'base64'));
    }
    await closeAll(cdp);
  }
  await cdp.eval("document.documentElement.dataset.font = 'normal'; App.go('train')");
  const timerEx = await cdp.eval("EXERCISES.find(e => e.mode.type === 'timer' && document.querySelector('[data-ex=\"' + e.id + '\"]'))?.id");
  assert(timerEx, '当前训练列表有计时动作');
  await click(cdp, `[data-ex="${timerEx}"]`);
  await delay(260);
  await click(cdp, '#timer-toggle');
  await click(cdp, '#trainer-emergency');
  const time = await cdp.eval("document.querySelector('#timer-num').textContent");
  await delay(1100);
  assert.strictEqual(await cdp.eval("document.querySelector('#timer-num').textContent"), time, '急救覆盖时训练计时暂停');
  await click(cdp, '.modal-close');
  await waitFor(cdp, "!document.querySelector('.emergency-view')", '急救返回训练');
  assert(await cdp.eval("Boolean(document.querySelector('#trainer')) && document.activeElement.id === 'trainer-emergency'"), '急救只关闭自己并返回训练');
  await closeAll(cdp);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await click(cdp, '#btn-settings');
  assert(await cdp.eval("parseFloat(getComputedStyle(document.querySelector('.modal-panel')).animationDuration) <= 0.001"), '系统减少动画时不播放浮层滑动');
  await closeAll(cdp);
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  console.log('PASS  90 组页面布局与触控、18 组设置/急救布局、焦点边界、训练急救暂停、减少动画');
  if (cliArgs.includes('--screenshots')) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    for (const view of ['today', 'train', 'records']) {
      await cdp.eval(`App.go('${view}')`);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`/tmp/rehab-${view}.png`, Buffer.from(shot.data, 'base64'));
    }
    await cdp.eval("Store.data.profile.font = 'normal'; Store.save();");
    await click(cdp, '#btn-settings');
    await delay(260);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('/tmp/rehab-settings.png', Buffer.from(shot.data, 'base64'));
    await closeAll(cdp);
  }
}

async function runBackfillRegression(cdp) {
  await closeAll(cdp);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

  // 1. 服药历史补记
  const seed = await cdp.eval(`(() => {
    localStorage.removeItem('strokeRehab.recovery.v1');
    localStorage.removeItem('strokeRehab.v1');
    Store.load();
    Store.addMed({ name: '补记回归药', dose: 'x', times: ['08:00', '20:00'] });
    const m = Store.data.meds[0];
    m.from = Store.addDays(Store.today(), -60);
    m.trackFrom = Store.addDays(Store.today(), -10);
    const qian = Store.addDays(Store.today(), -2);
    for (let i = 0; i <= 10; i++) {
      const d = Store.addDays(Store.today(), -i);
      if (d === qian) continue;
      Store.data.medLog[d] = { [m.id + '@08:00']: true, [m.id + '@20:00']: true };
    }
    Store.save();
    return { qian, d13: Store.addDays(Store.today(), -13) };
  })()`);
  await cdp.eval("App.go('meds')");
  const medHistURL = await cdp.eval('location.href');
  await clickAndWait(cdp, '#btn-med-hist', `document.querySelector('#med-day-${seed.qian}')`, '服药历史打开');
  await clickAndWait(cdp, `#med-day-${seed.qian}`, "document.querySelector('.modal-mask:not([inert]) .med-check')", '打开补记子弹窗');
  await click(cdp, '.modal-mask:not([inert]) .med-check');
  await delay(180);
  assert(await cdp.eval(`Store.medStatusOn('${seed.qian}').done >= 1`), '补记后 Store 已记该次');
  await cdp.eval('history.back()');
  await waitFor(cdp, "document.querySelectorAll('.modal-mask').length === 1", '返回只关子弹窗');
  assert.strictEqual(await cdp.eval('location.href'), medHistURL, '补记返回后 URL 不变');
  assert(await cdp.eval(`document.querySelector('#med-day-${seed.qian}').textContent.includes('1 次没记上')`), '前天行显示 1 次没记上');
  assert.strictEqual(await cdp.eval('document.activeElement.id'), `med-day-${seed.qian}`, '焦点回前天那一行');
  await clickAndWait(cdp, `#med-day-${seed.qian}`, "document.querySelector('#med-day-all')", '再次打开补记');
  await click(cdp, '#med-day-all');
  await waitFor(cdp, "document.querySelectorAll('.modal-mask').length === 1", '这天的都吃了后关子弹窗');
  assert(await cdp.eval(`document.querySelector('#med-day-${seed.qian}').textContent.includes('全吃到')`), '一键补齐后前天行全吃到');
  assert.strictEqual(await cdp.eval(`document.querySelector('#med-day-${seed.d13}')`), null, '登记前的日子不是可点按钮');
  assert(await cdp.eval(`[...document.querySelectorAll('.day-row')].some(r => r.textContent.includes('登记前'))`), '登记前的日子显示“登记前”');
  await closeAll(cdp);
  console.log('PASS  服药历史补记：即时生效、返回只关子弹窗、焦点回原行、登记前不可点');

  // 1b. F3：服药历史跨天重画，昨天那行不再标 ·今天（AC3.1）
  await cdp.eval("App.go('meds')");
  const f3Today = await cdp.eval('Store.today()');
  await clickAndWait(cdp, '#btn-med-hist', `document.querySelector('#med-day-${f3Today}')`, 'AC3.1 服药历史打开');
  assert(await cdp.eval(`document.querySelector('#med-day-${f3Today}').textContent.includes('·今天')`), 'AC3.1 打开时今天那行标 ·今天');
  /* 跨天：整个页面的 today() 都基于 new Date()，内部调用摸不到 Store.today 覆写，故直接 mock Date。 */
  await cdp.eval(`(() => {
    window.__RealDate = Date;
    const tmr = Store.addDays(Store.today(), 1) + 'T12:00:00';
    window.Date = class extends window.__RealDate {
      constructor(...a) { super(...(a.length ? a : [tmr])); }
      static now() { return new window.__RealDate(tmr).getTime(); }
    };
  })()`);
  const f3Tomorrow = await cdp.eval('Store.today()');
  await cdp.eval("document.querySelector('.modal-mask:not([inert])')._onResume();");
  await delay(120);
  assert(await cdp.eval(`!document.querySelector('#med-day-${f3Today}') || !document.querySelector('#med-day-${f3Today}').textContent.includes('·今天')`), 'AC3.1 跨天后原今天行不再标 ·今天');
  assert(await cdp.eval(`Boolean(document.querySelector('#med-day-${f3Tomorrow}')) && document.querySelector('#med-day-${f3Tomorrow}').textContent.includes('·今天')`), 'AC3.1 跨天后由新的今天那行标 ·今天');
  await cdp.eval('window.Date = window.__RealDate;');
  await closeAll(cdp);
  console.log('PASS  服药历史跨天重画，·今天 跟随新的今天（F3）');

  // 1c. P2#1：真实 Tab 到达撤销、双向循环、回车只回退新勾项（AC4.3）。
  const undoDay = await cdp.eval(`(() => {
    localStorage.removeItem('strokeRehab.recovery.v1');
    localStorage.removeItem('strokeRehab.v1');
    Store.load();
    Store.addMed({ name: '撤销回归药', times: ['08:00', '12:00', '20:00'] });
    const m = Store.data.meds[0];
    m.from = Store.addDays(Store.today(), -10);
    m.trackFrom = Store.addDays(Store.today(), -10);
    const y = Store.addDays(Store.today(), -1);
    Store.data.medLog[y] = { [m.id + '@08:00']: true };   // 已核对 08:00（非补记）
    Store.save();
    return y;
  })()`);
  await cdp.eval("App.go('meds')");
  await clickAndWait(cdp, '#btn-med-hist', `document.querySelector('#med-day-${undoDay}')`, 'AC4.3 服药历史打开');
  const onUndo = "document.activeElement === document.querySelector('#toast .toast-action')";
  const onHistoryTitle = "document.activeElement === document.querySelector('.modal-mask:not([inert]) .m-title')";
  async function checkAllAndTabToUndo(day, label) {
    await clickAndWait(cdp, `#med-day-${day}`, "document.querySelector('#med-day-all:not([hidden])')", `${label} 打开补记子弹窗`);
    await click(cdp, '#med-day-all');
    await waitFor(cdp, "document.querySelector('#toast.show .toast-action') && document.querySelectorAll('.modal-mask').length === 1", `${label} 提示出现且子弹窗关闭`);
    assert.strictEqual(await cdp.eval('document.activeElement.id'), `med-day-${day}`, `${label} 焦点自动回到日期行`);
    for (let i = 0; i < 40; i++) {
      await pressKey(cdp, 'Tab');
      if (await cdp.eval(onUndo)) return;
    }
    assert.fail(`${label} 从日期行按 40 次真实 Tab 仍到不了撤销键`);
  }
  await checkAllAndTabToUndo(undoDay, 'AC4.3');
  assert(await cdp.eval(`Store.medStatusOn('${undoDay}').done === 3`), 'AC4.3 一键补齐后当天全核对');
  assert(await cdp.eval(`Object.keys(Store.data.medLate['${undoDay}'] || {}).length === 2`), 'AC4.3 只把新勾的 2 项记为补记');
  const undoBtnRect = await cdp.eval(`(() => { const r = document.querySelector('#toast .toast-action').getBoundingClientRect(); return r.width >= 48 && r.height >= 48; })()`);
  assert(undoBtnRect, 'AC4.3 撤销按钮 ≥48px');
  await pressKey(cdp, 'Tab');
  assert(await cdp.eval("document.activeElement === document.querySelector('.modal-mask:not([inert]) .btn-emergency')"), 'AC4.3 撤销键 Tab 回到历史弹窗急救键');
  await pressKey(cdp, 'Tab', true);
  assert(await cdp.eval(onUndo), 'AC4.3 急救键 Shift+Tab 回到撤销键');
  await pressKey(cdp, 'Tab', true);
  assert(await cdp.eval("document.activeElement === [...document.querySelectorAll('.modal-mask:not([inert]) [data-day]')].at(-1)"), 'AC4.3 撤销键 Shift+Tab 回到最后一个日期行');
  await pressKey(cdp, 'Tab');
  assert(await cdp.eval(onUndo), 'AC4.3 最后一个日期行 Tab 回到撤销键');
  await pressKey(cdp, 'Enter');
  assert(await cdp.eval(`Store.medStatusOn('${undoDay}').done === 1`), 'AC4.3 撤销后恢复为之前状态（只剩原 08:00）');
  assert(await cdp.eval(`Store.isMedTaken(Store.data.meds[0].id, '08:00', '${undoDay}')`), 'AC4.3 撤销保留原已核对项');
  assert(await cdp.eval(`!Store.data.medLate['${undoDay}']`), 'AC4.3 撤销清掉本次补记标记');
  assert(!await cdp.eval(`document.querySelector('#med-day-${undoDay}').textContent.includes('全吃到')`), 'AC4.3 撤销后历史行不再显示「全吃到」（画面同步）');
  assert(await cdp.eval(onHistoryTitle), 'AC4.3 回车撤销后焦点回历史弹窗标题');
  assert(!await cdp.eval("document.querySelector('#toast').classList.contains('show')"), 'AC4.3 撤销后提示条隐藏');
  const undoDoneBefore = await cdp.eval(`Store.medStatusOn('${undoDay}').done`);
  await cdp.eval("document.querySelector('#toast .toast-action')?.click()");
  await delay(120);
  assert.strictEqual(await cdp.eval(`Store.medStatusOn('${undoDay}').done`), undoDoneBefore, 'AC4.3 撤销按钮再点无效');
  console.log('PASS  真实 Tab 到达撤销、双向循环、回车只回退新勾项、历史行与焦点同步、再点无效（AC4.3）');

  // 1d. 真实 8 秒超时后，透明按钮不能再被键盘或无障碍树访问（AC4.4）。
  await checkAllAndTabToUndo(undoDay, 'AC4.4');
  const medState = `({ done: Store.medStatusOn('${undoDay}').done, log: Store.data.medLog['${undoDay}'], late: Store.data.medLate['${undoDay}'] })`;
  const checkedState = await cdp.eval(medState);
  assert.strictEqual(checkedState.done, 3, 'AC4.4 再次补齐三项核对');
  assert.strictEqual(Object.keys(checkedState.late).length, 2, 'AC4.4 两项补记标记在位');
  const visibleAX = await cdp.send('Accessibility.getFullAXTree');
  assert(visibleAX.nodes.some(n => !n.ignored && n.role?.value === 'button' && n.name?.value === '撤销'), 'AC4.4 Chromium 显示期间无障碍树暴露撤销按钮（不替代真机读屏）');
  // 不改计时器、不模拟时钟；条件等待上限 10 秒。
  await waitFor(cdp, "!document.querySelector('#toast').classList.contains('show')", 'AC4.4 等待真实 8 秒超时', 10000);
  assert(await cdp.eval(onHistoryTitle), 'AC4.4 超时后焦点回历史弹窗标题');
  assert.deepStrictEqual(await cdp.eval(medState), checkedState, 'AC4.4 超时不改变核对和补记');
  await pressKey(cdp, 'Escape');
  await waitFor(cdp, "!document.querySelector('.modal-mask')", 'AC4.4 Esc 关闭历史弹窗');
  // 重现报告的起点；随后必须走原生 Tab/回车，不能对隐藏按钮调用 click()。
  await cdp.eval("document.querySelector('.bottom-nav [data-view=\"learn\"]').focus()");
  await pressKey(cdp, 'Tab');
  assert(!await cdp.eval(onUndo), 'AC4.4 从底栏知识 Tab 不得落到隐形撤销键');
  await pressKey(cdp, 'Enter');
  assert.deepStrictEqual(await cdp.eval(medState), checkedState, 'AC4.4 隐藏后 Tab/回车不能误撤销');
  const hiddenAX = await cdp.send('Accessibility.getFullAXTree');
  assert(!hiddenAX.nodes.some(n => !n.ignored && n.role?.value === 'button' && n.name?.value === '撤销'), 'AC4.4 隐藏后无障碍树不再暴露撤销按钮');
  await cdp.eval('Store.load()');
  assert.deepStrictEqual(await cdp.eval(medState), checkedState, 'AC4.4 重读 Store 后核对和补记仍完整');

  // 再对另一日补记，验证超时隐藏不会让下一条撤销永久失效。
  await closeAll(cdp);
  await cdp.eval("App.go('meds')");
  await clickAndWait(cdp, '#btn-med-hist', `document.querySelector('#med-day-${undoDay}')`, 'AC4.4 重开服药历史');
  const nextUndoDay = await cdp.eval(`Store.addDays('${undoDay}', -1)`);
  await checkAllAndTabToUndo(nextUndoDay, 'AC4.4 新提示');
  assert.strictEqual(await cdp.eval(`Store.medStatusOn('${nextUndoDay}').done`), 3, 'AC4.4 新提示对应日期已补齐');
  await pressKey(cdp, 'Enter');
  assert.strictEqual(await cdp.eval(`Store.medStatusOn('${nextUndoDay}').done`), 0, 'AC4.4 新提示的回车撤销恢复可用');
  assert(await cdp.eval(`!Store.data.medLate['${nextUndoDay}']`), 'AC4.4 新提示撤销清除对应补记标记');
  assert.deepStrictEqual(await cdp.eval(medState), checkedState, 'AC4.4 新提示撤销不影响已超时的日期');
  await closeAll(cdp);
  console.log('PASS  真实超时回收焦点、隐藏撤销不可键盘/无障碍树访问、数据持久化、新提示恢复可用（AC4.4）');

  // 2. 训练补记
  const yday = await cdp.eval('Store.addDays(Store.today(), -1)');
  await cdp.eval("App.go('train'); document.querySelector('#train-history').open = true;");
  await clickAndWait(cdp, '#btn-ex-hist', `document.querySelector('#ex-day-${yday}')`, '训练历史打开');
  await clickAndWait(cdp, `#ex-day-${yday}`, "document.querySelector('.modal-mask:not([inert]) .check-row')", '打开训练补记子弹窗');
  const exid = await cdp.eval("document.querySelector('.modal-mask:not([inert]) .check-row').dataset.exid");
  await click(cdp, '.modal-mask:not([inert]) .check-row');
  await delay(180);
  assert(await cdp.eval(`Store.exercisesOn('${yday}').includes('${exid}')`), '训练补记昨天已记');
  await cdp.eval('history.back()');
  await waitFor(cdp, "document.querySelectorAll('.modal-mask').length === 1", '训练补记返回只关子弹窗');
  assert(await cdp.eval(`document.querySelector('#ex-day-${yday}').textContent.includes('练了 1 项')`), '昨天行显示练了 1 项');
  await clickAndWait(cdp, `#ex-day-${yday}`, "document.querySelector('.modal-mask:not([inert]) .check-row')", '再次打开训练补记');
  await click(cdp, `.modal-mask:not([inert]) [data-exid="${exid}"]`);
  await delay(180);
  assert(!await cdp.eval(`Store.exercisesOn('${yday}').includes('${exid}')`), '再点取消后训练记录消失');
  await closeAll(cdp);
  console.log('PASS  训练补记/撤销昨天，行文案与 streak 随之更新');

  // 3. 记录修改与删除
  await cdp.eval(`(() => {
    Store.data.vitals.bp = [];
    Store.addVital('bp', { date: Store.addDays(Store.today(), -1), time: '08:00', sys: 120, dia: 80 });
    Store.addVital('bp', { date: Store.addDays(Store.today(), -1), time: '08:00', sys: 130, dia: 85 });
    App.go('records');
  })()`);
  await clickAndWait(cdp, '[data-hist="bp"]', "document.querySelector('.rec-open')", '血压历史打开');
  const rowInfo = await cdp.eval(`(() => {
    const b = document.querySelector('.rec-open');
    return { id: b.dataset.vital, rowId: b.id };
  })()`);
  const bpCount = await cdp.eval('Store.data.vitals.bp.length');
  const bpIdx = await cdp.eval(`Store.data.vitals.bp.findIndex(v => v.id === '${rowInfo.id}')`);
  await clickAndWait(cdp, `#${rowInfo.rowId}`, "document.querySelector('#ev-sys')", '打开修改弹窗');
  await cdp.eval("document.querySelector('#ev-sys').value = '145'");
  await click(cdp, '#ev-save');
  await waitFor(cdp, "!document.querySelector('#ev-sys')", '保存修改关闭弹窗');
  assert.strictEqual(await cdp.eval(`Store.data.vitals.bp[${bpIdx}].sys`), 145, '修改后数值更新');
  assert.strictEqual(await cdp.eval(`Store.data.vitals.bp[${bpIdx}].id`), rowInfo.id, '修改保留 id 与数组位置');
  assert.strictEqual(await cdp.eval('Store.data.vitals.bp.length'), bpCount, '修改不改变条数');
  assert.strictEqual(await cdp.eval('document.activeElement.id'), rowInfo.rowId, '修改后焦点回该行');
  await click(cdp, `.modal-mask:not([inert]) .rec-del`);
  await delay(150);
  assert(await cdp.eval("Boolean(document.querySelector('.modal-mask:not([inert]) .confirm-box'))"), '行内删除先出现两步确认');
  assert.strictEqual(await cdp.eval('Store.data.vitals.bp.length'), bpCount, '两步确认出现时尚未删除');
  await click(cdp, '.modal-mask:not([inert]) [data-confirm="no"]');
  await delay(150);
  assert(await cdp.eval("Boolean(document.querySelector('.modal-mask:not([inert]) .rec-del'))"), '取消后恢复行');
  await click(cdp, '.modal-mask:not([inert]) .rec-del');
  await delay(150);
  await click(cdp, '.modal-mask:not([inert]) [data-confirm="yes"]');
  await delay(200);
  assert.strictEqual(await cdp.eval('Store.data.vitals.bp.length'), bpCount - 1, '确认后条数减一');
  // 修改弹窗内删除
  await click(cdp, '.modal-mask:not([inert]) .rec-open');
  await waitFor(cdp, "document.querySelector('#ev-del')", '再次打开修改弹窗');
  const beforeModalDel = await cdp.eval('Store.data.vitals.bp.length');
  await click(cdp, '#ev-del');
  await delay(150);
  await click(cdp, '.modal-mask:not([inert]) [data-confirm="yes"]');
  await waitFor(cdp, "!document.querySelector('#ev-del')", '修改弹窗删除后关闭');
  assert.strictEqual(await cdp.eval('Store.data.vitals.bp.length'), beforeModalDel - 1, '弹窗内删除条数减一');
  await closeAll(cdp);
  console.log('PASS  记录可修改（保 id/位置）、行内与弹窗内两步删除');

  // 3b. F2：confirmInPlace 保存失败后按钮恢复可点；成功路径连点两下只删一次（AC2.1）
  await cdp.eval(`(() => {
    Store.data.vitals.bp = [];
    Store.addVital('bp', { date: Store.addDays(Store.today(), -1), time: '08:00', sys: 118, dia: 76 });
    App.go('meds'); App.go('records');   // 切走再回，强制重新渲染（go 对同页会早退）
  })()`);
  await clickAndWait(cdp, '[data-hist="bp"]', "document.querySelector('.rec-open')", 'AC2.1 血压历史打开');
  await cdp.eval('window.__origRemoveVital = Store.removeVital; Store.removeVital = () => false;');   // 模拟保存失败
  await click(cdp, '.modal-mask:not([inert]) .rec-del');
  await delay(150);
  await click(cdp, '.modal-mask:not([inert]) [data-confirm="yes"]');
  await delay(150);
  assert(await cdp.eval(`(() => { const y = document.querySelector('.modal-mask:not([inert]) [data-confirm="yes"]'), n = document.querySelector('.modal-mask:not([inert]) [data-confirm="no"]'); return Boolean(y) && Boolean(n) && y.disabled === false && n.disabled === false; })()`), 'AC2.1 保存失败后确认键与取消键都恢复可点');
  await click(cdp, '.modal-mask:not([inert]) [data-confirm="no"]');
  await delay(150);
  assert(await cdp.eval("Boolean(document.querySelector('.modal-mask:not([inert]) .rec-del'))"), 'AC2.1 取消后还原原节点');
  assert.strictEqual(await cdp.eval('Store.data.vitals.bp.length'), 1, 'AC2.1 失败与取消期间未删除');
  // 成功路径：连点两下只调用一次
  await cdp.eval('Store.removeVital = window.__origRemoveVital; window.__rmCount = 0; window.__wrappedRV = Store.removeVital; Store.removeVital = (...a) => { window.__rmCount++; return window.__wrappedRV(...a); };');
  await click(cdp, '.modal-mask:not([inert]) .rec-del');
  await delay(150);
  await rapidDoubleClick(cdp, '.modal-mask:not([inert]) [data-confirm="yes"]');
  await delay(200);
  assert.strictEqual(await cdp.eval('window.__rmCount'), 1, 'AC2.1 连点两下 removeVital 只被调用一次');
  assert.strictEqual(await cdp.eval('Store.data.vitals.bp.length'), 0, 'AC2.1 成功删除后条数为 0');
  await cdp.eval('Store.removeVital = window.__wrappedRV;');
  await closeAll(cdp);
  console.log('PASS  确认框保存失败后按钮恢复、取消还原、连点只删一次（AC2.1）');

  // 4. 键盘回车流
  await cdp.eval("App.go('records'); Store.data.vitals.bp = []; Store.save();");
  await cdp.eval("document.querySelector('#bp-sys').focus(); document.querySelector('#bp-sys').value='128'; document.querySelector('#bp-dia').value='82'; document.querySelector('#bp-pulse').value='70';");
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await delay(80);
  assert.strictEqual(await cdp.eval('document.activeElement.id'), 'bp-dia', '高压回车跳到低压');
  assert(await cdp.eval(`(() => {
    const el = document.querySelector('#bp-dia');
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'isComposing', { value: true });
    el.dispatchEvent(ev);
    return document.activeElement.id === 'bp-dia';
  })()`), '组字状态的回车不移动焦点');
  await cdp.eval("document.querySelector('#bp-pulse').focus();");
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await delay(150);
  assert.strictEqual(await cdp.eval('Store.data.vitals.bp[0]?.sys'), 128, '最后一框回车触发保存');
  console.log('PASS  键盘回车跳下一框/最后一框保存，组字不触发');

  // 5. 记录时间归属
  await cdp.eval(`App.go('records'); Store.data.vitals.bp = []; Store.save();
    window.__timeStr = Store.timeStr; Store.timeStr = () => '23:58';
    document.querySelector('#bp-sys').value='121'; document.querySelector('#bp-dia').value='79';`);
  await click(cdp, '#bp-save');
  await delay(200);
  assert.strictEqual(await cdp.eval('Store.data.vitals.bp[0].time'), '23:58', '未改时间时取保存那刻');
  await cdp.eval('Store.timeStr = window.__timeStr;');
  await cdp.eval("document.querySelector('#bp-sys').value='122'; document.querySelector('#bp-dia').value='78';");
  await click(cdp, '#bp-dt-chip');
  await delay(120);
  await cdp.eval(`(() => {
    const t = document.querySelector('#bp-time'); t.value = '06:30'; t.dispatchEvent(new Event('change'));
  })()`);
  await click(cdp, '#bp-save');
  await delay(200);
  assert.strictEqual(await cdp.eval('Store.data.vitals.bp[0].time'), '06:30', '改过时间后取输入值');
  console.log('PASS  记录时间未改取此刻、改过取输入值');

  // 6. 跨天自动重画
  await cdp.eval("App.go('meds'); window.__firstNode = document.querySelector('#view').firstElementChild; window.__today = Store.today;");
  await cdp.eval('Store.today = () => Store.addDays(window.__today(), 1);');
  await cdp.eval("document.dispatchEvent(new Event('visibilitychange'))");
  await waitFor(cdp, "document.querySelector('#view').firstElementChild !== window.__firstNode", '跨天后首个子节点更换');
  await cdp.eval('Store.today = window.__today; document.dispatchEvent(new Event("visibilitychange"));');
  console.log('PASS  过夜/跨天自动按今天重画');

  // 6b. 绑定“今天的服药核对”弹窗过夜跨天后自动关闭（避免把点击记到昨天）
  await cdp.eval("App.go('meds')");
  const todayKey = await cdp.eval('Store.today()');
  await clickAndWait(cdp, '#btn-med-hist', `document.querySelector('#med-day-${todayKey}')`, '服药历史打开（今天行）');
  await clickAndWait(cdp, `#med-day-${todayKey}`, "document.querySelector('.modal-mask:not([inert]) .m-title')", '打开今天的服药核对');
  assert(await cdp.eval("document.querySelector('.modal-mask:not([inert]) .m-title').textContent.includes('今天的服药核对')"), '标题为今天的服药核对');
  const beforeCross = await cdp.eval("document.querySelectorAll('.modal-mask').length");
  await cdp.eval('window.__today2 = Store.today; Store.today = () => Store.addDays(window.__today2(), 1);');
  await cdp.eval("document.dispatchEvent(new Event('visibilitychange'))");
  await waitFor(cdp, `document.querySelectorAll('.modal-mask').length < ${beforeCross}`, '跨天后今天的服药核对弹窗自动关闭');
  await cdp.eval('Store.today = window.__today2; document.dispatchEvent(new Event("visibilitychange"));');
  await closeAll(cdp);
  console.log('PASS  绑定今天的服药核对弹窗过夜跨天后自动关闭');

  // 7. 布局审计：新增弹窗与确认态
  for (const width of [320, 360, 390]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
    const audits = [
      ['med-history', async () => { await cdp.eval("App.go('meds')"); await click(cdp, '#btn-med-hist'); await waitFor(cdp, `document.querySelector('#med-day-${seed.qian}')`, '审计:服药历史'); }],
      ['med-day', async () => { await click(cdp, `#med-day-${seed.qian}`); await waitFor(cdp, "document.querySelector('.modal-mask:not([inert]) .med-check')", '审计:补记子弹窗'); }],
      ['ex-history', async () => { await closeAll(cdp); await cdp.eval("App.go('train'); document.querySelector('#train-history').open = true;"); await click(cdp, '#btn-ex-hist'); await waitFor(cdp, `document.querySelector('#ex-day-${yday}')`, '审计:训练历史'); }],
      ['ex-day', async () => { await click(cdp, `#ex-day-${yday}`); await waitFor(cdp, "document.querySelector('.modal-mask:not([inert]) .check-row')", '审计:训练补记'); }],
      ['vital-edit', async () => { await closeAll(cdp); await cdp.eval("App.go('records')"); await click(cdp, '[data-hist="bp"]'); await waitFor(cdp, "document.querySelector('.rec-open')", '审计:血压历史'); await click(cdp, '.rec-open'); await waitFor(cdp, "document.querySelector('#ev-sys')", '审计:修改弹窗'); }],
      ['confirm', async () => { await click(cdp, '#ev-del'); await waitFor(cdp, "document.querySelector('.modal-mask:not([inert]) .confirm-box')", '审计:确认态'); }],
    ];
    for (const [name, open] of audits) {
      await open();
      await delay(120);
      assert(await cdp.eval('document.documentElement.scrollWidth <= innerWidth'), `${width}/${name} 页面无横向溢出`);
      assert(await cdp.eval("(() => { const p = document.querySelector('.modal-mask:not([inert]) .modal-panel'); return !p || p.scrollWidth <= p.clientWidth; })()"), `${width}/${name} 弹窗面板无横向溢出`);
      const small = await cdp.eval(`Array.from(document.querySelectorAll('.modal-mask:not([inert]) button, .modal-mask:not([inert]) [role=button], .modal-mask:not([inert]) [role=checkbox]'))
        .filter(el => el.getClientRects().length && !el.closest('details:not([open]) .disclosure-body') && !el.closest('.modal-head'))
        .filter(el => { const r = el.getBoundingClientRect(); return r.width < 48 || r.height < 48; })
        .map(el => el.textContent.trim().slice(0, 12))`);
      assert.deepStrictEqual(small, [], `${width}/${name} 顶层弹窗控件触控面积 ≥48px`);
      const shortRows = await cdp.eval(`Array.from(document.querySelectorAll('.modal-mask:not([inert]) .med-check, .modal-mask:not([inert]) .check-row'))
        .filter(el => el.getClientRects().length && el.getBoundingClientRect().height < 60).length`);
      assert.strictEqual(shortRows, 0, `${width}/${name} 勾选行 ≥60px 高`);
      if (cliArgs.includes('--screenshots')) {
        const tag = width === 390 ? '390n' : width === 320 ? '320x' : null;
        if (tag) {
          const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(`/tmp/rehab-v0232-${name}-${tag}.png`, Buffer.from(shot.data, 'base64'));
        }
      }
    }
    await closeAll(cdp);
  }
  console.log('PASS  320/360/390 下补记/修改/确认弹窗无横向溢出、控件 ≥48px、勾选行 ≥60px');

  // 9. 压力：历史↔补记子弹窗开关 20 轮，history.length 不增长
  if (stressMode) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.eval("App.go('meds')");
    await clickAndWait(cdp, '#btn-med-hist', `document.querySelector('#med-day-${seed.qian}')`, '压力:服药历史');
    const baseLen = await cdp.eval('history.length');
    for (let i = 0; i < 20; i++) {
      await clickAndWait(cdp, `#med-day-${seed.qian}`, "document.querySelector('.modal-mask:not([inert]) .med-check')", `压力补记 ${i + 1} 打开`);
      await cdp.eval('history.back()');
      await waitFor(cdp, "document.querySelectorAll('.modal-mask').length === 1", `压力补记 ${i + 1} 关闭`);
    }
    assert(await cdp.eval('history.length') <= baseLen + 1, '20 轮补记开关历史长度不增长');
    await closeAll(cdp);
    console.log('PASS  历史↔补记子弹窗 20 轮开关，历史栈不增长');
  }
}

(async () => {
  const { browser, cdp, profile } = await launch();
  try {
    let url = await prepare(cdp, 'close');
    await clickAndWait(cdp, '.modal-close', "document.querySelectorAll('.modal-mask').length === 1 && document.querySelector('#set-save') && !document.querySelector('#set-save').closest('[inert]')", '关闭备份弹窗');
    await assertAppAlive(cdp, url, '关闭备份');
    console.log('PASS  关闭备份后应用仍在当前页面');

    url = await prepare(cdp, 'plain');
    await clickAndWait(cdp, '#backup-plain', "document.querySelectorAll('.modal-mask').length === 1 && document.querySelector('#set-save') && !document.querySelector('#set-save').closest('[inert]')", '普通备份下载后关闭');
    await assertAppAlive(cdp, url, '下载普通备份');
    console.log('PASS  普通备份下载后应用仍在当前页面');

    url = await prepare(cdp, 'encrypted');
    await clickAndWait(cdp, '#backup-encrypted', "document.querySelector('#backup-password')", '加密备份弹窗');
    await assertAppAlive(cdp, url, '切换加密备份', '密码加密备份');
    console.log('PASS  切换加密备份后页面与历史状态正常');
    await clickAndWait(cdp, '.modal-close', "document.querySelectorAll('.modal-mask').length === 1 && document.querySelector('#set-save') && !document.querySelector('#set-save').closest('[inert]')", '关闭加密备份弹窗');
    await assertAppAlive(cdp, url, '关闭加密备份');

    url = await prepare(cdp, 'encrypt-complete');
    await clickAndWait(cdp, '#backup-encrypted', "document.querySelector('#backup-password')", '加密备份输入页');
    await cdp.eval(`(() => {
      document.querySelector('#backup-password').value = '家人可信密码2026';
      document.querySelector('#backup-password-again').value = '家人可信密码2026';
    })()`);
    await click(cdp, '#backup-encrypt-confirm');
    await waitFor(cdp, "document.querySelectorAll('.modal-mask').length === 1 && document.querySelector('#set-save') && !document.querySelector('#set-save').closest('[inert]')", '加密下载后关闭', remoteTimeout);
    await assertAppAlive(cdp, url, '完成加密备份');
    console.log('PASS  加密并下载后应用仍在当前页面');

    await runUXRegression(cdp);
    await runBackfillRegression(cdp);
    if (stressMode) await runOverlayStress(cdp);

    const exceptions = cdp.events.filter(event => event.method === 'Runtime.exceptionThrown');
    assert.strictEqual(exceptions.length, 0, '浏览器运行期间不应有未捕获异常');
    console.log('✅ 备份浮层 Chromium 回归全部通过');
  } finally {
    cdp.close();
    browser.kill('SIGTERM');
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('❌', error.stack || error.message);
  process.exitCode = 1;
});
