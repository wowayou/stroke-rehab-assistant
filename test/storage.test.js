/* ============================================================
   storage.js 数据层单元测试（Node 直接运行，无需浏览器）
   运行：node test/storage.test.js
   通过标准：输出「✅ storage.js 全部断言通过」，进程退出码 0
   ============================================================ */

const fs = require('fs');
const path = require('path');

/* stub 浏览器环境 */
const _mem = {};
global.localStorage = {
  getItem: k => (_mem[k] !== undefined ? _mem[k] : null),
  setItem: (k, v) => { _mem[k] = v; },
  removeItem: k => { delete _mem[k]; },
};
global.window = {};

/* storage.js 用 const 声明，eval 作用域不外泄，需手动挂到全局 */
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'storage.js'), 'utf8');
eval(src + '; globalThis.Store = Store;');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error('FAIL:', msg); }
}

Store.load();
const t = Store.today();

/* --- 训练打卡与连续天数 --- */
Store.logExercise('bobath');
Store.logExercise('bobath');
assert(Store.exercisesDoneToday().length === 1, '同一天重复打卡应去重');
assert(Store.streak() === 1, 'streak 应为1，实际 ' + Store.streak());
Store.data.exerciseLog[Store.addDays(t, -1)] = ['x'];
Store.data.exerciseLog[Store.addDays(t, -2)] = ['y'];
assert(Store.streak() === 3, 'streak 应为3，实际 ' + Store.streak());

/* --- 用药登记与核对 --- */
Store.addMed({ name: '阿司匹林肠溶片', dose: '100mg 1片', times: ['08:00', '20:00'], note: '' });
const med = Store.data.meds[0];
assert(Store.medProgressToday().total === 2, '今日应服2次');
Store.toggleMed(med.id, '08:00');
assert(Store.medProgressToday().done === 1, '已服1次');
assert(Store.isMedTaken(med.id, '08:00'), 'isMedTaken 应为 true');
Store.toggleMed(med.id, '08:00');
assert(Store.medProgressToday().done === 0, '取消打勾');
Store.toggleMed(med.id, '08:00');
assert(Store.adherence7d() !== null, '有药物时依从率不应为 null');

/* --- 健康记录 --- */
Store.addVital('bp', { date: t, time: '08:00', sys: 135, dia: 85, pulse: 72 });
assert(Store.bpToday() === true, 'bpToday');
Store.addVital('bp', { date: Store.addDays(t, -1), time: '08:00', sys: 150, dia: 95, pulse: '' });
const sorted = Store.vitalsSorted('bp');
assert(sorted[0].sys === 150 && sorted[1].sys === 135, 'vitalsSorted 应按日期升序');
Store.removeVital('bp', sorted[0].id);
assert(Store.data.vitals.bp.length === 1, 'removeVital');
Store.addVital('bp', { date: Store.addDays(t, -1), time: '08:00', sys: 150, dia: 95, pulse: '' });

/* --- 康复天数 --- */
Store.data.profile.strokeDate = Store.addDays(t, -30);
assert(Store.rehabDay() === 31, 'rehabDay 应为31（发病日算第1天），实际 ' + Store.rehabDay());
Store.data.profile.strokeDate = Store.addDays(t, 5);
assert(Store.rehabDay() === null, '未来的发病日期应返回 null');
Store.data.profile.strokeDate = Store.addDays(t, -30);

/* --- 导出与持久化往返 --- */
const rpt = Store.exportReport();
assert(rpt.includes('135/85') && rpt.includes('阿司匹林'), '导出报告应包含血压和药名');
Store.save();
Store.load();
assert(Store.data.meds.length === 1 && Store.data.vitals.bp.length === 2, '持久化往返');

/* --- 损坏数据兜底 --- */
localStorage.setItem('strokeRehab.v1', '{broken json');
Store.load();
assert(Store.data.meds.length === 0, '损坏数据应回落到空默认值');

if (failed) {
  console.error(`❌ ${failed} 项断言失败`);
  process.exit(1);
}
console.log('✅ storage.js 全部断言通过');
