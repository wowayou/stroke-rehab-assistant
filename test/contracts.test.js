/* 静态硬约定回归：零依赖、可直接由 Node 运行。 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('js/app.js');
const games = read('js/games.js');
const exercises = read('js/data-exercises.js');
const css = read('css/style.css');
const html = read('index.html');
const headers = read('_headers');
const deploy = read('deploy.sh');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error('FAIL:', msg); }
}

assert(!games.includes('/${TOTAL}'), '患者界面/历史不应重新出现 N/总数 的比分');
assert(!exercises.includes('答对越多越好'), '认知训练文案不应按答对数量施压');
assert(/\.btn\.small\s*\{[^}]*min-height:\s*48px/s.test(css), '小按钮触控高度必须至少 48px');
assert(!/min-height:\s*(?:4[0-7]|[0-3]?\d)px/.test(app), 'app.js 内联交互控件不得低于 48px');
assert(/Content-Security-Policy/.test(html) && /connect-src 'none'/.test(html), '页面必须保留禁止联网的 CSP');
assert(/Content-Security-Policy:/.test(headers) && /connect-src 'none'/.test(headers), 'Pages 响应头必须保留禁止联网的 CSP');
assert(/frame-ancestors 'none'/.test(headers) && /X-Frame-Options: DENY/.test(headers), 'Pages 响应头必须禁止第三方页面嵌入');
assert(/Strict-Transport-Security: max-age=31536000/.test(headers), 'Pages 响应头必须启用 HSTS');
assert(/X-Content-Type-Options: nosniff/.test(headers) && /Referrer-Policy: no-referrer/.test(headers), 'Pages 响应头必须限制内容嗅探与来源泄露');
assert(/Permissions-Policy:.*camera=\(\).*geolocation=\(\).*microphone=\(\)/.test(headers), 'Pages 响应头必须关闭未使用的敏感浏览器能力');
assert(/cp -r[^\n]*\b_headers\b/.test(deploy), '部署包必须包含 Cloudflare Pages 的 _headers 文件');
assert(/data-med="\$\{esc\(m\.id\)\}"/.test(app), '药物动态 id 插入 HTML 前必须转义');
assert(/data-del="\$\{esc\(v\.id\)\}"/.test(app), '健康记录动态 id 插入 HTML 前必须转义');
assert(/备份里有健康隐私/.test(app) && /内容是可以直接阅读的/.test(app), '下载明文备份前必须说明敏感健康信息风险');
assert(/set-backup'\)\.onclick = \(\) => close\.replace\(openBackupWarning\)/.test(app), '备份按钮必须先显示隐私提醒，并复用当前浮层历史条目');
assert(!/unwindDebt/.test(app) && /close\.replace\(openEncryptedBackup\)/.test(app), '连续备份弹窗不得用异步 history.back 后立即 pushState');
assert(/id="set-undo-restore"/.test(app) && /Store\.undoLastRestore\(\)/.test(app), '设置页必须提供一次性的恢复撤销入口');
assert(!/恢复会[^\n]*无法撤销/.test(app) && /可在设置中撤销一次/.test(app), '恢复确认必须说明可撤销一次');
assert(/file\.size > Store\.backupLimits\.maxEncryptedBytes/.test(app), '备份文件大小限制必须与 Store 使用同一配置');
assert(/id="backup-plain"/.test(app) && /id="backup-encrypted"/.test(app), '普通备份应保持主操作，加密备份只作为可选操作');
assert(/密码只用于这份备份，不会保存或上传/.test(app) && /忘记密码后本应用无法恢复/.test(app) && /过于简单的密码仍可能被猜中/.test(app), '加密备份必须准确说明密码不保存、遗忘及弱密码风险');
assert(/Store\.exportEncryptedBackup\(password\.value\)/.test(app) && /Store\.parseEncryptedBackup\(jsonText, input\.value\)/.test(app), '加密导出与恢复必须走 Store 的 Web Crypto 接口');
assert(/name: 'AES-GCM'/.test(read('js/storage.js')) && /kdf: 'PBKDF2'/.test(read('js/storage.js')), '加密备份必须使用 AES-GCM 与 PBKDF2');
assert(!/localStorage\.setItem\([^\n]*(?:password|passphrase)/i.test(read('js/storage.js') + app), '备份密码不得写入 localStorage');

if (failed) {
  console.error(`❌ ${failed} 项静态硬约定失败`);
  process.exit(1);
}
console.log('✅ 静态安全/适老化硬约定全部通过');
