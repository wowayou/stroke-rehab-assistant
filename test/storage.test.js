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
/* 今天只勾一半：今天没全核对，不计入统计 → adherence7d 为 null */
assert(Store.adherence7d() === null, '今天只勾一半时依从率应为 null');
Store.toggleMed(med.id, '20:00');
assert(Store.adherence7d() === 100, '今天全核对后依从率应为 100');
Store.toggleMed(med.id, '20:00');   // 还原成"今日2次已服1次"，后面断言仍成立

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

/* medFullDays：只统计“计入日”（total>0 且 过去日/今天已全核对），全部核对才算"全吃到" */
Store.data.meds = [];
Store.data.medLog = {};
assert(Store.medFullDays(7).days === 0, '没有药物时 medFullDays.days 应为0');
Store.addMed({ name: '阿司匹林肠溶片', dose: '100mg', times: ['08:00', '20:00'] });
const mid = Store.data.meds[0].id;
/* 新登记的药 from===trackFrom===今天：登记之前的日子不算漏服 */
assert(Store.data.meds[0].from === t && Store.data.meds[0].trackFrom === t, '新增药物 from 与 trackFrom 都应为今天');
assert(Store.medFullDays(7).days === 0, '今天才登记、未全核对时今天不计入，days 应为0，实际 ' + Store.medFullDays(7).days);
/* 把 from 往前挪到 60 天前：但 trackFrom 仍是今天，登记前的日子仍不算 */
Store.updateMed(mid, { from: Store.addDays(t, -60) });
assert(Store.medStatusOn(Store.addDays(t, -1)).total === 0, '登记前（今天之前）应服次数应为0');
assert(Store.medStatusOn(Store.addDays(t, -1)).beforeTracking === true, '登记前的日子 beforeTracking 应为 true');
assert(Store.toggleMed(mid, '08:00', Store.addDays(t, -1)) === false, '登记前的日子不开放补记，toggleMed 应拒绝');
Store.toggleMed(mid, '08:00');
Store.toggleMed(mid, '20:00');
const fdReg = Store.medFullDays(7);
assert(fdReg.days === 1 && fdReg.full === 1, '登记当天全核对：days===1 && full===1，实际 ' + fdReg.days + '/' + fdReg.full);
/* 显式设 trackFrom=10天前模拟早登记，补记昨天一次后 7 天都计入 */
Store.data.meds[0].trackFrom = Store.addDays(t, -10);
Store.toggleMed(mid, '08:00', Store.addDays(t, -1));   // 昨天只吃了一次
const fd = Store.medFullDays(7);
assert(fd.days === 7, '早登记后 7 天都应计入，实际 ' + fd.days);
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
assert(fdStop.days === 4, '7 天窗口里停药日及之前的 4 天计入，实际 ' + fdStop.days);
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
/* 新疗程 trackFrom=今天：重开日（昨天）在登记前，今天才重新进入核对 */
assert(Store.medStatusOn(restartDay).total === 0 && Store.medStatusOn(restartDay).beforeTracking === true, '新疗程重开日（昨天）在 trackFrom 之前，total===0 且 beforeTracking===true');
assert(Store.medsOn(t).length === 1 && Store.medProgressToday().total === 2, '新疗程今天起重新进入核对');
assert(/已停用的药/.test(Store.exportReport()), '重新服用后旧停用疗程仍应保留在报告中');
const oldCourse = Store.stoppedMeds()[0];
assert(Store.canUndoStop(oldCourse.id) === false, '已有后续疗程时旧疗程不应允许撤销停用');
assert(Store.undoStopMed(oldCourse.id) === false, '已有后续疗程时 undoStopMed 应拒绝，避免重复计数');
/* 缺 from/to 的旧数据：视为"一直在吃"，保持既有行为 */
Store.data.meds = [{ id: 'legacy', name: '旧数据药', times: ['08:00'] }];
assert(Store.medsOn(Store.addDays(t, -100)).length === 1, '旧数据（无 from/to）应视为一直在吃');
assert(Store.activeMeds().length === 1, '旧数据应算在吃');

