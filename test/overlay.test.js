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
