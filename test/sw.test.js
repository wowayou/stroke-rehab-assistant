/* 真实 Chromium 回归：离线缓存（sw.js）。
   本地起一个 Node 静态服务器，按仓库里真实的 _headers 规则加响应头（含页面的
   connect-src 'none'），模拟 Cloudflare Pages，逐一验证：
   ① 首次访问后整套文件进缓存；② 断网能打开、两个入口（/ 和 /index.html）都行；
   ③ 网络卡住（国内访问 pages.dev 常见）几秒内回落缓存；④ 重新部署后联网即拿到新版，
   旧版本文件被清掉；⑤ Pages 式 /index.html→/ 重定向照常跟随；⑥ 安装失败（含 sw.js
   被套上禁止联网的 CSP）时没有离线缓存、站点照常可用——"失败=回到没有 sw.js 的样子"。
   运行：node test/sw.test.js */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const RUNTIME = ['index.html', 'manifest.json', 'icon.svg', 'sw.js', 'css', 'js'];

function chromiumBinary() {
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  const versions = fs.readdirSync(cache)
    .filter(name => name.startsWith('chromium_headless_shell-'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!versions.length) throw new Error('未找到 Playwright Chromium，请先安装 Chromium');
  return path.join(cache, versions.at(-1), 'chrome-headless-shell-linux64', 'chrome-headless-shell');
}

/* 按 Cloudflare Pages 的语义解析 _headers：多条规则命中时同名头逗号合并，`! 名` 摘除 */
function parseHeaders(text) {
  const rules = [];
  let cur = null;
  text.split('\n').forEach(line => {
    if (!line.trim() || line.trim().startsWith('#')) return;
    if (!/^\s/.test(line)) { cur = { pattern: line.trim(), set: [], detach: [] }; rules.push(cur); return; }
    const t = line.trim();
    if (t.startsWith('! ')) cur.detach.push(t.slice(2).trim().toLowerCase());
    else { const i = t.indexOf(':'); cur.set.push([t.slice(0, i).trim().toLowerCase(), t.slice(i + 1).trim()]); }
  });
  return pathname => {
    const out = {};
    const hit = rules.filter(r => r.pattern === '/*' || r.pattern === pathname);
    hit.forEach(r => r.set.forEach(([k, v]) => { out[k] = out[k] ? `${out[k]}, ${v}` : v; }));
    hit.forEach(r => r.detach.forEach(k => { delete out[k]; }));
    return out;
  };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };

function startServer(dir, state) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    state.hits.push(url.pathname);
    if (state.mode === 'hang' && (url.pathname === '/' || url.pathname === '/index.html')) return; // 永不回应
    if (state.mode === '500') { res.writeHead(500); res.end('err'); return; }
    if (state.redirectIndex && url.pathname === '/index.html') { res.writeHead(308, { Location: '/' + url.search }); res.end(); return; }
    let file = path.join(dir, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    const headers = { ...parseHeaders(fs.readFileSync(path.join(dir, '_headers'), 'utf8'))(url.pathname), 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' };
    res.writeHead(200, headers);
    res.end(fs.readFileSync(file));
  });
  return new Promise(resolve => server.listen(state.port || 0, '127.0.0.1', () => { state.port = server.address().port; resolve(server); }));
}

class CDP {
  constructor(url) {
    this.nextId = 1; this.pending = new Map(); this.events = [];
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = () => reject(new Error('无法连接 Chromium DevTools')); });
    this.ws.onmessage = event => {
      const m = JSON.parse(event.data);
      if (!m.id) { this.events.push(m); return; }
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
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Chromium DevTools 命令超时：${method}`)); }, 20000);
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
async function waitFor(cdp, expression, label, timeout = 8000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try { if (await cdp.eval(`Boolean(${expression})`)) return; } catch (e) { lastError = e; }
    await delay(50);
  }
  throw new Error(`${label}超时${lastError ? `：${lastError.message}` : ''}`);
}

async function launch() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rehab-sw-'));
  const browser = spawn(chromiumBinary(), ['--headless', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  const wsURL = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chromium 启动超时\n${stderr}`)), 15000);
    browser.stderr.on('data', c => { stderr += c; const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (m) { clearTimeout(timer); resolve(m[1]); } });
  });
  const port = new URL(wsURL).port;
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  return { browser, cdp, profile };
}