/* --- v0.2.32 写入前校验：不能"报成功、实际被静默丢掉/改掉" --- */
Store.data.meds = []; Store.data.medLog = {};
Store.save();
/* 停用的药改开始日期晚于停用日：以前 normalizeState 会把 to 清空，药悄悄复活回每日核对 */
assert(Store.addMed({ name: '甲药', dose: '', times: ['08:00'], note: '', from: Store.addDays(t, -20) }), '登记甲药');
const medA = Store.data.meds[0];
assert(Store.stopMed(medA.id, Store.addDays(t, -10)), '停用甲药');
assert(Store.updateMed(medA.id, { from: Store.addDays(t, -5) }) === false, '开始日期晚于停用日期必须拒绝');
assert(/不能晚于停用日期/.test(Store.actionError()), '拒绝要给出原因，实际 ' + Store.actionError());
assert(Store.data.meds[0].to === Store.addDays(t, -10) && Store.activeMeds().length === 0, '被拒绝后停用状态不得改变');
assert(Store.updateMed(medA.id, { from: Store.addDays(t, -15), note: '饭后' }) === true, '合法修改应成功');
assert(Store.updateMed(medA.id, { id: 'hijack' }) === true && Store.data.meds[0].id === medA.id, '补丁不得改写药物 id');
/* 新疗程不能和旧疗程重叠（重叠的日子会被算两遍） */
assert(Store.addMed({ name: '甲药', times: ['08:00'], from: Store.addDays(t, -10), previousCourseId: medA.id }) === false, '新疗程与旧疗程重叠必须拒绝');
assert(Store.addMed({ name: '甲药', times: ['08:00'], from: Store.addDays(t, -9), previousCourseId: medA.id }) === true, '停药次日开始的新疗程应成功');
const medA2 = Store.data.meds[1];
assert(Store.updateMed(medA2.id, { from: Store.addDays(t, -12) }) === false, '编辑新疗程也不能挪到旧疗程里面去');
assert(Store.updateMed(medA.id, { from: Store.addDays(t, -9) }) === false, '旧疗程的开始日期不能挪到新疗程之后');
assert(Store.stopMed(medA.id, Store.addDays(t, -8)) === false, '旧疗程的停用日期不能改到新疗程开始之后（重叠）');
assert(Store.addMed({ name: '  ', times: ['08:00'] }) === false && Store.addMed({ name: '乙药', times: [] }) === false, '没有药名/没有服药时间必须拒绝');
assert(Store.addMed({ name: '乙药', times: ['25:00'] }) === false, '非法服药时间必须拒绝');
assert(Store.data.meds.length === 2, '被拒绝的登记不得写入');
/* 核对只接受当天确实要吃的那一次 */
assert(Store.toggleMed(medA2.id, '08:00', Store.addDays(t, 1)) === false, '不能提前核对明天');
assert(Store.toggleMed(medA2.id, '09:00') === false, '不在服药时间表里的钟点不能核对');
assert(Store.toggleMed(medA.id, '08:00') === false, '已停用的疗程今天不能核对');
assert(Store.toggleMed(medA2.id, '08:00') === true && Store.isMedTaken(medA2.id, '08:00'), '今天在吃的药可以核对');

/* 统计口径（与线上一致，AGENTS 硬约定 8）：今天要全核对完才计入，没到点的不算"没吃到"——
   早上 9 点看"最近 7 天"，不能因为晚上那次还没到点就少一天"全吃到"、拉低完成率 */
Store.data.meds = []; Store.data.medLog = {}; Store.data.medLate = {};
Store.save();
Store.addMed({ name: '丙药', times: ['08:00', '20:00'], from: Store.addDays(t, -10) });
const medC = Store.data.meds[0];
medC.trackFrom = Store.addDays(t, -10);   // 模拟 10 天前就在本应用登记
Store.save();
for (let i = 1; i <= 6; i++) {
  Store.toggleMed(medC.id, '08:00', Store.addDays(t, -i));
  Store.toggleMed(medC.id, '20:00', Store.addDays(t, -i));
}
Store.toggleMed(medC.id, '08:00');            // 今早那次吃了，晚上那次还没到
assert(JSON.stringify(Store.medFullDays(7)) === '{"full":6,"days":6}', '今天没全核对：今天不计入，前 6 天都全吃到，实际 ' + JSON.stringify(Store.medFullDays(7)));
assert(Store.adherence7d() === 100, '今天没全核对时完成率不被晚上那次拉低，实际 ' + Store.adherence7d());
assert(Store.medProgressToday().total === 2 && Store.medProgressToday().done === 1, '今日核对表仍按全天的次数（还差几次没核对）');
Store.toggleMed(medC.id, '20:00');
assert(JSON.stringify(Store.medFullDays(7)) === '{"full":7,"days":7}', '今天全核对后计入');
assert(/近7天服药完成率/.test(Store.exportReport()), '导出报告仍带完成率');

/* 新增健康记录：过不了规范化就拒绝，不能显示"已保存"然后记录消失 */
const bpBefore = Store.data.vitals.bp.length;
assert(Store.addVital('bp', { date: '20255-01-01', time: '08:00', sys: 130, dia: 80 }) === false, '非法日期（6 位年份）必须拒绝');
assert(Store.addVital('bp', { date: Store.addDays(t, 1), time: '08:00', sys: 130, dia: 80 }) === false, '未来日期必须拒绝');
assert(/不能晚于今天/.test(Store.actionError()), '未来日期应说明原因');
assert(Store.addVital('bp', { date: t, time: '08:00', sys: 'abc', dia: 80 }) === false, '非数字读数必须拒绝');
assert(Store.addVital('pressure', { date: t, value: 1 }) === false, '未知记录类型必须拒绝');
assert(Store.addVital('constructor', { date: t, value: 1 }) === false && Store.removeVital('__proto__', 'x') === false, '继承来的属性名不能当记录类型');
assert(Store.data.vitals.bp.length === bpBefore, '被拒绝的记录不得写入');
assert(Store.addVital('bp', { date: t, time: '', sys: 128, dia: 82, pulse: '' }) === true, '合法记录应保存');
assert(Store.data.vitals.bp[0].sys === 128 && /^[A-Za-z0-9_-]+$/.test(Store.data.vitals.bp[0].id), '保存的是规范化后的条目');

