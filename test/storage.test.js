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

/* --- 备份导出 / 恢复导入 --- */
const backup = Store.exportBackup();
assert(typeof backup === 'string' && backup.includes('"app": "stroke-rehab-assistant"'), '备份 JSON 应含应用标识');
const parsed = Store.parseBackup(backup);
assert(parsed.data.meds.length === 1 && parsed.data.vitals.bp.length === 2, '备份往返应保留全部数据');
assert(parsed.data.exerciseLog && parsed.data.exerciseLog[t] && parsed.data.exerciseLog[t].includes('bobath'), '备份应含训练打卡');

Store.addMed({ name: '临时药', dose: 'x', times: ['08:00'], note: '' });
assert(Store.data.meds.length === 2, '恢复前应新增到2种药');
Store.applyBackup(parsed.data);
assert(Store.data.meds.length === 1, 'applyBackup 应整体覆盖回备份状态');
assert(Store.data.vitals.bp.length === 2, 'applyBackup 后血压记录应保留');

/* 畸形/非备份文件必须被拒绝，且不得破坏当前数据 */
let rejected = 0;
try { Store.parseBackup('not json'); } catch (e) { rejected++; }
try { Store.parseBackup('{"foo":1}'); } catch (e) { rejected++; }
try { Store.parseBackup('{"app":"别的应用","data":"oops"}'); } catch (e) { rejected++; }
assert(rejected === 3, '3 种畸形备份都应抛错，实际拒绝 ' + rejected);
assert(Store.data.meds.length === 1, '解析失败不得破坏现有数据');

/* 部分字段备份：字段级守卫合并 */
const partial = Store.parseBackup('{"app":"stroke-rehab-assistant","data":{"profile":{"name":"老王"}}}');
assert(partial.data.profile.name === '老王' && partial.data.meds.length === 0, '部分备份按字段守卫合并');

/* --- 历史视图数据（训练日历 / 每日明细 / 服药历史） --- */
const rd = Store.recentDates(3);
assert(rd.length === 3 && rd[2] === t && rd[0] === Store.addDays(t, -2), 'recentDates 应旧→新且含今天');

assert(Store.exerciseDaysTotal() === 3, '累计打卡天数应为3，实际 ' + Store.exerciseDaysTotal());
assert(Store.exercisesOn(t).includes('bobath'), 'exercisesOn 应返回当天打卡项');
assert(Store.exercisesOn('1999-01-01').length === 0, '无记录的日期应返回空数组');

const act = Store.activeDates();
assert(act[0] === t && act[act.length - 1] === Store.addDays(t, -2), 'activeDates 应新→旧');

Store.logGame('memory', 18, '翻牌18次');
assert(Store.gamesOn(t).length === 1 && Store.gamesOn(t)[0].game === 'memory', 'gamesOn 应返回当天游戏成绩');
Store.data.gameLog[Store.addDays(t, -9)] = [{ game: 'math', score: 8, detail: '答对8/10' }];
assert(Store.activeDates().includes(Store.addDays(t, -9)), '只有游戏成绩的日期也应算活跃日');
assert(Store.exerciseDaysTotal() === 3, '游戏成绩不应计入训练打卡天数');

const cal = Store.exerciseCalendar(28);
assert(cal.length === 28 && cal[27].date === t, '日历应为28天且以今天结尾');
assert(cal[27].count === 1 && cal[27].games === 1, '今天应有1项训练+1局游戏');
assert(cal[0].count === 0, '4周前无记录应为0');

const ms = Store.medStatusOn(t);
assert(ms.total === 2 && ms.done === 1, '今日应服2次已服1次，实际 ' + ms.done + '/' + ms.total);
assert(ms.items[0].time === '08:00' && ms.items[0].taken === true, '服药明细应按时间排序且带勾选状态');
assert(ms.items[1].time === '20:00' && ms.items[1].taken === false, '未核对的次数 taken 应为 false');
assert(Store.medStatusOn(Store.addDays(t, -3)).done === 0, '没核对过的日期 done 应为0');

const mh = Store.medHistory(14);
assert(mh.length === 14 && mh[0].date === t, 'medHistory 应新→旧且长度为14');

/* --- 同时间记录排序（v0.2.10）：后录入的视为最新 --- */
Store.addVital('bp', { date: '2026-01-01', time: '08:00', sys: 120, dia: 80 });
Store.addVital('bp', { date: '2026-01-01', time: '08:00', sys: 130, dia: 85 });
const sameT = Store.vitalsSorted('bp').filter(v => v.date === '2026-01-01');
assert(sameT.length === 2 && sameT[sameT.length - 1].sys === 130, '同时间记录：后录入的应排最末（视为最新）');

/* --- 个人目标值：默认 + 非法值消毒（v0.2.11） --- */
const tg = Store.data.profile.targets;
assert(tg.bpSys === 140 && tg.bpDia === 90 && tg.gluFast === 7.0 && tg.gluPost === 10.0, '目标值默认应为 140/90、7/10');
Store.data.profile.targets = { bpSys: 'abc', bpDia: 0, gluFast: 7.5, gluPost: -1 };
localStorage.setItem('strokeRehab.v1', JSON.stringify(Store.data));
Store.load();
const tg2 = Store.data.profile.targets;
assert(tg2.bpSys === 140 && tg2.bpDia === 90 && tg2.gluFast === 7.5 && tg2.gluPost === 10.0, '非法目标值应回落默认');

/* --- 损坏数据兜底 --- */
localStorage.setItem('strokeRehab.v1', '{broken json');
Store.load();
assert(Store.data.meds.length === 0, '损坏数据应回落到空默认值');

if (failed) {
  console.error(`❌ ${failed} 项断言失败`);
  process.exit(1);
}
console.log('✅ storage.js 全部断言通过');
