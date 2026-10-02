/* 真实 Chromium 回归：页面开着跨天、锁屏回来、两个页面同开时，显示与记录都不能错。
   守的 bug（v0.2.32）：
   · 晚上打开的用药页第二天切回来，还显示昨天全打了勾——患者会以为今天吃过了；
   · 记录表单的日期时间是渲染那一刻填的，页面开过夜，第二天的血压记成昨天；
   · 计时按"每秒减一"，锁屏时定时器被冻结，5 分钟的动作永远走不完；
   · 两个页面同开，一边记了另一边不知道，再保存被冲突保护拦下；
   · 训练时屏幕 30 秒就黑；计时结束的提示音在 iOS 上不响。
   时钟、可见性、屏幕常亮与音频都在页面里打桩（无头浏览器没有真实锁屏/常亮/扬声器），
   验的是应用逻辑；真机听感与常亮效果仍需手测（见 docs/MANUAL-TEST.md）。 */
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

function caseURL(name, view = 'today') {
  const url = new URL(appBase);
  url.searchParams.set('view', view);
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
        if (message.method === 'Page.javascriptDialogOpening') this.send('Page.handleJavaScriptDialog', { accept: true });
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
  await cdp.eval("Promise.all(document.getAnimations().filter(a => a.effect?.target?.matches('.modal-mask, .modal-panel, .trainer')).map(a => a.finished.catch(() => {}))).then(() => true)");
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

/* 页面加载前注入的桩：可拨的时钟、可切换的可见性、屏幕常亮、音频。
   时钟只平移 Date，不动定时器本身——正好模拟"锁屏期间墙上时间走了，定时器没走"。 */
const STUBS = `(() => {
  const Real = Date;
  let offset = 0;
  function FakeDate(...a) {
    if (!new.target) return new Real(Real.now() + offset).toString();
    return a.length ? new Real(...a) : new Real(Real.now() + offset);
  }
  FakeDate.prototype = Real.prototype;
  FakeDate.now = () => Real.now() + offset;
  FakeDate.parse = Real.parse;
  FakeDate.UTC = Real.UTC;
  window.Date = FakeDate;
  window.__shift = ms => { offset += ms; };
  /* 拨到"明天/后天的 hh:mm" */
  window.__goto = (days, h, m) => {
    const n = new Date();
    const t = new Real(n.getFullYear(), n.getMonth(), n.getDate() + days, h, m, 0);
    offset += t - n;
  };

  window.__vis = 'visible';
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => window.__vis });
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => window.__vis !== 'visible' });
  window.__setVisible = v => { window.__vis = v ? 'visible' : 'hidden'; document.dispatchEvent(new Event('visibilitychange')); };

  window.__wake = { requests: 0, releases: 0, active: 0 };
  Object.defineProperty(Navigator.prototype, 'wakeLock', { configurable: true, get: () => ({
    request: async type => {
      if (type !== 'screen') throw new Error('bad type');
      window.__wake.requests++; window.__wake.active++;
      const s = new EventTarget();
      s.released = false;
      s.release = async () => {
        if (s.released) return;
        s.released = true; window.__wake.releases++; window.__wake.active--;
        s.dispatchEvent(new Event('release'));
      };
      return s;
    },
  }) });

  window.__audio = { created: 0, oscillators: 0, closed: 0 };
  class FakeAC {
    constructor() { window.__audio.created++; this.state = 'suspended'; this.currentTime = 0; this.destination = {}; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; window.__audio.closed++; return Promise.resolve(); }
    createOscillator() { window.__audio.oscillators++; return { frequency: {}, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: {}, connect() {} }; }
  }
  window.AudioContext = FakeAC;
  window.webkitAudioContext = FakeAC;
})();`;

async function openPage(port, url, extraScript = '') {
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: STUBS + extraScript });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp.send('Page.navigate', { url });
  await waitFor(cdp, "document.readyState === 'complete' && typeof App !== 'undefined'", '应用启动', remoteTimeout);
  return cdp;
}

async function dismissGuide(cdp) {
  if (await cdp.eval("Boolean(document.querySelector('#guide-done'))")) {
    await delay(280);
    await click(cdp, '#guide-done');
    await waitFor(cdp, "!document.querySelector('.modal-mask')", '关闭首次指引');
  }
}

async function launch() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rehab-lifecycle-'));
  const args = ['--headless', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'];
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
  return { browser, profile, port: new URL(browserURL).port };
}

const exceptionsOf = cdp => cdp.events.filter(e => e.method === 'Runtime.exceptionThrown')
  .map(e => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);