/* 身高按厘米：按米填的 1.7 会把 BMI 算成几十万，读盘时丢弃 */
Store.data.profile.height = '1.7';
localStorage.setItem('strokeRehab.v1', JSON.stringify(Store.data));
Store.load();
assert(Store.data.profile.height === '', '按米填写的身高应被丢弃，实际 ' + Store.data.profile.height);
Store.data.profile.height = '165';
Store.save();
Store.load();
assert(Store.data.profile.height === '165', '合法身高应保留');

/* 康复第 N 天：跨夏令时也不能少一天（四舍五入，不向下取整） */
Store.data.profile.strokeDate = Store.addDays(t, -30);
assert(Store.rehabDay() === 31, 'rehabDay 仍应为 31');
Store.data.profile.strokeDate = '';
{
  /* 在有夏令时的时区里跑同一段日期运算：2026-03-08 美东拨快一小时，两个零点只差 23 小时 */
  const { spawnSync } = require('child_process');
  const code = `global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.window={};
    eval(require('fs').readFileSync(${JSON.stringify(path.join(__dirname, '..', 'js', 'storage.js'))},'utf8')+';globalThis.Store=Store;');
    process.stdout.write(JSON.stringify([Store.daysBetween('2026-03-01','2026-03-10'), Store.addDays('2026-03-07', 2), Store.daysBetween('2026-10-30','2026-11-02')]));`;
  const out = spawnSync(process.execPath, ['-e', code], { env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' });
  assert(out.stdout === '[9,"2026-03-09",3]', '夏令时时区的日期差/加天数必须正确，实际 ' + out.stdout + out.stderr);
}

/* 另一个页面写过数据：reloadIfChanged() 重新读盘，并解除"冲突"状态 */
Store.save();
assert(Store.reloadIfChanged() === false, '没人改过时不需要重读');
const otherTab = JSON.parse(localStorage.getItem('strokeRehab.v1'));
otherTab.profile.name = '另一页改的称呼';
localStorage.setItem('strokeRehab.v1', JSON.stringify(otherTab));
assert(Store.logExercise('conflict-first') === false && Store.storageStatus().kind === 'conflict', '重读之前保存仍应拒绝（保护另一页的数据）');
assert(Store.reloadIfChanged() === true, '另一页写过后应重读');
assert(Store.data.profile.name === '另一页改的称呼' && !Store.storageStatus(), '重读后拿到新数据且冲突解除');
assert(Store.logExercise('after-sync') === true, '重读后可以继续保存');

/* 上次下载备份的日期：只接受合法日期；备份文件是外部输入 */
assert(Store.lastBackupAt() === '', '没下载过备份时为空');
assert(Store.markBackupDownloaded() === true && Store.lastBackupAt() === t, '下载备份后记下今天');
Store.load();
assert(Store.lastBackupAt() === t, '备份日期应持久化');
const uiDirty = JSON.parse(localStorage.getItem('strokeRehab.v1'));
uiDirty.ui.lastBackupAt = '<img src=x>';
localStorage.setItem('strokeRehab.v1', JSON.stringify(uiDirty));
Store.load();
assert(Store.lastBackupAt() === '' && Store.guideSeen() === Boolean(uiDirty.ui.guideSeen), '非法备份日期回落空串，不影响其他界面状态');

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

/* ============================================================
   v0.2.32 新增断言：时间归属 / 补记 / 高频增删改查
   （针对本次缺陷的断言在旧代码上应失败，反向验证见交付说明）
   ============================================================ */
function v32Fresh() {
  localStorage.removeItem('strokeRehab.recovery.v1');
  localStorage.removeItem('strokeRehab.v1');
  Store.load();
}
const T = t;

/* --- 用户场景：药 from=60天前、今天登记 → 登记前不计入 7/14 天统计与报告 --- */
v32Fresh();
Store.addMed({ name: '氯吡格雷', dose: '75mg', times: ['08:00'] });
const v32med = Store.data.meds[0].id;
Store.updateMed(v32med, { from: Store.addDays(T, -60) });
assert(Store.data.meds[0].trackFrom === T, 'v32 今天登记的药 trackFrom=今天');
assert(Store.medFullDays(7).days === 0 && Store.medFullDays(14).days === 0, 'v32 登记前的日子不计入 7/14 天统计');
assert(Store.medAdherence(7) === null && Store.medAdherence(14) === null, 'v32 登记前不计入 → 依从率为 null');
assert(!/近7天服药完成率/.test(Store.exportReport()), 'v32 尚无计入日时报告不写完成率');
Store.toggleMed(v32med, '08:00');
assert(Store.medFullDays(7).days === 1 && Store.medFullDays(7).full === 1, 'v32 今天核对后才计入');
const v32rep = Store.exportReport();
assert(/近7天服药完成率：100%（统计 1 天，登记前的日子不计入）/.test(v32rep), 'v32 报告完成率行含统计天数与说明');

/* --- 今天未完成不计入 --- */
v32Fresh();
Store.addMed({ name: '双药', dose: 'x', times: ['08:00', '20:00'] });
const v32m2 = Store.data.meds[0].id;
Store.data.meds[0].from = Store.addDays(T, -3);
Store.data.meds[0].trackFrom = Store.addDays(T, -3);
Store.toggleMed(v32m2, '08:00');   // 今天只勾一半
assert(Store.medFullDays(7).days === 3, 'v32 今天未全核对不计入，只剩过去 3 天，实际 ' + Store.medFullDays(7).days);
Store.toggleMed(v32m2, '20:00');
assert(Store.medFullDays(7).days === 4, 'v32 今天全核对后计入（四天）');

/* --- toggleMed / checkAllMedsOn 拒绝 --- */
v32Fresh();
Store.addMed({ name: '甲药', dose: 'x', times: ['08:00'] });
const v32m3 = Store.data.meds[0].id;
Store.data.meds[0].from = Store.addDays(T, -5);
Store.data.meds[0].trackFrom = Store.addDays(T, -2);
assert(Store.toggleMed(v32m3, '08:00', Store.addDays(T, 1)) === false, 'v32 toggleMed 拒绝未来日期');
assert(Store.toggleMed(v32m3, '08:00', Store.addDays(T, -4)) === false, 'v32 toggleMed 拒绝登记前的日子');
assert(Store.toggleMed(v32m3, '11:11', T) === false, 'v32 toggleMed 拒绝未排期的时间点');
assert(Store.checkAllMedsOn(Store.addDays(T, 1)) === false, 'v32 checkAllMedsOn 拒绝未来');
assert(Store.checkAllMedsOn(Store.addDays(T, -4)) === false, 'v32 checkAllMedsOn 拒绝登记前（当天无 items）');
assert(Store.checkAllMedsOn(Store.addDays(T, -1)) === true, 'v32 checkAllMedsOn 一次补齐昨天');
assert(Store.medStatusOn(Store.addDays(T, -1)).done === Store.medStatusOn(Store.addDays(T, -1)).total, 'v32 checkAllMedsOn 后当天全核对');

/* --- 改时间点后的版本（timesHistory） --- */
v32Fresh();
Store.addMed({ name: '他汀', dose: 'x', times: ['08:00'] });
const v32m4 = Store.data.meds[0].id;
Store.data.meds[0].from = Store.addDays(T, -10);
Store.data.meds[0].trackFrom = Store.addDays(T, -10);
Store.toggleMed(v32m4, '08:00', Store.addDays(T, -5));   // 过去按旧时间点核对
Store.updateMed(v32m4, { times: ['20:00'] });            // 改时间点
assert(Store.data.meds[0].timesHistory.length === 1, 'v32 改时间点应生成一条版本');
assert(Store.data.meds[0].timesHistory[0].until === Store.addDays(T, -1) && Store.data.meds[0].timesHistory[0].times[0] === '08:00', 'v32 版本 until=昨天、存旧时间点');
assert(Store.medStatusOn(Store.addDays(T, -5)).items[0].time === '08:00', 'v32 过去日子仍按旧时间点');
assert(Store.medStatusOn(Store.addDays(T, -5)).items[0].taken === true, 'v32 改时间点后过去已勾仍计入');
assert(Store.medStatusOn(T).items[0].time === '20:00', 'v32 今天用新时间点');
assert(Store.toggleMed(v32m4, '08:00', Store.addDays(T, -3)) === true, 'v32 可按旧时间点补记改前的日子');
Store.updateMed(v32m4, { times: ['21:00'] });            // 同日再改一次
assert(Store.data.meds[0].timesHistory.length === 1, 'v32 同日改两次仅一条版本');
Store.updateMed(v32m4, { note: '饭后服' });               // 只改备注
assert(Store.data.meds[0].timesHistory.length === 1, 'v32 只改备注不加版本');
/* 登记当天改不留版本 */
v32Fresh();
Store.addMed({ name: '今日药', dose: 'x', times: ['08:00'] });
const v32m5 = Store.data.meds[0].id;
Store.updateMed(v32m5, { times: ['09:00'] });
assert(Store.data.meds[0].timesHistory.length === 0, 'v32 登记当天改时间点不留版本');

/* --- timesHistory 消每与 51 条拒绝 --- */
const thEnv = th => JSON.stringify({ app: 'stroke-rehab-assistant', schema: 1, data: { meds: [{ id: 'm1', name: '药', times: ['08:00'], timesHistory: th }] } });
let th51 = false;
try { Store.parseBackup(thEnv(Array.from({ length: 51 }, (_, i) => ({ until: '2026-01-0' + (i % 9 + 1), times: ['08:00'] })))); }
catch (e) { th51 = /服药时间调整次数/.test(e.message); }
assert(th51, 'v32 timesHistory 超 50 条应拒绝且文案含“服药时间调整次数”');
const thClean = Store.parseBackup(thEnv([
  { until: 'bad-date', times: ['08:00'] },
  { until: '2026-01-01', times: ['bad', '08:00'] },
  { until: '2026-01-01', times: ['09:00'] },   // 重复 until 去重
  { until: '2026-01-02', times: [] },           // 空 times 丢弃
]));
const thm = thClean.data.meds[0].timesHistory;
assert(thm.length === 1 && thm[0].until === '2026-01-01' && thm[0].times.join(',') === '08:00', 'v32 timesHistory 消每：丢非法 until/时间/空、按 until 去重');

/* --- 停用药开始日晚于停用日被拒且仍停用；疗程重叠/接受 --- */
v32Fresh();
Store.addMed({ name: '停用药', dose: 'x', times: ['08:00'] });
const v32m6 = Store.data.meds[0].id;
Store.data.meds[0].from = Store.addDays(T, -10);
Store.data.meds[0].trackFrom = Store.addDays(T, -10);
Store.stopMed(v32m6, Store.addDays(T, -3));
assert(Store.updateMed(v32m6, { from: Store.addDays(T, -1) }) === false, 'v32 开始日晚于停用日被拒');
assert(Store.isMedStopped(Store.data.meds[0]) && Store.data.meds[0].to === Store.addDays(T, -3), 'v32 被拒后药仍停用');
assert(Store.addMed({ name: '重叠疗程', times: ['08:00'], previousCourseId: v32m6, from: Store.addDays(T, -3) }) === false, 'v32 新疗程与上一疗程重叠被拒');
const nextDay = Store.addDays(T, -2);   // 停药次日（早于今天）
assert(Store.addMed({ name: '新疗程', times: ['08:00'], previousCourseId: v32m6, from: nextDay }) === true, 'v32 停药次日开始被接受（可早于今天）');

/* --- 训练补记/撤销 --- */
v32Fresh();
assert(Store.logExercise('bobath', Store.addDays(T, -1)) === true, 'v32 可补记昨天训练');
assert(Store.logExercise('bobath', Store.addDays(T, 1)) === false, 'v32 训练未来被拒');
Store.logExercise('bobath', T);
assert(Store.streak() === 2, 'v32 补记昨天后 streak 接上，实际 ' + Store.streak());
assert(Store.unlogExercise('bobath', Store.addDays(T, -1)) === true, 'v32 撤销昨天成功');
assert(!(Store.addDays(T, -1) in Store.data.exerciseLog), 'v32 撤销后空天删日期键');
assert(Store.unlogExercise('bobath', Store.addDays(T, -9)) === true && Store.exercisesOn(Store.addDays(T, -9)).length === 0, 'v32 没打过的日撤销返回 true、不报错');

/* --- updateVital / addVital --- */
v32Fresh();
Store.addVital('bp', { date: Store.addDays(T, -1), time: '08:00', sys: 120, dia: 80 });
Store.addVital('bp', { date: Store.addDays(T, -1), time: '08:00', sys: 130, dia: 85 });
const vId = Store.data.vitals.bp[0].id, vIdx = Store.data.vitals.bp.findIndex(v => v.id === vId);
assert(Store.updateVital('bp', vId, { sys: 145 }) === true, 'v32 updateVital 成功');
assert(Store.data.vitals.bp[vIdx].id === vId && Store.data.vitals.bp[vIdx].sys === 145, 'v32 updateVital 保 id 与数组位置');
assert(Store.data.vitals.bp.length === 2, 'v32 updateVital 不改变条数');
assert(Store.updateVital('bp', 'nope', { sys: 100 }) === false, 'v32 updateVital 找不到被拒');
assert(Store.updateVital('bp', vId, { date: Store.addDays(T, 1) }) === false, 'v32 updateVital 未来日期被拒');
assert(Store.updateVital('bp', vId, { sys: 'oops' }) === false, 'v32 updateVital 非法值被拒');
assert(Store.addVital('bp', { date: Store.addDays(T, 1), sys: 120, dia: 80 }) === false, 'v32 addVital 未来日期被拒');

/* --- 备份往返保留 trackFrom/timesHistory + 规范化幂等 --- */
v32Fresh();
Store.addMed({ name: '备份药', dose: 'x', times: ['08:00'] });
const v32m7 = Store.data.meds[0].id;
Store.data.meds[0].from = Store.addDays(T, -10);
Store.data.meds[0].trackFrom = Store.addDays(T, -8);
Store.updateMed(v32m7, { times: ['20:00'] });
Store.save();
const v32round = Store.parseBackup(Store.exportBackup());
assert(v32round.data.meds[0].trackFrom === Store.addDays(T, -8), 'v32 备份往返保留 trackFrom');
assert(v32round.data.meds[0].timesHistory.length === 1, 'v32 备份往返保留 timesHistory');
assert(JSON.stringify(v32round.data) === JSON.stringify(Store.data), 'v32 规范化幂等：备份往返与当前数据逐字相等');

/* --- 旧数据推断 trackFrom：最早核对日 → 今天（不回退 from）；load() 落盘固定 --- */
v32Fresh();
// F1：from 可被旧表单回填成更早的日期，不是登记日，故不参与推断。
// ①有 from 有核对→最早核对日（不取更早的 from）；②有 from 无核对→今天；③无 from 有核对→最早核对日；④无 from 无核对→今天
const legacyRaw = JSON.stringify({
  meds: [
    { id: 'a', name: '有from有核对', times: ['08:00'], from: Store.addDays(T, -30) },
    { id: 'b', name: '有from无核对', times: ['08:00'], from: Store.addDays(T, -30) },
    { id: 'c', name: '无from有核对', times: ['08:00'] },
    { id: 'd', name: '无from无核对', times: ['08:00'] },
  ],
  medLog: { [Store.addDays(T, -20)]: { 'a@08:00': true, 'c@08:00': true }, [Store.addDays(T, -15)]: { 'a@08:00': true } },
});
localStorage.setItem('strokeRehab.v1', legacyRaw);
Store.load();
const legMeds = Store.data.meds;
assert(legMeds.find(m => m.id === 'a').trackFrom === Store.addDays(T, -20), 'v32 有 from 有核对 →最早核对日（from 可被回填，不当登记日）');
assert(legMeds.find(m => m.id === 'b').trackFrom === T, 'v32 有 from 无核对 →今天');
assert(legMeds.find(m => m.id === 'c').trackFrom === Store.addDays(T, -20), 'v32 无 from 有核对 →最早核对日');
assert(legMeds.find(m => m.id === 'd').trackFrom === T, 'v32 无 from 无核对 →今天');
// P1：推断结果必须在 load() 里落盘固定（不再是“load 不写盘”）
const persisted = JSON.parse(localStorage.getItem('strokeRehab.v1')).meds;
assert(persisted.find(m => m.id === 'a').trackFrom === Store.addDays(T, -20)
  && persisted.find(m => m.id === 'd').trackFrom === T, 'v32 load() 将推断的 trackFrom 落盘固定');

/* --- F1 回填开始日期的老药：from=-90、首核对=-3、此后每天核对；装应用前的日子不得出现漏服 --- */
v32Fresh();
const bfLog = {};
for (let i = 0; i <= 3; i++) bfLog[Store.addDays(T, -i)] = { 'bf@08:00': true };  // 今天回溯到 3 天前
localStorage.setItem('strokeRehab.v1', JSON.stringify({
  meds: [{ id: 'bf', name: '回填开始日期的老药', times: ['08:00'], from: Store.addDays(T, -90) }],
  medLog: bfLog,
}));
Store.load();
assert(Store.data.meds[0].trackFrom === Store.addDays(T, -3), 'F1 回填药 trackFrom=最早核对日(-3)、不是 from(-90)');
assert(Store.medStatusOn(Store.addDays(T, -10)).beforeTracking === true, 'F1 装应用前(-10) beforeTracking=true');
assert(Store.medStatusOn(Store.addDays(T, -10)).total === 0, 'F1 装应用前(-10) 应服次数=0（不算漏服）');
assert(Store.checkAllMedsOn(Store.addDays(T, -10)) === false, 'F1 装应用前(-10) 不开放补记');
const bfAd = Store.medAdherence(14);
assert(bfAd && bfAd.days === 4, 'F1 近14天只含 -3 起的 4 个计入日（-3~今天），实际 ' + (bfAd && bfAd.days));

/* --- P1 跨天：第二天重新读取，登记日必须不变（不随 today() 往后漂） --- */
v32Fresh();
// 最容易漂的情形：无 from、无核对的老药，首次 load 推断为今天
localStorage.setItem('strokeRehab.v1', JSON.stringify({ meds: [{ id: 'z', name: '无依据老药', times: ['08:00'] }] }));
Store.load();
const day1TrackFrom = Store.data.meds[0].trackFrom;
assert(day1TrackFrom === T, 'P1 首次 load 无依据老药 trackFrom=今天');
assert(JSON.parse(localStorage.getItem('strokeRehab.v1')).meds[0].trackFrom === T, 'P1 load 已把推断结果落盘（否则第二天会漂）');
// 模拟“第二天”：把系统日期推到明天后重新 load
const RealDate = Date;
const tomorrow = Store.addDays(T, 1);
global.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [tomorrow + 'T12:00:00'])); }
  static now() { return new RealDate(tomorrow + 'T12:00:00').getTime(); }
};
assert(Store.today() === tomorrow, 'P1 日期 mock 生效（今天已是明天）');
Store.load();
global.Date = RealDate;
assert(Store.data.meds[0].trackFrom === day1TrackFrom, 'P1 第二天重新读取，登记日必须不变（已落盘，不重推）');
v32Fresh();

