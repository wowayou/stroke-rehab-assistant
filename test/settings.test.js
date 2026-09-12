/* 真实 Chromium 回归：设置里"立刻生效"的偏好必须立刻落盘，且回显与实际一致。
   守的 bug（v0.2.25）：选了特大字号→用 ✕/返回键关闭→重新打开，
   高亮回到"标准"而页面其实还是特大——显示与真相分叉。 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..');
const appBase = process.argv.slice(2).find(a => !a.startsWith('--'))
  || pathToFileURL(path.join(root, 'index.html')).href;
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
      expression, awaitPromise: true, returnByValue: true,
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

async function clickAndWait(cdp, selector, expression, label) {
  await click(cdp, selector);
  await waitFor(cdp, expression, label);
}

async function launch() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rehab-settings-'));
  const firstURL = caseURL('boot');
  const args = [
    '--headless', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, firstURL,
  ];
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

const openSettings = async cdp => {
  await clickAndWait(cdp, '#btn-settings', "document.querySelector('[data-seg=\"font\"]')", '打开设置');
  await delay(220);
};
/* 界面上"看起来选中"的那一档（同时要求 class 与 aria 一致，读屏与视觉不能各说各话） */
const shownFont = cdp => cdp.eval(`(() => {
  const chips = [...document.querySelectorAll('[data-seg="font"]')];
  const active = chips.filter(c => c.classList.contains('active'));
  const aria = chips.filter(c => c.getAttribute('aria-checked') === 'true');
  if (active.length !== 1 || aria.length !== 1) return 'BROKEN:' + active.length + '/' + aria.length;
  if (active[0] !== aria[0]) return 'MISMATCH';
  return active[0].dataset.segKey;
})()`);
/* 真正生效/落盘的那一档 */
const storedFont = cdp => cdp.eval(
  `JSON.parse(localStorage.getItem('strokeRehab.v1')).profile.font`);
const appliedFont = cdp => cdp.eval(
  `document.documentElement.dataset.font || 'normal'`);

(async () => {
  const { browser, cdp, profile } = await launch();
  try {
    /* ① 选特大 → 不按"保存设置"，用 ✕ 关掉 → 重开必须还显示特大 */
    await openSettings(cdp);
    await click(cdp, '[data-seg="font"][data-seg-key="xlarge"]');
    await waitFor(cdp, `document.documentElement.dataset.font === 'xlarge'`, '字号立即生效');
    assert.strictEqual(await storedFont(cdp), 'xlarge', '点一下就应落盘，不能等"保存设置"');

    await clickAndWait(cdp, '.modal-close', "!document.querySelector('.modal-mask')", '✕ 关闭设置');
    await delay(260);
    assert.strictEqual(await appliedFont(cdp), 'xlarge', '关闭设置后字号应保持特大');

    await openSettings(cdp);
    assert.strictEqual(await shownFont(cdp), 'xlarge', '重新打开设置必须回显特大（v0.2.25 守的 bug）');
    console.log('PASS  ✕ 关闭后重开设置，字号回显与实际一致');

    /* ② 按"保存设置"不得把已生效的字号覆盖回旧值 */
    await clickAndWait(cdp, '#set-save', "!document.querySelector('.modal-mask')", '保存设置');
    await delay(260);
    assert.strictEqual(await appliedFont(cdp), 'xlarge', '保存设置不应改变已选字号');
    assert.strictEqual(await storedFont(cdp), 'xlarge', '保存设置不应把字号覆盖回默认');
    console.log('PASS  「保存设置」不覆盖已即时生效的字号');

    /* ③ 重新加载页面（模拟第二天打开）后仍是特大，且回显一致 */
    const url = caseURL('reload');
    await cdp.send('Page.navigate', { url });
    await waitFor(cdp, `document.readyState === 'complete' && typeof App !== 'undefined'`, '重新加载', remoteTimeout);
    await delay(200);
    assert.strictEqual(await appliedFont(cdp), 'xlarge', '重新加载后字号应仍为特大');
    await openSettings(cdp);
    assert.strictEqual(await shownFont(cdp), 'xlarge', '重新加载后设置回显应为特大');
    console.log('PASS  重新加载后字号与回显都保持特大');

    /* ④ 语速同一套机制：点一下即落盘，✕ 关闭后重开回显不丢 */
    if (await cdp.eval(`Boolean(document.querySelector('[data-seg="rate"]'))`)) {
      await click(cdp, '[data-seg="rate"][data-seg-key="fast"]');
      await waitFor(cdp,
        `JSON.parse(localStorage.getItem('strokeRehab.v1')).profile.speechRate === 'fast'`,
        '语速立即落盘');
      await clickAndWait(cdp, '.modal-close', "!document.querySelector('.modal-mask')", '✕ 关闭设置');
      await delay(260);
      await openSettings(cdp);
      const rate = await cdp.eval(`(() => {
        const on = [...document.querySelectorAll('[data-seg="rate"]')]
          .filter(c => c.classList.contains('active'));
        return on.length === 1 ? on[0].dataset.segKey : 'BROKEN:' + on.length;
      })()`);
      assert.strictEqual(rate, 'fast', '朗读语速的回显同样不能丢');
      console.log('PASS  朗读语速即时落盘且回显一致');
    } else {
      console.log('SKIP  该环境无语音合成，跳过语速用例');
    }

    /* ⑤ 键盘可操作（家属用电脑帮着调）：方向键应能切换并落盘 */
    await cdp.eval(`document.querySelector('[data-seg="font"][data-seg-key="xlarge"]').focus()`);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
    await waitFor(cdp, `document.documentElement.dataset.font === 'large'`, '方向键切换字号');
    assert.strictEqual(await storedFont(cdp), 'large', '方向键切换也要落盘');
    assert.strictEqual(await shownFont(cdp), 'large', '方向键切换后回显一致');
    console.log('PASS  方向键可切换字号且状态一致');

    const exceptions = cdp.events.filter(e => e.method === 'Runtime.exceptionThrown');
    assert.strictEqual(exceptions.length, 0, '运行期间不应有未捕获异常');
    console.log('✅ 设置项持久化 Chromium 回归全部通过');
  } finally {
    cdp.close();
    browser.kill('SIGTERM');
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('❌', error.stack || error.message);
  process.exitCode = 1;
});
