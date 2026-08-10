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

/* --- 枚举型偏好消毒（v0.2.13 朗读语速 / 字号） --- */
assert(Store.data.profile.speechRate === 'slow', '朗读语速默认应为 slow，实际 ' + Store.data.profile.speechRate);
Store.data.profile.speechRate = 'turbo';        // 非法值
Store.data.profile.font = 'huge';               // 非法值
localStorage.setItem('strokeRehab.v1', JSON.stringify(Store.data));
Store.load();
assert(Store.data.profile.speechRate === 'slow', '非法语速应回落 slow，实际 ' + Store.data.profile.speechRate);
assert(Store.data.profile.font === 'normal', '非法字号应回落 normal，实际 ' + Store.data.profile.font);
Store.data.profile.speechRate = 'fast';
localStorage.setItem('strokeRehab.v1', JSON.stringify(Store.data));
Store.load();
assert(Store.data.profile.speechRate === 'fast', '合法语速应保留');
/* 旧备份没有 speechRate 字段时也要能回落 */
const legacy = JSON.parse(JSON.stringify(Store.data));
delete legacy.profile.speechRate;
localStorage.setItem('strokeRehab.v1', JSON.stringify(legacy));
Store.load();
assert(Store.data.profile.speechRate === 'slow', '旧备份缺 speechRate 应回落 slow');

/* --- 少算数 / 正向反馈用的派生数据（v0.2.12） --- */
assert(Store.daysBetween('2026-03-01', '2026-03-04') === 3, 'daysBetween 应为3，实际 ' + Store.daysBetween('2026-03-01', '2026-03-04'));
assert(Store.daysBetween('2026-03-04', '2026-03-04') === 0, '同一天 daysBetween 应为0');

/* bestStreak / lastExerciseDate：用一份干净的打卡记录单独验证 */
Store.data.exerciseLog = {};
assert(Store.bestStreak() === 0, '无打卡时 bestStreak 应为0');
assert(Store.lastExerciseDate() === null, '无打卡时 lastExerciseDate 应为 null');
['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-08', '2026-03-09'].forEach(d => {
  Store.data.exerciseLog[d] = ['bobath'];
});
assert(Store.bestStreak() === 3, 'bestStreak 应取最长的一段(3)，实际 ' + Store.bestStreak());
assert(Store.lastExerciseDate() === '2026-03-09', 'lastExerciseDate 应为最后一天，实际 ' + Store.lastExerciseDate());
Store.data.exerciseLog['2026-03-10'] = [];
assert(Store.lastExerciseDate() === '2026-03-09', '空数组的日期不应算作打卡日');
assert(Store.bestStreak() === 3, '空数组的日期不应接长连续段');

/* medFullDays：只统计有应服次数的天数，全部核对才算"全吃到" */
Store.data.meds = [];
Store.data.medLog = {};
assert(Store.medFullDays(7).days === 0, '没有药物时 medFullDays.days 应为0');
Store.addMed({ name: '阿司匹林肠溶片', dose: '100mg', times: ['08:00', '20:00'] });
const mid = Store.data.meds[0].id;
/* 新登记的药默认 from=今天：登记之前的日子不该算漏服 */
assert(Store.data.meds[0].from === t, '新增药物应默认 from=今天，实际 ' + Store.data.meds[0].from);
assert(Store.medFullDays(7).days === 1, '今天才登记的药：只有今天该计入，实际 ' + Store.medFullDays(7).days);
/* 把开始日期往前挪，才覆盖整个 7 天窗口 */
Store.updateMed(mid, { from: Store.addDays(t, -10) });
Store.toggleMed(mid, '08:00');
Store.toggleMed(mid, '20:00');
Store.toggleMed(mid, '08:00', Store.addDays(t, -1));   // 昨天只吃了一次
const fd = Store.medFullDays(7);
assert(fd.days === 7, '有药物时 7 天都应计入，实际 ' + fd.days);
assert(fd.full === 1, '只有今天全部核对，full 应为1，实际 ' + fd.full);