/* --- 未来 trackFrom 钳到今天 --- */
v32Fresh();
localStorage.setItem('strokeRehab.v1', JSON.stringify({ meds: [{ id: 'x', name: '未来药', times: ['08:00'], from: T, trackFrom: Store.addDays(T, 5) }] }));
Store.load();
assert(Store.data.meds[0].trackFrom === T, 'v32 未来 trackFrom 钳到今天');
v32Fresh();

/* --- P2#1：补记单独标记 medLate（medLog 仍只存 true） --- */
v32Fresh();
Store.addMed({ name: '补记药', dose: 'x', times: ['08:00', '12:00', '20:00'] });
const lateMed = Store.data.meds[0].id;
Store.data.meds[0].from = Store.addDays(T, -10);
Store.data.meds[0].trackFrom = Store.addDays(T, -10);
const yLate = Store.addDays(T, -1);
Store.toggleMed(lateMed, '08:00', yLate);
assert(Store.data.medLate[yLate] && Store.data.medLate[yLate][lateMed + '@08:00'] === true, 'P2#1 昨天 toggleMed 写 medLate');
assert(Store.data.medLog[yLate][lateMed + '@08:00'] === true, 'P2#1 medLog 仍记 true');
Store.toggleMed(lateMed, '08:00', yLate);   // 再次 toggle 取消
assert(!Store.data.medLog[yLate] && !Store.data.medLate[yLate], 'P2#1 取消核对后 medLog/medLate 同删空日期键');
Store.toggleMed(lateMed, '08:00', T);   // 今天核对
assert(Store.data.medLog[T][lateMed + '@08:00'] === true, 'P2#1 今天核对写 medLog');
assert(!Store.data.medLate[T], 'P2#1 今天的核对不算补记（medLate 无）');

