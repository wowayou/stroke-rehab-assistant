/* ============================================================
   storage.js 数据层单元测试（Node 直接运行，无需浏览器）
   运行：node test/storage.test.js
   通过标准：输出「✅ storage.js 全部断言通过」，进程退出码 0
   ============================================================ */

const fs = require('fs');
const path = require('path');

/* stub 浏览器环境 */
const _mem = {};
let failWrites = false;
let failWriteKey = '';
let failReadKey = '';
let failRemoveKey = '';
global.localStorage = {
  getItem: k => {
    if (k === failReadKey) throw new Error('StorageReadError');
    return _mem[k] !== undefined ? _mem[k] : null;
  },
  setItem: (k, v) => {
    if (failWrites || k === failWriteKey) throw new Error('QuotaExceededError');
    _mem[k] = v;
  },
  removeItem: k => {
    if (k === failRemoveKey) throw new Error('StorageRemoveError');
    delete _mem[k];
  },
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
assert(typeof backup === 'string' && JSON.parse(backup).app === 'stroke-rehab-assistant', '备份 JSON 应含应用标识');
const parsed = Store.parseBackup(backup);
assert(parsed.data.meds.length === 1 && parsed.data.vitals.bp.length === 2, '备份往返应保留全部数据');
assert(parsed.data.exerciseLog && parsed.data.exerciseLog[t] && parsed.data.exerciseLog[t].includes('bobath'), '备份应含训练打卡');

Store.addMed({ name: '临时药', dose: 'x', times: ['08:00'], note: '' });
assert(Store.data.meds.length === 2, '恢复前应新增到2种药');
assert(Store.applyBackup(parsed.data) === true, 'applyBackup 应保存恢复点并覆盖数据');
assert(Store.data.meds.length === 1, 'applyBackup 应整体覆盖回备份状态');
assert(Store.data.vitals.bp.length === 2, 'applyBackup 后血压记录应保留');
assert(Store.hasRecoveryBackup() === true, '恢复后应自动保留一个本机恢复点');

/* 撤销也必须是事务：写主数据失败时，保留当前数据和恢复点。 */
const afterRestoreJSON = JSON.stringify(Store.data);
failWriteKey = 'strokeRehab.v1';
assert(Store.undoLastRestore() === false, '撤销写盘失败时应返回 false');
assert(JSON.stringify(Store.data) === afterRestoreJSON, '撤销写盘失败时当前数据不得改变');
assert(Store.hasRecoveryBackup() === true, '撤销失败后恢复点应保留');
failWriteKey = '';
assert(Store.undoLastRestore() === true, '撤销上次恢复应成功');
assert(Store.data.meds.length === 2, '撤销后应回到恢复前的 2 种药');
assert(Store.hasRecoveryBackup() === false, '撤销成功后一次性恢复点应消失');

/* 后续断言继续使用原备份状态。 */
assert(Store.applyBackup(parsed.data) === true, '再次恢复应成功');
assert(Store.data.meds.length === 1, '再次恢复后应为 1 种药');

/* 恢复点读/写失败时，主数据绝不能被覆盖。 */
const beforeBlockedRestore = JSON.stringify(Store.data);
failWriteKey = 'strokeRehab.recovery.v1';
assert(Store.applyBackup(partialData()) === false, '恢复点写入失败时应拒绝恢复');
assert(JSON.stringify(Store.data) === beforeBlockedRestore, '恢复点写入失败时原数据不得改变');
assert(/未覆盖现有数据/.test(Store.backupError()), '恢复点失败应给出不会覆盖的明确提示');
failWriteKey = '';
failReadKey = 'strokeRehab.recovery.v1';
assert(Store.applyBackup(partialData()) === false, '无法读取旧恢复点时应拒绝恢复');
assert(JSON.stringify(Store.data) === beforeBlockedRestore, '恢复点读取失败时原数据不得改变');
failReadKey = '';

/* 畸形/非备份文件必须被拒绝，且不得破坏当前数据 */
let rejected = 0;
try { Store.parseBackup('not json'); } catch (e) { rejected++; }
try { Store.parseBackup('{"foo":1}'); } catch (e) { rejected++; }
try { Store.parseBackup('{"app":"别的应用","data":"oops"}'); } catch (e) { rejected++; }
try { Store.parseBackup('{"app":"stroke-rehab-assistant","schema":99,"data":{}}'); } catch (e) { rejected++; }
assert(rejected === 4, '4 种畸形/不兼容备份都应抛错，实际拒绝 ' + rejected);
assert(Store.data.meds.length === 1, '解析失败不得破坏现有数据');

/* 内部条目也必须消毒：不能让 null/危险属性进入渲染与计算路径 */
const dirty = Store.parseBackup(JSON.stringify({
  app: 'stroke-rehab-assistant', schema: 1, data: {
    profile: { stage: 'flying', font: 'huge', targets: null },
    meds: [null, { id: '\"><img src=x onerror=alert(1)>', name: '测试药', times: ['08:00', '<img>'] }],
    vitals: { bp: [null, { id: 'bp1', date: t, sys: 'oops', dia: 80 }] },
  },
}));
assert(dirty.data.profile.stage === 'sitting' && dirty.data.profile.font === 'normal', '非法 profile 枚举应回落默认');
assert(dirty.data.profile.targets.bpSys === 140, 'null targets 应回落默认');
assert(dirty.data.meds.length === 1 && dirty.data.meds[0].times.length === 1, '药物 null 条目/非法时间应被丢弃');
assert(!/[<>]/.test(dirty.data.meds[0].id), '危险药物 id 应被替换为安全 id');
assert(dirty.data.vitals.bp.length === 0, '非法健康记录应被丢弃');

/* 部分字段备份：字段级守卫合并 */
const partial = Store.parseBackup('{"app":"stroke-rehab-assistant","schema":1,"data":{"profile":{"name":"老王"}}}');
assert(partial.data.profile.name === '老王' && partial.data.meds.length === 0, '部分备份按字段守卫合并');

/* 备份边界：在 JSON.parse 前拒绝超大文件，并严格拒绝超量记录。 */
let oversizedRejected = false, jsonParseCalled = false;
const nativeJSONParse = JSON.parse;
JSON.parse = (...args) => { jsonParseCalled = true; return nativeJSONParse(...args); };
try { Store.parseBackup('x'.repeat(Store.backupLimits.maxBytes + 1)); }
catch (e) { oversizedRejected = /5MB/.test(e.message); }
JSON.parse = nativeJSONParse;
assert(oversizedRejected, '超过 5MB 的备份应被拒绝');
assert(jsonParseCalled === false, '超大备份必须在 JSON.parse 前拒绝');

const envelope = data => JSON.stringify({ app: 'stroke-rehab-assistant', schema: 1, data });
function limitRejected(data, expected) {
  try { Store.parseBackup(envelope(data)); return false; }
  catch (e) { return e.message.includes(expected); }
}
assert(limitRejected({ meds: Array.from({ length: Store.backupLimits.meds + 1 }, () => ({})) }, '药物数量'), '超量药物应被拒绝');
assert(limitRejected({ meds: [{ times: Array(Store.backupLimits.timesPerMed + 1).fill('08:00') }] }, '服药时间'), '单种药超量时间应被拒绝');
assert(limitRejected({ vitals: { bp: Array.from({ length: Store.backupLimits.vitalsPerKind + 1 }, () => ({})) } }, '健康记录'), '超量生命体征应被拒绝');
const tooManyDays = {};
for (let i = 0; i <= Store.backupLimits.logDays; i++) tooManyDays['day-' + i] = [];
assert(limitRejected({ exerciseLog: tooManyDays }, '日期数量'), '超量日志日期应被拒绝');
const tooManyChecks = {};
for (let i = 0; i <= Store.backupLimits.medChecksPerDay; i++) tooManyChecks['med-' + i + '@08:00'] = true;
assert(limitRejected({ medLog: { '2026-01-01': tooManyChecks } }, '服药核对'), '单日超量服药核对应被拒绝');
assert(limitRejected({ exerciseLog: { '2026-01-01': Array(Store.backupLimits.exercisesPerDay + 1).fill('x') } }, '训练记录'), '单日超量训练记录应被拒绝');
assert(limitRejected({ gameLog: { '2026-01-01': Array.from({ length: Store.backupLimits.gamesPerDay + 1 }, () => ({})) } }, '游戏记录'), '单日超量游戏记录应被拒绝');

const reversedTargets = Store.parseBackup(envelope({ profile: { targets: { bpSys: 80, bpDia: 100 } } }));
assert(reversedTargets.data.profile.targets.bpSys === 140 && reversedTargets.data.profile.targets.bpDia === 90, '高低压目标反向时应整组回落默认');

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

/* --- 朗读音色名消毒（v0.2.27）---
   speechVoice 与上面的枚举偏好不同：**不能白名单**。每台机器装的中文音色都不一样
   （iOS `Tingting`、安卓 `Chinese China`、Windows `Microsoft Xiaoxiao Online …`），
   枚举不出来，所以只做类型与长度守卫；本机没有这个音色时由 Speech.pickVoice()
   静默回落到系统默认，存一个陌生名字不会有后果。 */
assert(Store.data.profile.speechVoice === '', '音色默认应为空（跟随系统），实际 ' + JSON.stringify(Store.data.profile.speechVoice));
Store.data.profile.speechVoice = 'Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)';
localStorage.setItem('strokeRehab.v1', JSON.stringify(Store.data));
Store.load();
assert(Store.data.profile.speechVoice === 'Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)',
  '各系统的真实音色名（含空格括号连字符）必须原样保留，不能被消毒掉');
/* 非字符串、超长都要挡住：备份文件是外部输入 */
Store.data.profile.speechVoice = { evil: 1 };
localStorage.setItem('strokeRehab.v1', JSON.stringify(Store.data));
Store.load();
assert(Store.data.profile.speechVoice === '', '非字符串音色名应回落空串');
Store.data.profile.speechVoice = 'x'.repeat(400);
localStorage.setItem('strokeRehab.v1', JSON.stringify(Store.data));
Store.load();
assert(Store.data.profile.speechVoice.length === 120, '超长音色名应截到 120，实际 ' + Store.data.profile.speechVoice.length);
/* 旧备份没有这个字段（v0.2.26 及更早导出的） */
const legacyVoice = JSON.parse(JSON.stringify(Store.data));
delete legacyVoice.profile.speechVoice;
localStorage.setItem('strokeRehab.v1', JSON.stringify(legacyVoice));
Store.load();
assert(Store.data.profile.speechVoice === '', '旧备份缺 speechVoice 应回落空串（跟随系统）');
Store.data.profile.speechVoice = '';
localStorage.setItem('strokeRehab.v1', JSON.stringify(Store.data));
Store.load();

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

/* --- 停药/重新开药：停药不删记录，重新服用保留旧疗程空档 --- */
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

/* 停错时只撤销停用，不创建新疗程 */
assert(Store.undoStopMed(mid) === true, 'undoStopMed 应保存成功');
assert(Store.activeMeds().length === 1 && Store.stoppedMeds().length === 0, '撤销误停应只清空旧疗程的停用状态');
Store.stopMed(mid, stopDay);

const restartDay = Store.addDays(t, -1);
const restarted = Store.restartMed(mid, restartDay);
assert(restarted === true, 'restartMed 应保存成功');
assert(Store.data.meds.length === 2, '重新服用应创建新疗程并保留旧疗程');
assert(Store.stoppedMeds().length === 1 && Store.activeMeds().length === 1, '重新服用后应同时保留旧停用疗程和新疗程');
assert(Store.medsOn(Store.addDays(stopDay, 1)).length === 0, '停药到重新服用之间不应计为应服');
assert(Store.medsOn(restartDay).length === 1 && Store.medProgressToday().total === 2, '新疗程开始后应重新进入核对');
assert(/已停用的药/.test(Store.exportReport()), '重新服用后旧停用疗程仍应保留在报告中');
const oldCourse = Store.stoppedMeds()[0];
assert(Store.canUndoStop(oldCourse.id) === false, '已有后续疗程时旧疗程不应允许撤销停用');
assert(Store.undoStopMed(oldCourse.id) === false, '已有后续疗程时 undoStopMed 应拒绝，避免重复计数');
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

/* --- 持久化失败：必须返回 false 并回滚内存，不能制造“看似已保存” --- */
Store.save();
const beforeFail = Store.data.vitals.weight.length;
failWrites = true;
assert(Store.addVital('weight', { date: '2026-02-09', value: 63 }) === false, '写盘失败时 mutation 应返回 false');
assert(Store.data.vitals.weight.length === beforeFail, '写盘失败后内存数据应回滚到最近一次成功保存');
failWrites = false;

/* 清空全部数据同时清理撤销恢复点，避免旧健康数据残留。 */
assert(Store.applyBackup(Store.data) === true && Store.hasRecoveryBackup() === true, '清空测试前应建立恢复点');
const beforeResetFailure = JSON.stringify(Store.data);
failRemoveKey = 'strokeRehab.recovery.v1';
assert(Store.resetAll() === false, '恢复点无法清理时不应报告清空成功');
assert(JSON.stringify(Store.data) === beforeResetFailure, '恢复点无法清理时现有数据不得改变');
assert(Store.hasRecoveryBackup() === true, '恢复点无法清理时应保留恢复点');
failRemoveKey = '';
assert(Store.resetAll() === true, '清空全部数据应成功');
assert(Store.hasRecoveryBackup() === false, '清空全部数据后恢复点也必须清除');

/* --- 损坏数据兜底 --- */
localStorage.setItem('strokeRehab.v1', '{broken json');
Store.load();
assert(Store.data.meds.length === 0, '损坏数据应回落到空默认值');

/* 原件损坏时只允许显式清空，不得以空默认值覆盖或导出假备份。 */
assert(Store.storageStatus().kind === 'corrupt', '损坏必须可被界面识别');
assert(Store.logExercise('protect-original') === false, '损坏后日常保存应被阻止');
assert(localStorage.getItem('strokeRehab.v1') === '{broken json', '损坏原文必须原样保留');
assert(Store.originalData() === '{broken json', '应可取出原始副本供排查');
let exportRefused = false;
try { Store.exportBackup(); } catch (_) { exportRefused = true; }
assert(exportRefused, '不能把损坏后的空默认值导出为健康备份');
assert(Store.applyBackup(parsed.data) === false, '未处理损坏原件前不能直接恢复覆盖');
assert(Store.resetAll(), '显式清空后可以重新开始');
assert(!Store.storageStatus() && Store.originalData() === null, '清空后解除读取保护');

/* 读取权限失败后，权限恢复也要重新读取原件，不能用空值保存。 */
Store.data.profile.name = '原有记录';
Store.save();
const readableOriginal = localStorage.getItem('strokeRehab.v1');
failReadKey = 'strokeRehab.v1';
Store.load();
assert(Store.storageStatus().kind === 'unavailable', '读取失败须报告权限问题');
failReadKey = '';
assert(Store.save() === false, '未重新读取前仍然禁止覆盖');
assert(localStorage.getItem('strokeRehab.v1') === readableOriginal, '读取失败不改变原件');
Store.load();
assert(Store.data.profile.name === '原有记录' && !Store.storageStatus(), '重新读取后恢复原有记录');

/* 另一页面已保存，当前页面的旧快照不可覆盖它，包括导入/清空。 */
const remoteState = JSON.parse(readableOriginal);
remoteState.profile.name = '另一页的新记录';
const remoteJSON = JSON.stringify(remoteState);
localStorage.setItem('strokeRehab.v1', remoteJSON);
assert(Store.logExercise('stale') === false, '过期页面保存必须失败');
assert(Store.storageStatus().kind === 'conflict', '过期页面应报告冲突');
assert(Store.applyBackup(parsed.data) === false && Store.resetAll() === false, '冲突时恢复和清空同样应拒绝');
assert(localStorage.getItem('strokeRehab.v1') === remoteJSON, '不能覆盖另一页新数据');
Store.load();
assert(Store.logExercise('fresh') === true, '重新读取后可继续保存');

/* 达到容量时明确拒绝新记录，而非静默截断后显示保存成功。 */
Store.data.vitals.weight = Array.from({ length: Store.backupLimits.vitalsPerKind }, (_, i) => ({
  id: 'capacity_' + i, date: t, value: 65,
}));
assert(Store.save(), '上限内记录可保存');
const capacityOriginal = localStorage.getItem('strokeRehab.v1');
assert(Store.addVital('weight', { date: t, value: 70 }) === false, '第 5001 条记录应明确拒绝');
assert(localStorage.getItem('strokeRehab.v1') === capacityOriginal, '超限不能改写已有记录');
assert(Store.data.vitals.weight.length === 5000, '超限失败后内存回滚');
Store.data.vitals.weight.push({ id: 'extra', date: t, value: 70 });
exportRefused = false;
try { Store.exportBackup(); } catch (_) { exportRefused = true; }
assert(exportRefused, '普通导出也要拒绝无法导入的超限备份');
Store.load();

if (failed) {
  console.error(`❌ ${failed} 项断言失败`);
  process.exit(1);
}
console.log('✅ storage.js 全部断言通过');

function partialData() {
  return { profile: { name: '将被拒绝的恢复' } };
}
