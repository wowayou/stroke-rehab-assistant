/* 可选密码加密备份测试：Node 直接运行，零依赖。 */
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('crypto');

if (!global.crypto) global.crypto = webcrypto;
if (!global.btoa) global.btoa = s => Buffer.from(s, 'binary').toString('base64');
if (!global.atob) global.atob = s => Buffer.from(s, 'base64').toString('binary');

const mem = {};
global.localStorage = {
  getItem: key => mem[key] ?? null,
  setItem: (key, value) => { mem[key] = value; },
  removeItem: key => { delete mem[key]; },
};

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'storage.js'), 'utf8');
eval(src + '; globalThis.Store = Store;');

let failed = 0;
function assert(condition, message) {
  if (!condition) { failed++; console.error('FAIL:', message); }
}
async function rejects(task, expected, message) {
  try { await task(); }
  catch (e) { assert(e.message.includes(expected), `${message}（实际：${e.message}）`); return; }
  assert(false, message);
}

(async () => {
  Store.load();
  Store.data.profile.name = '加密测试患者';
  Store.data.meds = [{ id: 'med1', name: '测试药', dose: '1片', times: ['08:00'], note: '', from: Store.today(), to: '', previousCourseId: '' }];
  Store.save();

  assert(Store.encryptionSupported(), '测试环境应支持 Web Crypto');
  const password = '仅用于测试-12345678';
  const encrypted = await Store.exportEncryptedBackup(password);
  const outer = JSON.parse(encrypted);
  assert(outer.app === 'stroke-rehab-assistant' && outer.encrypted === true, '加密备份应带应用和加密标识');
  assert(outer.encryption.name === 'AES-GCM' && outer.encryption.kdf === 'PBKDF2' && outer.encryption.hash === 'SHA-256', '算法元数据应固定为 PBKDF2/SHA-256 + AES-GCM');
  assert(outer.encryption.iterations === 600000, 'PBKDF2 次数应固定为 600000');
  assert(!encrypted.includes('加密测试患者') && !encrypted.includes('测试药') && !encrypted.includes(password), '密文不得泄露健康数据或密码');
  assert(Store.isEncryptedBackup(encrypted) === true, '应识别加密备份');
  assert(Store.isEncryptedBackup(Store.exportBackup()) === false, '旧明文备份仍应识别为普通备份');
  await rejects(() => Store.parseEncryptedBackup(encrypted + ' '.repeat(Store.backupLimits.maxEncryptedBytes), password),
    '超过 8MB', '大于 8MB 的加密文件不能被错误地按 5MB 计数');
  assert(Store.isEncryptedBackup(encrypted + ' '.repeat(6 * 1024 * 1024)), '5～8MB 的合法加密文件仍能识别');

  const parsed = await Store.parseEncryptedBackup(encrypted, password);
  assert(parsed.data.profile.name === '加密测试患者' && parsed.data.meds[0].name === '测试药', '正确密码应完整恢复数据');

  await rejects(() => Store.parseEncryptedBackup(encrypted, '错误密码-12345678'), '密码不正确', '错误密码必须被拒绝');
  const tampered = JSON.parse(encrypted);
  const first = tampered.ciphertext[0];
  tampered.ciphertext = (first === 'A' ? 'B' : 'A') + tampered.ciphertext.slice(1);
  await rejects(() => Store.parseEncryptedBackup(JSON.stringify(tampered), password), '文件已损坏', '密文被篡改必须被 AES-GCM 拒绝');

  const changedIterations = JSON.parse(encrypted);
  changedIterations.encryption.iterations = 999999999;
  await rejects(() => Store.parseEncryptedBackup(JSON.stringify(changedIterations), password), '版本不兼容', '文件不能自行提高 PBKDF2 次数');
  await rejects(() => Store.exportEncryptedBackup('太短'), '至少需要 8 个字符', '过短密码不得生成加密备份');

  const encryptedAgain = await Store.exportEncryptedBackup(password);
  const outerAgain = JSON.parse(encryptedAgain);
  assert(outerAgain.encryption.salt !== outer.encryption.salt && outerAgain.encryption.iv !== outer.encryption.iv, '每次导出必须使用新的随机盐和 IV');

  const before = JSON.stringify(Store.data);
  await rejects(() => Store.parseEncryptedBackup(encrypted, '仍然错误-12345678'), '密码不正确', '解密失败不得进入恢复流程');
  assert(JSON.stringify(Store.data) === before, '解密失败不得改变当前数据');

  if (failed) {
    console.error(`❌ ${failed} 项加密备份断言失败`);
    process.exit(1);
  }
  console.log('✅ 加密备份全部断言通过（AES-GCM/PBKDF2、错误口令、篡改、随机盐/IV、明文兼容）');
})().catch(e => {
  console.error('❌ 加密备份测试异常：', e);
  process.exit(1);
});