/* checkAllMedsOn：昨天已有 1 项当日核对（非补记）、另 2 项未核对 → 一键只给新勾的 2 项写 medLate */
v32Fresh();
Store.addMed({ name: '一键药', times: ['08:00', '12:00', '20:00'] });
const allMed = Store.data.meds[0].id;
Store.data.meds[0].from = Store.addDays(T, -10);
Store.data.meds[0].trackFrom = Store.addDays(T, -10);
const y2 = Store.addDays(T, -1);
Store.data.medLog[y2] = { [allMed + '@08:00']: true };   // 模拟当天已核对 08:00（不写 medLate）
Store.checkAllMedsOn(y2);
assert(Store.medStatusOn(y2).done === 3, 'P2#1 checkAllMedsOn 补齐三项');
const lateKeys = Object.keys(Store.data.medLate[y2] || {});
assert(lateKeys.length === 2 && !lateKeys.includes(allMed + '@08:00'), 'P2#1 checkAllMedsOn 只给新勾的 2 项写 medLate，原已核对不动');

/* uncheckMedsOn（撤销一键补齐）：只回退传入的 2 项、保留原 08:00、清 medLate、一次 save；再撤无副作用 */
const added2 = [{ medId: allMed, time: '12:00' }, { medId: allMed, time: '20:00' }];
assert(Store.uncheckMedsOn(y2, added2) === true, 'P2#1 uncheckMedsOn 撤销成功');
assert(Store.medStatusOn(y2).done === 1, 'P2#1 uncheckMedsOn 只回退新勾的 2 项');
assert(Store.isMedTaken(allMed, '08:00', y2), 'P2#1 uncheckMedsOn 保留原已核对项');
assert(!Store.data.medLate[y2], 'P2#1 uncheckMedsOn 清掉本次补记标记');
assert(Store.uncheckMedsOn(y2, added2) === true, 'P2#1 uncheckMedsOn 再撤已无可撤仍返回 true（无副作用）');
assert(Store.medStatusOn(y2).done === 1, 'P2#1 uncheckMedsOn 再撤不改动数据');
assert(Store.uncheckMedsOn(Store.addDays(T, 1), added2) === false, 'P2#1 uncheckMedsOn 拒绝未来日期');
assert(Store.uncheckMedsOn(y2, []) === true, 'P2#1 uncheckMedsOn 空列表视作成功、不写盘');

