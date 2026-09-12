/* 大备份压力回归：接近上限的数据反复解析、加密、解密、恢复和撤销。 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { webcrypto } = require('crypto');

if (!global.crypto) global.crypto = webcrypto;
if (!global.btoa) global.btoa = value => Buffer.from(value, 'binary').toString('base64');
if (!global.atob) global.atob = value => Buffer.from(value, 'base64').toString('binary');

const memory = {};
global.localStorage = {
  getItem: key => memory[key] ?? null,
  setItem: (key, value) => { memory[key] = String(value); },
  removeItem: key => { delete memory[key]; },
};

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'storage.js'), 'utf8');
eval(source + '; globalThis.Store = Store;');

function buildLargeState(detailSize) {
  Store.load();
  const data = Store.data;
  data.profile.name = '压力测试';
  data.profile.strokeDate = Store.addDays(Store.today(), -365);
  data.meds = Array.from({ length: Store.backupLimits.meds }, (_, i) => ({
    id: `med_${i}`,
    name: `测试药物${i}`,
    dose: '按医嘱服用',
    times: ['08:00', '12:00', '20:00'],
    note: '仅用于压力测试'.repeat(20),
    from: Store.addDays(Store.today(), -365),
    to: '',
    previousCourseId: '',
  }));
  data.vitals.bp = Array.from({ length: Store.backupLimits.vitalsPerKind }, (_, i) => ({
    id: `bp_${i}`, date: Store.addDays(Store.today(), -(i % 3650)), time: '08:00',
    sys: 120 + i % 20, dia: 70 + i % 15, pulse: 60 + i % 30,
  }));
  data.vitals.glucose = Array.from({ length: Store.backupLimits.vitalsPerKind }, (_, i) => ({
    id: `glu_${i}`, date: Store.addDays(Store.today(), -(i % 3650)), time: '08:30',
    gtype: i % 2 ? '空腹' : '餐后2小时', value: 5 + (i % 40) / 10,
  }));
  data.vitals.weight = Array.from({ length: Store.backupLimits.vitalsPerKind }, (_, i) => ({
    id: `wt_${i}`, date: Store.addDays(Store.today(), -(i % 3650)), value: 55 + (i % 100) / 10,
  }));

  const detail = 'x'.repeat(detailSize);
  for (let d = 0; d < 70; d++) {
    const date = Store.addDays(Store.today(), -d);
    data.exerciseLog[date] = Array.from({ length: 50 }, (_, i) => `exercise_${i}`);
    data.gameLog[date] = Array.from({ length: Store.backupLimits.gamesPerDay }, (_, i) => ({
      game: i % 2 ? 'memory' : 'attention', score: i, detail, time: '09:00',
    }));
    data.medLog[date] = Object.fromEntries(data.meds.flatMap(m => m.times.map(time => [`${m.id}@${time}`, true])));
  }
  data.ui.guideSeen = true;
  return data;
}

(async () => {
  let plain, selectedDetailSize;
  for (const detailSize of [260, 320, 380, 440]) {
    buildLargeState(detailSize);
    const candidate = Store.exportBackup();
    if (Buffer.byteLength(candidate) < Store.backupLimits.maxBytes) {
      plain = candidate;
      selectedDetailSize = detailSize;
    }
  }
  assert(plain, '应能构造低于 5MB 上限的大备份');
  buildLargeState(selectedDetailSize);
  plain = Store.exportBackup();
  const plainBytes = Buffer.byteLength(plain);
  assert(plainBytes >= 3 * 1024 * 1024, `压力备份应至少 3MB，实际 ${plainBytes}`);
  assert(plainBytes < Store.backupLimits.maxBytes, '压力备份不得越过明文上限');

  const parseStart = performance.now();
  let parsed;
  for (let i = 0; i < 12; i++) parsed = Store.parseBackup(plain);
  const parseMs = performance.now() - parseStart;
  assert(parsed.data.vitals.bp.length === 5000 && parsed.data.gameLog[Store.today()].length === 100,
    '大备份解析后记录数量应完整');

  const originalName = Store.data.profile.name;
  const password = '压力测试可信密码-2026';
  const encryptTimes = [], decryptTimes = [];
  for (let i = 0; i < 3; i++) {
    let started = performance.now();
    const encrypted = await Store.exportEncryptedBackup(password);
    encryptTimes.push(performance.now() - started);
    assert(Buffer.byteLength(encrypted) < Store.backupLimits.maxEncryptedBytes, '加密大备份不得超过 8MB');

    started = performance.now();
    const decrypted = await Store.parseEncryptedBackup(encrypted, password);
    decryptTimes.push(performance.now() - started);
    assert(decrypted.data.vitals.glucose.length === 5000, '大备份加密往返不得丢失健康记录');
    assert(Store.data.profile.name === originalName, '仅解密预览不得改变当前数据');
  }

  for (let i = 0; i < 3; i++) {
    const imported = Store.parseBackup(plain).data;
    imported.profile.name = `恢复压力${i}`;
    assert(Store.applyBackup(imported), `第 ${i + 1} 次大备份恢复应成功`);
    assert(Store.data.profile.name === `恢复压力${i}`, '恢复后应是导入数据');
    assert(Store.undoLastRestore(), `第 ${i + 1} 次大备份恢复应可撤销`);
    assert(Store.data.profile.name === originalName, '撤销后应回到恢复前数据');
  }

  const maxEncrypt = Math.max(...encryptTimes);
  const maxDecrypt = Math.max(...decryptTimes);
  assert(maxEncrypt < 30000 && maxDecrypt < 30000, '单次大备份加密或解密不应超过 30 秒');
  console.log(`PASS  大备份 ${(plainBytes / 1024 / 1024).toFixed(2)}MB：解析 12 次 ${(parseMs / 1000).toFixed(2)}s`);
  console.log(`PASS  加密/解密各 3 次：最慢 ${(maxEncrypt / 1000).toFixed(2)}s / ${(maxDecrypt / 1000).toFixed(2)}s`);
  console.log('PASS  大备份恢复/撤销连续 3 轮，数据完整');
  console.log('✅ 备份压力回归全部通过');
})().catch(error => {
  console.error('❌ 备份压力回归失败：', error.stack || error.message);
  process.exit(1);
});
