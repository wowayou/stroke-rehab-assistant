/* 真实 Chromium 回归：老手机与微信内置浏览器（v0.2.33）。
   ① 主程序解析失败（老浏览器不认新语法）或初始化半路出错：不能白屏，要显示人话并且能拨 120；
   ② 微信里不能下载文件：备份换成"复制备份内容"，任何浏览器都能"粘贴备份内容恢复"，
      复制不全时说清楚，不覆盖现有数据；
   ③ 没有 Pointer Events 的老 iOS：图表点一下照样出数值。
   老浏览器本身无头环境里没有：①用"把脚本弄坏"模拟解析失败，语法是否真能被老引擎解析
   见 contracts.test.js 的静态护栏与 DEVELOPMENT §6「兼容性」的老解析器核对方法。 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..');
const RUNTIME = ['index.html', 'manifest.json', 'icon.svg', 'sw.js', 'css', 'js'];
const WECHAT_UA = 'Mozilla/5.0 (Linux; Android 12; V2055A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/107.0.5304.141 Mobile Safari/537.36 XWEB/5315 MMWEBSDK/20230805 MMWEBID/2523 MicroMessenger/8.0.42.2460(0x28002A35) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64';

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
    this.nextId = 1; this.pending = new Map(); this.events = [];
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = () => reject(new Error('无法连接 Chromium DevTools')); });
    this.ws.onmessage = event => {
      const m = JSON.parse(event.data);
      if (!m.id) {
        this.events.push(m);
        if (m.method === 'Page.javascriptDialogOpening') this.send('Page.handleJavaScriptDialog', { accept: true });
        return;
      }
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id); clearTimeout(p.timer);
      if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
    };
  }
  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Chromium DevTools 命令超时：${method}`)); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.ws.send(JSON.stringify({ id, method, params }));
    return result;
  }
  async eval(expression) {
    const out = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text);
    return out.result.value;
  }
  close() { this.ws.close(); }
}
const delay = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(cdp, expression, label, timeout = 6000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try { if (await cdp.eval(`Boolean(${expression})`)) return; } catch (e) { lastError = e; }
    await delay(30);
  }
  throw new Error(`${label}超时${lastError ? `：${lastError.message}` : ''}`);
}
async function click(cdp, selector) {
  await cdp.eval("Promise.all(document.getAnimations().filter(a => a.effect?.target?.matches('.modal-mask, .modal-panel, .trainer')).map(a => a.finished.catch(() => {}))).then(() => true)");
  const point = await cdp.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    if (!el.closest('.app-header')) el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!point) throw new Error(`找不到待点击元素：${selector}`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
}

async function launch() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rehab-compat-'));
  const browser = spawn(chromiumBinary(), ['--headless', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  const wsURL = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chromium 启动超时\n${stderr}`)), 15000);
    browser.stderr.on('data', c => { stderr += c; const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (m) { clearTimeout(timer); resolve(m[1]); } });
  });
  return { browser, profile, port: new URL(wsURL).port };
}
async function openPage(port, url, { ua = '', script = '' } = {}) {
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  if (ua) await cdp.send('Emulation.setUserAgentOverride', { userAgent: ua });
  if (script) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: script });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp.send('Page.navigate', { url });
  await waitFor(cdp, "document.readyState === 'complete'", '页面加载');
  return cdp;
}
const appURL = (dir, view = 'today') => `${pathToFileURL(path.join(dir, 'index.html')).href}?view=${view}`;
function brokenCopy(file, append) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rehab-broken-'));
  RUNTIME.forEach(f => fs.cpSync(path.join(root, f), path.join(dir, f), { recursive: true }));
  fs.appendFileSync(path.join(dir, file), append);
  return dir;
}

(async () => {
  const { browser, profile, port } = await launch();
  const pages = [];
  const temps = [];
  try {
    /* ① 主程序解析失败 / 初始化崩溃：显示兜底页，急救照样能拨 */
    for (const [label, file, append] of [
      ['主程序解析失败（老浏览器不认新语法）', 'js/app/core.js', '\n}}} // 故意的语法错误\n'],
      ['最后一个文件解析失败（App 没定义）', 'js/app/boot.js', '\n}}} // 故意的语法错误\n'],
      ['初始化半路出错（数据文件没加载起来）', 'js/data-exercises.js', '\n}}} // 故意的语法错误\n'],
    ]) {
      const dir = brokenCopy(file, append);
      temps.push(dir);
      const cdp = await openPage(port, appURL(dir));
      cdp.broken = true;   // 故意弄坏的页面，有报错是预期的
      pages.push(cdp);
      await waitFor(cdp, "document.querySelector('#view').textContent.includes('这个浏览器打不开本应用')", `${label}：显示兜底页`);
      assert(await cdp.eval("Boolean(document.querySelector('#view a[href=\"tel:120\"]'))"), `${label}：兜底页能拨 120`);
      assert.strictEqual(await cdp.eval("document.querySelectorAll('#view li b').length"), 6, `${label}：BE-FAST 六条识别要点都在`);
      assert.strictEqual(await cdp.eval("getComputedStyle(document.querySelector('.bottom-nav')).display"), 'none', `${label}：点了没反应的导航藏起来`);
      console.log(`PASS  ${label}：不白屏，说明原因并可拨 120`);
    }
    /* 正常加载时兜底页不能误出现 */
    const ok = await openPage(port, appURL(root));
    pages.push(ok);
    await waitFor(ok, "typeof App !== 'undefined' && document.querySelector('.today-hero')", '正常启动');
    await delay(300);
    assert(!(await ok.eval("document.body.classList.contains('app-failed') || document.querySelector('#view').textContent.includes('打不开本应用')")), '正常启动时不得出现兜底页');
    console.log('PASS  正常启动时兜底页不出现');

    /* js/app/ 各文件共用全局作用域：顶层名字不能和浏览器自带的全局名同名（会悄悄盖掉 window 上的东西） */
    const appNames = fs.readdirSync(path.join(root, 'js', 'app')).flatMap(f =>
      fs.readFileSync(path.join(root, 'js', 'app', f), 'utf8').split('\n')
        .map(l => l.match(/^(?:async\s+)?function\s+([\w$]+)|^(?:const|let|var)\s+([\w$]+)/)).filter(Boolean).map(m => m[1] || m[2]));
    assert(appNames.length > 120, '应读出 js/app/ 的顶层名字');
    const blank = await openPage(port, 'about:blank');
    pages.push(blank);
    const clash = await blank.eval(`${JSON.stringify(appNames)}.filter(n => n in window)`);
    assert.deepStrictEqual(clash, [], '这些应用层名字与浏览器自带全局名同名：' + clash.join(', '));
    console.log(`PASS  js/app/ 的 ${appNames.length} 个顶层名字都不与浏览器全局名冲突`);

    /* ② 微信：首次指引提醒搬到浏览器；备份换成复制；粘贴恢复；复制不全被拦下 */
    const wx = await openPage(port, appURL(root, 'today'), { ua: WECHAT_UA, script: "if (!sessionStorage.getItem('wx')) { localStorage.clear(); sessionStorage.setItem('wx', '1'); }" });
    pages.push(wx);
    await waitFor(wx, "document.querySelector('#guide-done')", '微信首次指引');
    assert(await wx.eval("document.querySelector('.guide').textContent.includes('在微信里打开的')"), '首次指引说明微信里的风险与搬家办法');
    await delay(260);
    await click(wx, '#guide-done');
    await waitFor(wx, "!document.querySelector('.modal-mask')", '关闭指引');
    await wx.eval(`(() => {
      Store.data.profile.name = '微信里的称呼'; Store.save();
      Store.addVital('bp', { date: Store.today(), time: '08:00', sys: 128, dia: 82 });
    })()`);
    await click(wx, '#btn-settings');
    await delay(260);
    assert(await wx.eval("document.querySelector('.modal-panel').textContent.includes('现在是在微信里打开的')"), '设置里说明正在微信里');
    await click(wx, '#set-backup');
    await waitFor(wx, "document.querySelector('#backup-copy')", '微信里备份弹窗');
    assert.strictEqual(await wx.eval("Boolean(document.querySelector('#backup-plain'))"), false, '微信里不提供下载按钮（下不了，点了也白点）');
    await delay(260);
    await click(wx, '#backup-copy');
    await waitFor(wx, "document.querySelector('#toast').textContent.includes('已复制备份内容') || document.querySelector('#backup-text')", '复制备份内容（自动复制或摆出来手动复制）');
    if (await wx.eval("Boolean(document.querySelector('#backup-text'))")) {
      assert(await wx.eval("JSON.parse(document.querySelector('#backup-text').value).app === 'stroke-rehab-assistant'"), '摆出来的内容是完整可恢复的备份');
    }
    assert.strictEqual(await wx.eval('Store.lastBackupAt()'), '', '复制不算"下载了备份"，不能显示上次下载备份');
    const backupText = await wx.eval('Store.exportBackup()');
    await wx.eval("history.back()");
    await waitFor(wx, "document.querySelectorAll('.modal-mask').length === 1", '回到设置');
    await click(wx, '.modal-mask:not([inert]) .modal-close');
    await waitFor(wx, "!document.querySelector('.modal-mask')", '关闭设置');

    /* 到"浏览器"（这里用同一页改数据模拟另一份存储）粘贴恢复 */
    await wx.eval("Store.data.profile.name = '浏览器里的旧称呼'; Store.save();");
    await click(wx, '#btn-settings');
    await delay(260);
    await click(wx, '#set-restore-paste');
    await waitFor(wx, "document.querySelector('#paste-backup')", '打开粘贴恢复');
    await delay(200);
    await wx.eval(`document.querySelector('#paste-backup').value = ${JSON.stringify(backupText.slice(0, -40))};`);
    await click(wx, '#paste-check');
    await waitFor(wx, "document.querySelector('#paste-error').textContent.includes('不完整')", '复制不全时说清楚');
    assert.strictEqual(await wx.eval('Store.data.profile.name'), '浏览器里的旧称呼', '复制不全时现有数据不变');
    await wx.eval(`document.querySelector('#paste-backup').value = ${JSON.stringify(backupText)};`);
    await click(wx, '#paste-check');
    await waitFor(wx, "document.querySelector('#restore-confirm')", '粘贴完整内容后出恢复预览');
    assert(await wx.eval("document.querySelector('.modal-mask:not([inert]) .modal-panel').textContent.includes('粘贴的内容')"), '预览注明来源是粘贴的内容');
    await delay(200);
    await click(wx, '#restore-confirm');
    await waitFor(wx, "Store.data.profile.name === '微信里的称呼'", '粘贴恢复写入');
    assert.strictEqual(await wx.eval("Store.vitalsSorted('bp').length"), 1, '记录随备份恢复');
    assert(await wx.eval('Store.hasRecoveryBackup()'), '粘贴恢复同样留了可撤销的恢复点');
    await waitFor(wx, "document.querySelectorAll('.modal-mask').length <= 1", '恢复后回到设置');
    console.log('PASS  微信：指引与设置说明风险；备份改为复制；粘贴恢复可用，复制不全被拦下且不动现有数据');

    /* ③ 没有 Pointer Events 的老 iOS：图表点一下照样出数值 */
    const old = await openPage(port, appURL(root, 'records'), { script: 'delete window.PointerEvent;' });
    pages.push(old);
    await waitFor(old, "typeof App !== 'undefined'", '启动');
    if (await old.eval("Boolean(document.querySelector('#guide-done'))")) {
      await delay(260);
      await click(old, '#guide-done');
      await waitFor(old, "!document.querySelector('.modal-mask')", '关闭指引');
    }
    await old.eval(`(() => {
      const t = Store.today();
      Store.data.vitals.bp = [];
      Store.addVital('bp', { date: Store.addDays(t, -1), time: '08:00', sys: 130, dia: 80 });
      Store.addVital('bp', { date: t, time: '08:00', sys: 138, dia: 86 });
      App.go('today'); App.go('records');
    })()`);
    await waitFor(old, "document.querySelector('#bp-chart')", '出图');
    const pt = await old.eval(`(() => { const c = document.querySelector('#bp-chart'); c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.right - 12, y: r.top + r.height / 2 }; })()`);
    await old.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...pt });
    await old.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...pt });
    await waitFor(old, "document.querySelector('.vital-tooltip')?.textContent.includes('138')", '没有 Pointer Events 时点图出数值');
    console.log('PASS  没有 Pointer Events：图表点一下照样出数值');

    for (const p of pages.filter(p => !p.broken)) {
      const ex = p.events.filter(e => e.method === 'Runtime.exceptionThrown');
      assert.strictEqual(ex.length, 0, '正常页面运行期间不应有未捕获异常：' + ex.map(e => e.params.exceptionDetails.exception?.description).join('\n'));
    }
    console.log('✅ 老手机与微信兼容 Chromium 回归全部通过');
  } finally {
    pages.forEach(p => p.close());
    browser.kill('SIGTERM');
    fs.rmSync(profile, { recursive: true, force: true });
    temps.forEach(d => fs.rmSync(d, { recursive: true, force: true }));
  }
})().catch(error => {
  console.error('❌', error.stack || error.message);
  process.exitCode = 1;
});