/* 撤销时写盘失败：必须返回 false 且内存回滚 —— 数据仍是「全吃到」、补记标记不丢，
   与画面（历史行「全吃到 ✓」）保持一致（硬约定 §6「补记标记与一键撤销」写盘失败一支）。 */
Store.checkAllMedsOn(y2);                                        // 重新补齐三项，作为最近一次成功保存
assert(Store.medStatusOn(y2).done === 3, 'P2#1 写盘失败测试前先补齐三项');
const lateBeforeFail = Object.keys(Store.data.medLate[y2] || {}).length;
failWrites = true;
assert(Store.uncheckMedsOn(y2, added2) === false, 'P2#1 撤销写盘失败返回 false');
failWrites = false;
assert(Store.medStatusOn(y2).done === 3, 'P2#1 撤销写盘失败后内存回滚，仍是全核对');
assert(Object.keys(Store.data.medLate[y2] || {}).length === lateBeforeFail, 'P2#1 撤销写盘失败后补记标记不丢');

/* 规范化丢弃 medLog 中不存在的孤立 medLate */
v32Fresh();
localStorage.setItem('strokeRehab.v1', JSON.stringify({
  meds: [{ id: 'o', name: '孤立药', times: ['08:00'], trackFrom: Store.addDays(T, -5) }],
  medLog: { [Store.addDays(T, -1)]: { 'o@08:00': true } },
  medLate: { [Store.addDays(T, -1)]: { 'o@08:00': true, 'o@20:00': true }, [Store.addDays(T, -2)]: { 'o@08:00': true } },
}));
Store.load();
assert(Store.data.medLate[Store.addDays(T, -1)] && Store.data.medLate[Store.addDays(T, -1)]['o@08:00'] === true, 'P2#1 medLog 有对应的 medLate 保留');
assert(!Store.data.medLate[Store.addDays(T, -1)]['o@20:00'], 'P2#1 medLog 无对应的孤立 medLate 键丢弃');
assert(!Store.data.medLate[Store.addDays(T, -2)], 'P2#1 整天无对应 medLog 的 medLate 丢弃');

