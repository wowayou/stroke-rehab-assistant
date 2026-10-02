/* ============================================================
   离线缓存（Service Worker）：没网、网络差、pages.dev 偶发打不开时，
   从桌面图标/收藏夹进来也能用。只缓存本站自己的运行文件，不碰任何
   健康数据（数据仍只在 localStorage），不向别处发任何请求。

   策略（改之前先读 docs/DEVELOPMENT.md §6 sw.js）：
   · 页面（index.html）联网优先：能连上就用最新的，医学内容更新后不会一直停在旧版；
     等 SHELL_TIMEOUT 还没回来（国内访问 pages.dev 时常卡住）或连不上，先用缓存里的，
     网络那边到了再悄悄更新缓存，下次打开就是新的。
   · css/js 带 deploy.sh 盖的 ?ver=时间戳：同一个 URL 内容永不变，缓存优先；
     每次拿到新页面，按页面里实际引用的 URL 清掉旧版本。
   · 安装时把整套文件预先缓存好，任何一个取不到就整体安装失败——
     失败的结果是"没有离线缓存"，和没有这个文件时完全一样，不会把站点弄坏。
   ============================================================ */
const CACHE = 'rehab-offline-v1';
const SHELL_TIMEOUT = 4000;
const SCOPE = new URL(self.registration.scope);
const SHELL_KEY = SCOPE.href;                   // 页面统一按站点根存一份
const EXTRA = ['icon.svg'];                     // 页面里没直接引用、manifest 引用的

/* 页面里引用的本站文件（script src / link href），用于预缓存和清理旧版本 */
function assetsOf(html) {
  const urls = new Set(EXTRA.map(p => new URL(p, SCOPE).href));
  for (const m of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/gi)) {
    const u = new URL(m[1], SCOPE);
    if (u.origin === SCOPE.origin) urls.add(u.href);
  }
  return [...urls];
}

/* 缓存里的页面不能是"重定向来的"响应：拿它回应导航请求，浏览器会直接报错 */
async function storable(res) {
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

async function saveShell(cache, res) {
  const html = await res.clone().text();
  const assets = assetsOf(html);
  await Promise.all(assets.map(async url => {
    if (await cache.match(url)) return;
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${url} ${r.status}`);
    await cache.put(url, r);
  }));
  await cache.put(SHELL_KEY, await storable(res));
  /* 只留当前页面用到的版本，旧 ?ver= 的文件删掉，缓存不会越攒越多 */
  const keep = new Set([SHELL_KEY, ...assets]);
  for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const res = await fetch(SHELL_KEY, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`页面 ${res.status}`);
    await saveShell(await caches.open(CACHE), res);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

function isShell(url) {
  return url.origin === SCOPE.origin && (url.pathname === SCOPE.pathname || url.pathname === SCOPE.pathname + 'index.html');
}

async function shell(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(SHELL_KEY);
  /* 页面一到就交给浏览器；更新缓存（要连带取新版 css/js）在后台做，不拖慢打开 */
  const network = fetch(event.request).then(res => {
    if (res.ok && res.type === 'basic') {
      event.waitUntil(saveShell(cache, res.clone()).catch(() => { /* 新版文件没取全：留着旧缓存，下次再试 */ }));
    }
    return res;
  });
  event.waitUntil(network.catch(() => {}));
  if (!cached) return network;
  /* 连不上、超时、服务器 5xx 都先用缓存；重定向（status 0 的 opaqueredirect）照常交给浏览器去跟 */
  const usable = network.then(res => (res.status >= 500 ? Promise.reject(res) : res));
  const timeout = new Promise((_, reject) => setTimeout(reject, SHELL_TIMEOUT));
  try { return await Promise.race([usable, timeout]); }
  catch (_) { return cached; }
}

/* 带 ?ver= 的文件内容永不变：缓存优先。没带版本号的（manifest.json、icon.svg）
   先给缓存、同时后台取新的，下次就是新的——不然改了它们会永远拿旧的。 */
async function asset(event) {
  const { request } = event;
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit && new URL(request.url).searchParams.has('ver')) return hit;
  const refresh = fetch(request).then(res => {
    if (res.ok && res.type === 'basic') return cache.put(request, res.clone()).then(() => res);
    return res;
  });
  if (!hit) return refresh;
  event.waitUntil(refresh.catch(() => {}));
  return hit;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  if (request.mode === 'navigate') {
    if (isShell(url)) event.respondWith(shell(event));
    return;
  }
  if (/\.(?:js|css|svg|json)$/.test(url.pathname) && url.pathname !== SCOPE.pathname + 'sw.js') {
    event.respondWith(asset(event));
  }
});