/* --- 停药/恢复（v0.2.15）：停药不删记录，且不再算漏服 --- */
assert(Store.activeMeds().length === 1 && Store.stoppedMeds().length === 0, '停药前：1 个在吃、0 个停用');
assert(Store.medsOn(t).length === 1, '今天应有 1 种在吃的药');
assert(Store.medsOn(Store.addDays(t, -20)).length === 0, 'from 之前的日期不应算这种药');

const stopDay = Store.addDays(t, -3);
Store.stopMed(mid, stopDay);              // 吃到 3 天前为止
assert(Store.isMedStopped(Store.data.meds[0]), 'stopMed 后应标记为已停用');
assert(Store.data.meds.length === 1, '停药**不能删除**记录（复诊要说清吃过什么）');
assert(Store.activeMeds().length === 0 && Store.stoppedMeds().length === 1, '停药后：0 个在吃、1 个停用');
assert(Store.medsOn(stopDay).length === 1, '停药当天仍算在吃（to 含当天）');
assert(Store.medsOn(Store.addDays(t, -2)).length === 0, '停药之后的日期不应再算这种药');
assert(Store.medProgressToday().total === 0, '停用的药不应出现在今日应服次数里');
assert(Store.medStatusOn(t).total === 0, '停用后今天的应服次数应为0（不再天天显示漏服）');
assert(Store.medStatusOn(stopDay).total === 2, '停药当天的应服次数仍应为2');
const fdStop = Store.medFullDays(7);
assert(fdStop.days === 4, '停药后 7 天窗口内只有 4 天该计入（今天往前到停药日），实际 ' + fdStop.days);
/* 导出报告要把停用的药单独列出来，并写明吃到哪天 */
const repStop = Store.exportReport();
assert(/已停用的药/.test(repStop), '导出报告应有「已停用的药」小节');
assert(new RegExp('至 ' + stopDay + ' 停用').test(repStop), '导出报告应写明停用日期');

Store.resumeMed(mid, Store.addDays(t, -10));
assert(!Store.isMedStopped(Store.data.meds[0]), 'resumeMed 后应恢复为在吃');
assert(Store.medProgressToday().total === 2, '恢复服用后应重新进入今日核对');
assert(!/已停用的药/.test(Store.exportReport()), '没有停用药物时报告不应出现该小节');
/* 缺 from/to 的旧数据：视为"一直在吃"，保持既有行为 */
Store.data.meds = [{ id: 'legacy', name: '旧数据药', times: ['08:00'] }];
assert(Store.medsOn(Store.addDays(t, -100)).length === 1, '旧数据（无 from/to）应视为一直在吃');
assert(Store.activeMeds().length === 1, '旧数据应算在吃');

/* vitalDelta：应用替患者做减法 */
Store.data.vitals.bp = [];
assert(Store.vitalDelta('bp') === null, '不足两条时 vitalDelta 应为 null');
Store.addVital('bp', { date: '2026-02-01', time: '08:00', sys: 130, dia: 80 });
Store.addVital('bp', { date: '2026-02-02', time: '08:00', sys: 145, dia: 76 });
const dbp = Store.vitalDelta('bp');
assert(dbp.sys === 15 && dbp.dia === -4, 'bp delta 应为 +15/-4，实际 ' + dbp.sys + '/' + dbp.dia);
assert(dbp.prevDate === '2026-02-01', 'delta 应带上一条的日期');
Store.data.vitals.weight = [];
Store.addVital('weight', { date: '2026-02-01', value: 62.5 });
Store.addVital('weight', { date: '2026-02-08', value: 62.1 });
assert(Store.vitalDelta('weight').value === -0.4, '体重 delta 应为 -0.4，实际 ' + Store.vitalDelta('weight').value);

/* --- 损坏数据兜底 --- */
localStorage.setItem('strokeRehab.v1', '{broken json');
Store.load();
assert(Store.data.meds.length === 0, '损坏数据应回落到空默认值');

if (failed) {
  console.error(`❌ ${failed} 项断言失败`);
  process.exit(1);
}
console.log('✅ storage.js 全部断言通过');