/* 备份导出→恢复往返保留 medLate */
v32Fresh();
Store.addMed({ name: '备份补记药', times: ['08:00'] });
const bkMed = Store.data.meds[0].id;
Store.data.meds[0].from = Store.addDays(T, -5);
Store.data.meds[0].trackFrom = Store.addDays(T, -5);
Store.toggleMed(bkMed, '08:00', Store.addDays(T, -1));
const bkRound = Store.parseBackup(Store.exportBackup());
assert(bkRound.data.medLate[Store.addDays(T, -1)][bkMed + '@08:00'] === true, 'P2#1 备份往返保留 medLate');

/* 超限 medLate 被 validateBackupLimits 拒绝 */
const lateOverEnv = n => {
  const day = {};
  for (let i = 0; i < n; i++) day['m' + i + '@08:00'] = true;
  return JSON.stringify({ app: 'stroke-rehab-assistant', schema: 1, data: { meds: [{ id: 'm1', name: '药', times: ['08:00'] }], medLog: { '2026-01-01': { 'm1@08:00': true } }, medLate: { '2026-01-01': day } } });
};
let lateOver = false;
try { Store.parseBackup(lateOverEnv(Store.backupLimits.medChecksPerDay + 1)); }
catch (e) { lateOver = /服药补记数量/.test(e.message); }
assert(lateOver, 'P2#1 超限 medLate 被 validateBackupLimits 拒绝（文案含“服药补记数量”）');