async function nav(cdp, url) {
  await cdp.send('Page.navigate', { url });
  await waitFor(cdp, "document.readyState === 'complete'", '页面加载', 15000);
}
const appAlive = (cdp, heading) => waitFor(cdp, `typeof App !== 'undefined' && document.querySelector('#view h1')?.textContent.includes(${JSON.stringify(heading)})`, `应用渲染「${heading}」`);
const cachedURLs = cdp => cdp.eval(`caches.open('rehab-offline-v1').then(c => c.keys()).then(ks => ks.map(k => new URL(k.url).pathname + new URL(k.url).search).sort())`);

function copyApp(dir, { ver = '1', marker = '' } = {}) {
  RUNTIME.forEach(f => fs.cpSync(path.join(root, f), path.join(dir, f), { recursive: true }));
  fs.copyFileSync(path.join(root, '_headers'), path.join(dir, '_headers'));
  let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8').replace(/\?ver=\d+/g, `?ver=${ver}`);
  if (marker) html = html.replace('<title>', `<meta name="build" content="${marker}"><title>`);
  fs.writeFileSync(path.join(dir, 'index.html'), html);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rehab-sw-site-'));
  copyApp(dir);
  const state = { mode: 'normal', hits: [], port: 0 };
  let server = await startServer(dir, state);
  const base = `http://127.0.0.1:${state.port}`;
  const { browser, cdp, profile } = await launch();
  try {
    /* ① 首次访问：注册、安装、接管；整套运行文件进缓存 */
    await nav(cdp, `${base}/?view=today&sw=1`);
    await waitFor(cdp, 'navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(() => true)', '离线缓存安装', 15000);
    await nav(cdp, `${base}/?view=today&sw=1`);
    await waitFor(cdp, 'navigator.serviceWorker.controller', '页面被离线缓存接管', 15000);
    const listed = await cachedURLs(cdp);
    const expected = ['/', '/css/style.css?ver=1', '/icon.svg', '/manifest.json',
      ...['data-exercises', 'data-articles', 'storage', 'charts', 'games', 'figures', 'speech', 'app'].map(n => `/js/${n}.js?ver=1`)].sort();
    assert.deepStrictEqual(listed, expected, '缓存里应正好是页面与它引用的全部运行文件');
    assert(await cdp.eval("document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]') !== null"), '页面自身 CSP 仍在');
    console.log('PASS  首次访问后离线缓存安装，缓存内容正好是整套运行文件（在生产同款 CSP 下）');

    /* ② 断网：两个入口都能打开，数据照常读写 */
    await cdp.eval("Store.data.profile.name = '离线测试'; Store.save()");
    server.closeAllConnections(); await new Promise(r => server.close(r));
    await nav(cdp, `${base}/?view=meds&sw=1`);
    await appAlive(cdp, '用药核对');
    await nav(cdp, `${base}/index.html?view=today&sw=1`);
    await waitFor(cdp, "document.querySelector('.greet')?.textContent.includes('离线测试')", '断网打开桌面入口 index.html 且读到本地数据');
    assert.strictEqual(await cdp.eval("Store.logExercise('bobath')"), true, '断网时照常打卡');
    console.log('PASS  断网：/ 与 /index.html 两个入口都能打开，本地数据照常读写');

    /* ③ 网络卡住不回应：几秒内回落到缓存，不让老人对着白屏等 */
    state.mode = 'hang';
    server = await startServer(dir, state);
    const t0 = Date.now();
    await cdp.send('Page.navigate', { url: `${base}/?view=learn&sw=1` });
    await appAlive(cdp, '康复知识');
    const waited = Date.now() - t0;
    assert(waited < 9000, `网络卡住时应在超时后回落缓存，实际等了 ${waited}ms`);
    console.log(`PASS  网络卡住：${(waited / 1000).toFixed(1)} 秒后用缓存打开`);
    server.closeAllConnections(); await new Promise(r => server.close(r));

    /* ④ 服务器 5xx：用缓存，不显示错误页 */
    state.mode = '500';
    server = await startServer(dir, state);
    await nav(cdp, `${base}/?view=train&sw=1`);
    await appAlive(cdp, '康复训练');
    console.log('PASS  服务器 5xx：用缓存打开');
    server.closeAllConnections(); await new Promise(r => server.close(r));

    /* ⑤ 重新部署（新 ?ver= 与新页面）：联网时第一次打开就是新版；后台把旧版本文件清掉 */
    copyApp(dir, { ver: '2', marker: '新版' });
    state.mode = 'normal';
    server = await startServer(dir, state);
    await nav(cdp, `${base}/?view=today&sw=1`);
    await waitFor(cdp, "document.querySelector('meta[name=build]')?.content === '新版'", '联网时拿到新版页面');
    assert(await cdp.eval("[...document.scripts].every(s => !s.src || s.src.includes('ver=2'))"), '新版页面引用新版脚本');
    await waitFor(cdp, "caches.open('rehab-offline-v1').then(c => c.keys()).then(ks => ks.length && ks.every(k => !k.url.includes('ver=1')) && ks.some(k => k.url.includes('ver=2')))", '旧版本文件被清掉、新版本已缓存', 10000);
    server.closeAllConnections(); await new Promise(r => server.close(r));
    await nav(cdp, `${base}/?view=today&sw=1`);
    await appAlive(cdp, '');
    assert(await cdp.eval("document.querySelector('meta[name=build]')?.content === '新版'"), '更新后断网打开的是新版（缓存跟上了）');
    console.log('PASS  重新部署：联网即新版，旧版本文件清除，之后断网也是新版');

    /* ⑥ Pages 会把 /index.html 308 到 /：桌面图标的 start_url 是 index.html，重定向必须照常跟随 */
    state.redirectIndex = true;
    server = await startServer(dir, state);
    await nav(cdp, `${base}/index.html?view=records&sw=1`);
    await appAlive(cdp, '健康记录');
    assert.strictEqual(await cdp.eval('location.pathname'), '/', '跟随重定向到 /');
    state.redirectIndex = false;
    console.log('PASS  /index.html→/ 的重定向照常跟随（桌面图标入口能拿到新版）');

    const exceptions = cdp.events.filter(e => e.method === 'Runtime.exceptionThrown');
    assert.strictEqual(exceptions.length, 0, '运行期间不应有未捕获异常');
    server.closeAllConnections(); await new Promise(r => server.close(r));
  } finally {
    cdp.close();
    browser.kill('SIGTERM');
    fs.rmSync(profile, { recursive: true, force: true });
    try { server.close(); } catch (_) {}
  }

  /* ⑦ 失败即退化：sw.js 若被套上页面那条禁止联网的 CSP（_headers 写错时就会这样），
     或者某个文件取不到，安装必须失败——没有离线缓存，站点照常能用，绝不能把站点弄坏。 */
  for (const breakIt of ['csp', 'missing']) {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'rehab-sw-broken-'));
    copyApp(dir2);
    if (breakIt === 'csp') fs.writeFileSync(path.join(dir2, '_headers'), fs.readFileSync(path.join(root, '_headers'), 'utf8').replace(/\/sw\.js[\s\S]*$/, ''));
    else fs.rmSync(path.join(dir2, 'icon.svg'));
    const st = { mode: 'normal', hits: [], port: 0 };
    const srv = await startServer(dir2, st);
    const b = await launch();
    try {
      const url = `http://127.0.0.1:${st.port}/?view=today&sw=1`;
      await nav(b.cdp, url);
      await delay(2500);
      await nav(b.cdp, url);
      await delay(800);
      assert(st.hits.includes('/sw.js'), `${breakIt}：确实尝试过注册（否则这条用例什么也没验）`);
      assert.strictEqual(await b.cdp.eval('Boolean(navigator.serviceWorker.controller)'), false, `${breakIt}：安装失败时不得接管页面`);
      assert.strictEqual(await b.cdp.eval("caches.keys().then(k => k.includes('rehab-offline-v1') ? caches.open('rehab-offline-v1').then(c => c.match('/')).then(Boolean) : false)"), false, `${breakIt}：不得留下半套缓存当页面用`);
      await waitFor(b.cdp, "typeof App !== 'undefined' && document.querySelector('.today-hero')", `${breakIt}：站点照常可用`);
      console.log(`PASS  安装失败（${breakIt === 'csp' ? 'sw.js 被套上禁止联网的 CSP' : '有文件取不到'}）：没有离线缓存，站点照常可用`);
    } finally {
      b.cdp.close(); b.browser.kill('SIGTERM');
      fs.rmSync(b.profile, { recursive: true, force: true });
      srv.closeAllConnections(); srv.close();
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('✅ 离线缓存 Chromium 回归全部通过');
})().catch(error => {
  console.error('❌', error.stack || error.message);
  process.exitCode = 1;
});
