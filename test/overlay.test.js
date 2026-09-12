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
      if (!message.id) { this.events.push(message); return; }
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
  const point = await cdp.eval(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    element.scrollIntoView({ block: 'center', inline: 'center' });
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
    element.scrollIntoView({ block: 'center', inline: 'center' });
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
  assert.strictEqual(await cdp.eval('history.length'), settingsHistoryLength, `${name} 连续弹窗不应增加历史条目`);
  return settingsHistoryLength;
}

async function assertAppAlive(cdp, expectedURL, label, expectedModal = '') {
  await delay(350);
  const state = await cdp.eval(`({
    url: location.href,
    title: document.querySelector('.m-title')?.textContent || '',
    modals: document.querySelectorAll('.modal-mask').length,
    app: Boolean(document.querySelector('#view') && document.querySelector('#btn-settings')),
    historyLength: history.length,
    historyState: history.state,
  })`);
  const detail = JSON.stringify(state);
  assert.strictEqual(state.url, expectedURL, `${label}后 URL 不应变化：${detail}`);
  assert(state.app, `${label}后主应用应仍可用：${detail}`);
  assert.strictEqual(state.modals, expectedModal ? 1 : 0, `${label}后浮层数量错误：${detail}`);
  if (expectedModal) {
    assert.strictEqual(state.title, expectedModal, `${label}后弹窗错误`);
    assert(state.historyState?.rehabOverlay, `${label}后应保留一个浮层历史状态`);
  }
  else assert(!state.historyState?.rehabOverlay, `${label}后不应残留浮层历史状态`);
  if (!expectedModal) {
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
      await clickAndWait(cdp, '#backup-plain', "!document.querySelector('.modal-mask')", `${label} 普通备份`);
    } else if (i % 4 === 1) {
      await clickAndWait(cdp, '.modal-close', "!document.querySelector('.modal-mask')", `${label} 关闭`);
    } else {
      await clickAndWait(cdp, '#backup-encrypted', "document.querySelector('#backup-password')", `${label} 进入加密`);
      assert.strictEqual(await cdp.eval('history.length'), overlayLength, `${label} 加密弹窗不应增加历史条目`);
      await clickAndWait(cdp, '.modal-close', "!document.querySelector('.modal-mask')", `${label} 关闭加密`);
    }

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
    assert(state.historyLength <= initialLength + 1, `${label} 后历史栈超出一个浮层条目`);
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
  await waitFor(cdp, "!document.querySelector('.modal-mask')", '快速双击后关闭');
  assert.strictEqual(await cdp.eval('window.__backupDownloadCount'), 1, '快速双击普通备份只能触发一次下载');
  assert.strictEqual(await cdp.eval('location.href'), url, '快速双击后 URL 不应变化');
  console.log('PASS  快速双击普通备份只下载一次，页面仍可用');
}

(async () => {
  const { browser, cdp, profile } = await launch();
  try {
    let url = await prepare(cdp, 'close');
    await clickAndWait(cdp, '.modal-close', "!document.querySelector('.modal-mask')", '关闭备份弹窗');
    await assertAppAlive(cdp, url, '关闭备份');
    console.log('PASS  关闭备份后应用仍在当前页面');

    url = await prepare(cdp, 'plain');
    await clickAndWait(cdp, '#backup-plain', "!document.querySelector('.modal-mask')", '普通备份下载后关闭');
    await assertAppAlive(cdp, url, '下载普通备份');
    console.log('PASS  普通备份下载后应用仍在当前页面');

    url = await prepare(cdp, 'encrypted');
    await clickAndWait(cdp, '#backup-encrypted', "document.querySelector('#backup-password')", '加密备份弹窗');
    await assertAppAlive(cdp, url, '切换加密备份', '密码加密备份');
    console.log('PASS  切换加密备份后页面与历史状态正常');
    await clickAndWait(cdp, '.modal-close', "!document.querySelector('.modal-mask')", '关闭加密备份弹窗');
    await assertAppAlive(cdp, url, '关闭加密备份');

    url = await prepare(cdp, 'encrypt-complete');
    await clickAndWait(cdp, '#backup-encrypted', "document.querySelector('#backup-password')", '加密备份输入页');
    await cdp.eval(`(() => {
      document.querySelector('#backup-password').value = '家人可信密码2026';
      document.querySelector('#backup-password-again').value = '家人可信密码2026';
    })()`);
    await click(cdp, '#backup-encrypt-confirm');
    await waitFor(cdp, "!document.querySelector('.modal-mask')", '加密下载后关闭', remoteTimeout);
    await assertAppAlive(cdp, url, '完成加密备份');
    console.log('PASS  加密并下载后应用仍在当前页面');

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