/* medAdherence(n).late 数值正确 + exportReport 含/不含“事后补记” */
v32Fresh();
Store.addMed({ name: '依从补记药', times: ['08:00', '20:00'] });
const adMed = Store.data.meds[0].id;
Store.data.meds[0].from = Store.addDays(T, -3);
Store.data.meds[0].trackFrom = Store.addDays(T, -3);
Store.toggleMed(adMed, '08:00', Store.addDays(T, -1));
Store.toggleMed(adMed, '20:00', Store.addDays(T, -1));
Store.toggleMed(adMed, '08:00', Store.addDays(T, -2));
const adL = Store.medAdherence(7);
assert(adL.late === 3, 'P2#1 medAdherence(7).late=计入日内补记次数(3)，实际 ' + adL.late);
assert(/其中 3 次为事后补记/.test(Store.exportReport()), 'P2#1 报告 late>0 时含事后补记次数');
v32Fresh();
Store.addMed({ name: '无补记药', times: ['08:00'] });
const nlMed = Store.data.meds[0].id;
Store.data.meds[0].from = Store.addDays(T, -3);
Store.data.meds[0].trackFrom = Store.addDays(T, -3);
Store.toggleMed(nlMed, '08:00', T);   // 只今天核对，非补记
assert(!/事后补记/.test(Store.exportReport()), 'P2#1 无补记时报告不含事后补记');
assert(Store.medAdherence(7).late === 0, 'P2#1 无补记时 late=0');
v32Fresh();

if (failed) {
  console.error(`❌ ${failed} 项断言失败`);
  process.exit(1);
}
console.log('✅ storage.js 全部断言通过');

function partialData() {
  return { profile: { name: '将被拒绝的恢复' } };
}