(async () => {
  const { browser, profile, port } = await launch();
  const pages = [];
  try {
    const cdp = await openPage(port, caseURL('main'));
    pages.push(cdp);
    await dismissGuide(cdp);

    /* ① 用药页开着过了一夜：切回来必须是今天的空核对表，不能是昨天的勾 */
    await cdp.eval(`(() => {
      const t = Store.today();
      Store.addMed({ name: '跨天测试药', dose: '1片', times: ['08:00', '20:00'], note: '', from: Store.addDays(t, -3) });
      const id = Store.data.meds[0].id;
      Store.toggleMed(id, '08:00'); Store.toggleMed(id, '20:00');
      App.go('meds');
    })()`);
    assert.strictEqual(await cdp.eval("document.querySelectorAll('.med-check.checked').length"), 2, '准备：今天两次都已核对');
    await cdp.eval('__setVisible(false); __goto(1, 9, 0); __setVisible(true);');
    await waitFor(cdp, "document.querySelectorAll('.med-check').length === 2 && document.querySelectorAll('.med-check.checked').length === 0", '切回来换成新一天的核对表');
    console.log('PASS  页面开过夜，切回来显示的是今天的核对表（不再是昨天的勾）');

    /* ② 没等到任何事件就直接点（零点刚过、页面一直亮着）：不能把昨天屏幕上的这一下记到今天 */
    await cdp.eval('__goto(1, 0, 5);');
    const before = await cdp.eval("JSON.stringify(Store.data.medLog[Store.today()] || {})");
    await click(cdp, '.med-check');
    await waitFor(cdp, "document.querySelector('#toast').textContent.includes('新的一天')", '跨天点核对给出提示');
    assert.strictEqual(await cdp.eval("JSON.stringify(Store.data.medLog[Store.today()] || {})"), before, '跨天后的第一下点击不能直接记账');
    assert.strictEqual(await cdp.eval("document.querySelectorAll('.med-check.checked').length"), 0, '核对表已换成今天的');
    await click(cdp, '.med-check');
    await waitFor(cdp, "document.querySelectorAll('.med-check.checked').length === 1", '重新点一次才核对');
    console.log('PASS  零点后直接点昨天的核对表：先换表并提示，不替患者记账');

    /* ③ 用药近 7 天：早上 9 点不能因为晚上 20:00 那次还没到点就算"没吃全" */
    await cdp.eval(`(() => {
      Store.data.meds = []; Store.data.medLog = {}; Store.save();
      const t = Store.today();
      Store.addMed({ name: '到点测试药', times: ['08:00', '20:00'], from: Store.addDays(t, -6) });
      const id = Store.data.meds[0].id;
      for (let i = 1; i <= 6; i++) { Store.toggleMed(id, '08:00', Store.addDays(t, -i)); Store.toggleMed(id, '20:00', Store.addDays(t, -i)); }
    })()`);
    await cdp.eval('__goto(0, 9, 0); App.go("today"); App.go("meds");');
    await click(cdp, '.med-check');   // 今早 08:00 那次
    await waitFor(cdp, "document.body.textContent.includes('每天该吃的都核对到了')", '早上看 7 天都算吃全');
    await click(cdp, '#btn-med-hist');
    await waitFor(cdp, "document.querySelector('.dose-dot.pending')", '历史里晚上那次显示为还没到时间');
    assert(await cdp.eval("document.querySelector('.day-row .day-score').textContent === '到点的都吃了'"), '今天一行不说"差 1 次"');
    assert(await cdp.eval("document.querySelector('.modal-panel').textContent.includes('完成率 100%')"), '14 天完成率只算到点的');
    await click(cdp, '.modal-close');
    await waitFor(cdp, "!document.querySelector('.modal-mask')", '关闭服药历史');
    console.log('PASS  早上 9 点：还没到点的晚间药不算漏服（7 天卡片、历史圆点、完成率）');

    /* ③b 已停用的药改"开始日期"晚于停用日：以前会悄悄复活回每日核对；现在必须拦下并说明原因 */
    await cdp.eval(`(() => {
      const id = Store.data.meds[0].id;
      Store.stopMed(id, Store.addDays(Store.today(), -2));
      App.go('today'); App.go('meds');
    })()`);
    await click(cdp, '.med-item.stopped [data-edit-med]');
    await waitFor(cdp, "document.querySelector('#med-from')", '打开已停用药物');
    await delay(260);
    await cdp.eval("document.querySelector('#med-from').value = Store.today();");
    await click(cdp, '#med-save');
    await waitFor(cdp, "document.querySelector('.save-feedback')?.textContent.includes('不能晚于停用日期')", '显示拒绝原因');
    assert.strictEqual(await cdp.eval('Store.activeMeds().length'), 0, '停用的药不能复活');
    await click(cdp, '.modal-mask:not([inert]) .modal-close');
    await waitFor(cdp, "!document.querySelector('.modal-mask')", '关闭药物表单');
    assert.strictEqual(await cdp.eval("document.querySelectorAll('.med-check').length"), 0, '今日核对表里没有停用的药');
    console.log('PASS  已停用的药改开始日期晚于停用日：拦下并说明原因，不会复活回核对表');

    /* ④ 记录时间默认跟着"现在"：页面开过夜也记成今天、记成保存那一刻 */
    await cdp.eval("App.go('records')");
    assert.strictEqual(await cdp.eval("document.querySelector('#bp-dt-chip').textContent"), '现在 · 修改', '默认显示"现在"');
    await cdp.eval('__goto(1, 7, 42);');
    await cdp.eval("document.querySelector('#bp-sys').value = '132'; document.querySelector('#bp-dia').value = '84';");
    await click(cdp, '#bp-save');
    await waitFor(cdp, "document.querySelector('.form-status.saved')", '保存血压');
    assert.deepStrictEqual(await cdp.eval("(() => { const v = Store.vitalsSorted('bp').at(-1); return [v.date, v.time, v.sys]; })()"),
      [await cdp.eval('Store.today()'), '07:42', 132], '没动过时间：按保存那一刻记（跨天也对）');

    /* 草稿切标签再回来：输入还在，时间仍跟着现在走 */
    await cdp.eval("document.querySelector('#bp-sys').value = '126'; document.querySelector('#bp-dia').value = '';");
    await click(cdp, '[data-rectab="glucose"]');
    await click(cdp, '[data-rectab="bp"]');
    assert.strictEqual(await cdp.eval("document.querySelector('#bp-sys').value"), '126', '草稿保留');
    assert.strictEqual(await cdp.eval("document.querySelector('#bp-dt-chip').textContent"), '现在 · 修改', '草稿里没改过的时间不会被冻结成旧时刻');
    /* 手动改成昨天：按他填的记 */
    await click(cdp, '#bp-dt-chip');
    await cdp.eval(`(() => {
      const d = document.querySelector('#bp-date');
      d.value = Store.addDays(Store.today(), -1);
      d.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#bp-sys').value = '128'; document.querySelector('#bp-dia').value = '80';
    })()`);
    assert(await cdp.eval("document.querySelector('#bp-dt-chip').textContent.startsWith('昨天')"), '改过日期后小条显示所选日期');
    await click(cdp, '#bp-save');
    await waitFor(cdp, "Store.data.vitals.bp.length === 2", '保存补记的血压');
    assert.strictEqual(await cdp.eval("Store.data.vitals.bp[0].date"), await cdp.eval('Store.addDays(Store.today(), -1)'), '手动改过的日期按所填保存');

    /* 将来的日期、两格填反：拦在界面上，记录条数不变 */
    await click(cdp, '#bp-dt-chip');
    await cdp.eval(`(() => {
      const d = document.querySelector('#bp-date');
      d.value = Store.addDays(Store.today(), 1);
      d.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#bp-sys').value = '130'; document.querySelector('#bp-dia').value = '80';
    })()`);
    await click(cdp, '#bp-save');
    await waitFor(cdp, "document.querySelector('#bp-date-error')", '将来日期报错');
    await cdp.eval("App.go('today'); App.go('records');");
    await cdp.eval("document.querySelector('#bp-sys').value = '80'; document.querySelector('#bp-dia').value = '120';");
    await click(cdp, '#bp-save');
    await waitFor(cdp, "document.querySelector('#bp-dia-error')", '高低压填反报错');
    assert.strictEqual(await cdp.eval('Store.data.vitals.bp.length'), 2, '被拦下的不得写入');
    /* 把刚才选的将来日期改回今天、读数填对，保存后表单回到"跟着现在走" */
    await cdp.eval(`(() => {
      const d = document.querySelector('#bp-date');
      d.value = Store.today();
      d.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#bp-sys').value = '120'; document.querySelector('#bp-dia').value = '80';
    })()`);
    await click(cdp, '#bp-save');
    await waitFor(cdp, 'Store.data.vitals.bp.length === 3', '改正后保存成功');
    assert.strictEqual(await cdp.eval("document.querySelector('#bp-dt-chip').textContent"), '现在 · 修改', '保存后新表单回到跟着现在走');

    console.log('PASS  记录时间跟着"现在"：跨天按保存时刻记；手改按所填；将来日期/高低压填反被拦');

    /* ⑤ 设置：身高按米填、发病日期在将来，都要拦下 */
    await click(cdp, '#btn-settings');
    await delay(260);
    await cdp.eval("document.querySelector('#set-height').value = '1.7';");
    await click(cdp, '#set-save');
    await waitFor(cdp, "document.querySelector('.save-feedback')?.textContent.includes('厘米')", '身高单位报错');
    await cdp.eval("document.querySelector('#set-height').value = '168'; document.querySelector('#set-stroke-date').value = Store.addDays(Store.today(), 3);");
    await click(cdp, '#set-save');
    await waitFor(cdp, "document.querySelector('.save-feedback')?.textContent.includes('不能晚于今天')", '发病日期报错');
    await cdp.eval("document.querySelector('#set-stroke-date').value = Store.addDays(Store.today(), -20);");
    await click(cdp, '#set-save');
    await waitFor(cdp, "!document.querySelector('.modal-mask')", '合法设置保存');
    assert.strictEqual(await cdp.eval('Store.data.profile.height'), '168', '合法身高保存');
    console.log('PASS  设置：身高按米填、发病日期在将来都被拦下');
    /* 设置里下载备份：记下日期并就地刷新那一行，不能冲掉设置里还没保存的输入 */
    await click(cdp, '#btn-settings');
    await delay(260);
    assert(await cdp.eval("document.querySelector('#backup-age').textContent.includes('还没有下载过备份')"), '有记录但没备份过时提示');
    await cdp.eval("document.querySelector('#set-name').value = '没保存的称呼';");
    await click(cdp, '#set-backup');
    await waitFor(cdp, "document.querySelector('#backup-plain')", '打开备份提醒');
    await delay(260);
    await click(cdp, '#backup-plain');
    await waitFor(cdp, "document.querySelectorAll('.modal-mask').length === 1 && document.querySelector('#set-name')", '下载后回到设置');
    assert(await cdp.eval("document.querySelector('#backup-age').textContent.includes('上次下载备份：今天')"), '下载后就地显示今天');
    assert.strictEqual(await cdp.eval("document.querySelector('#set-name').value"), '没保存的称呼', '下载备份不冲掉设置里未保存的输入');
    await click(cdp, '.modal-mask:not([inert]) .modal-close');
    await waitFor(cdp, "!document.querySelector('.modal-mask')", '关闭设置');
    console.log('PASS  下载备份后设置里显示"上次下载备份：今天"，未保存的输入不丢');


    /* ⑥ 计时：锁屏期间时钟走了、定时器没走——回来必须按真实时间算 */
    await cdp.eval("App.go('train')");
    const timerEx = await cdp.eval("EXERCISES.find(e => e.mode.type === 'timer' && document.querySelector('[data-ex=\"' + e.id + '\"]'))?.id");
    const total = await cdp.eval(`EXERCISES.find(e => e.id === '${timerEx}').mode.seconds`);
    await click(cdp, `[data-ex="${timerEx}"]`);
    await waitFor(cdp, "document.querySelector('#timer-toggle')", '打开计时训练');
    await waitFor(cdp, '__wake.active === 1', '训练页打开时请求屏幕常亮');
    assert.strictEqual(await cdp.eval('__audio.created'), 1, '打开训练页时（点按里）就建好提示音');
    await click(cdp, '#timer-toggle');
    await cdp.eval('__shift(100000)');
    const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    await waitFor(cdp, `document.querySelector('#timer-num').textContent === '${mmss(total - 100)}'`, '时钟走 100 秒后剩余时间同步');
    await cdp.eval('__setVisible(false)');
    await cdp.eval(`__shift(${(total - 100 + 30) * 1000})`);
    const oscBefore = await cdp.eval('__audio.oscillators');
    await cdp.eval('__setVisible(true)');
    await waitFor(cdp, "document.querySelector('#timer-plain').textContent === '时间到了'", '锁屏期间到点，回来报时间到');
    assert.strictEqual(await cdp.eval("document.querySelector('#timer-num').textContent"), '0:00', '剩余归零');
    assert(await cdp.eval(`__audio.oscillators > ${oscBefore}`), '到点响提示音（复用点按时解锁的那个音频）');
    assert.strictEqual(await cdp.eval('__audio.created'), 1, '不为每一声新建音频（iOS 上新建的不响）');
    await click(cdp, '#timer-toggle');
    await delay(400);
    assert.strictEqual(await cdp.eval("document.querySelector('#timer-num').textContent"), mmss(total), '到点后再点：从头计，而不是立刻又"时间到"');
    await click(cdp, '#trainer-emergency');
    await waitFor(cdp, "document.querySelector('.emergency-view')", '打开急救');
    const paused = await cdp.eval("document.querySelector('#timer-num').textContent");
    await cdp.eval('__shift(20000)');
    await delay(400);
    assert.strictEqual(await cdp.eval("document.querySelector('#timer-num').textContent"), paused, '急救覆盖时计时暂停（时钟走了也不动）');
    await click(cdp, '.modal-mask:not([inert]) .modal-close');
    await waitFor(cdp, "!document.querySelector('.emergency-view')", '关闭急救');
    await click(cdp, '#trainer-back');
    await waitFor(cdp, "!document.querySelector('#trainer')", '关闭训练页');
    assert.strictEqual(await cdp.eval('__wake.active'), 0, '关闭训练页释放屏幕常亮');
    assert(await cdp.eval('__audio.closed >= 1'), '关闭训练页释放音频');
    console.log('PASS  计时按真实时间走：锁屏回来报时间到并响铃；再计一次从头；急救暂停；常亮随训练页开关');

    /* ⑦ 两个页面同开：一边记了，另一边自动跟上；有浮层开着时等关了再重画 */
    const other = await openPage(port, caseURL('other', 'records'));
    pages.push(other);
    await cdp.eval("App.go('records')");
    const count1 = await cdp.eval('Store.data.vitals.bp.length');
    await other.eval("Store.addVital('bp', { date: Store.today(), time: '06:30', sys: 141, dia: 91, pulse: '' })");
    await waitFor(cdp, `Store.data.vitals.bp.length === ${count1 + 1}`, '另一页记的血压同步过来');
    await waitFor(cdp, `document.querySelector('[data-hist="bp"]').textContent.includes('（${count1 + 1} 条）')`, '本页记录区按新数据重画');
    await cdp.eval("document.querySelector('#bp-sys').value = '133'; document.querySelector('#bp-dia').value = '83';");
    await click(cdp, '#bp-save');
    await waitFor(cdp, `Store.data.vitals.bp.length === ${count1 + 2}`, '同步后本页保存不再被冲突拦下');
    assert.strictEqual(await cdp.eval('Store.storageStatus()'), null, '没有残留的冲突提示');

    await click(cdp, '#btn-settings');
    await delay(260);
    await other.eval("Store.data.profile.name = '另一页的称呼'; Store.save();");
    await waitFor(cdp, "Store.data.profile.name === '另一页的称呼'", '浮层开着时数据也同步');
    assert(await cdp.eval("Boolean(document.querySelector('#set-name'))"), '设置弹窗没有被冲掉');
    await click(cdp, '.modal-mask:not([inert]) .modal-close');
    await waitFor(cdp, "!document.querySelector('.modal-mask')", '关闭设置');
    await cdp.eval("App.go('today')");
    assert(await cdp.eval("document.querySelector('.greet').textContent.includes('另一页的称呼')"), '关掉浮层后页面按新数据重画');
    console.log('PASS  两个页面同开：另一页的记录自动同步，本页再保存不冲突；浮层开着时不被冲掉');

    for (const page of pages) assert.deepStrictEqual(exceptionsOf(page), [], '运行期间不应有未捕获异常');

    /* ⑧ iOS 桌面图标第一次打开：提醒"浏览器里的旧记录不会自动过来" */
    const ios = await openPage(port, caseURL('ios'), `
      Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true });
      Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { configurable: true, get: () => 5 });
      if (!sessionStorage.getItem('cleared')) { localStorage.clear(); sessionStorage.setItem('cleared', '1'); }`);
    pages.push(ios);
    await waitFor(ios, "document.querySelector('#guide-done')", '首次指引');
    assert(await ios.eval("document.querySelector('.guide').textContent.includes('各存各的记录')"), 'iOS 桌面图标首次指引说明存储分开');
    console.log('PASS  iOS 桌面图标首次打开：说明与 Safari 记录分开及搬迁办法');

    console.log('✅ 跨天/锁屏/多页面同步 Chromium 回归全部通过');
  } finally {
    pages.forEach(p => p.close());
    browser.kill('SIGTERM');
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('❌', error.stack || error.message);
  process.exitCode = 1;
});
