/* ============================================================
   数据层：全部数据保存在本机浏览器 localStorage，不上传。
   ============================================================ */

const Store = (() => {
  const KEY = 'strokeRehab.v1';

  const defaults = () => ({
    profile: {
      name: '',          // 称呼
      strokeDate: '',    // 发病日期 YYYY-MM-DD（算"康复第N天"）
      stage: 'sitting',  // bed/sitting/standing/walking
      font: 'normal',    // normal/large/xlarge
      height: '',        // cm，可选，算BMI
    },
    meds: [],            // {id, name, dose, times:['08:00'], note}
    medLog: {},          // 'YYYY-MM-DD' -> { 'medId@time': true }
    vitals: {
      bp: [],            // {id, date, time, sys, dia, pulse}
      glucose: [],       // {id, date, time, gtype, value}
      weight: [],        // {id, date, value}
    },
    exerciseLog: {},     // 'YYYY-MM-DD' -> ['exId', ...]
    gameLog: {},         // 'YYYY-MM-DD' -> [{game, score, detail}]
    ui: { guideSeen: false },  // 界面状态：是否已看过首次使用指引
  });

  let data = defaults();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        data = Object.assign(defaults(), parsed);
        data.profile = Object.assign(defaults().profile, parsed.profile || {});
        data.vitals = Object.assign(defaults().vitals, parsed.vitals || {});
        data.ui = Object.assign(defaults().ui, parsed.ui || {});
      }
    } catch (e) {
      console.warn('读取本地数据失败，使用空数据', e);
      data = defaults();
    }
    return data;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('保存失败', e);
    }
  }

  /* ---------- 日期工具 ---------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function dateStr(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function timeStr(d = new Date()) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function today() { return dateStr(new Date()); }
  function addDays(str, delta) {
    const d = new Date(str + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    return dateStr(d);
  }
  function weekdayCN(d = new Date()) {
    return '星期' + '日一二三四五六'[d.getDay()];
  }
  /* 康复第N天（发病日为第1天） */
  function rehabDay() {
    const sd = data.profile.strokeDate;
    if (!sd) return null;
    const ms = new Date(today() + 'T00:00:00') - new Date(sd + 'T00:00:00');
    const n = Math.floor(ms / 86400000) + 1;
    return n > 0 ? n : null;
  }

  /* ---------- 训练打卡 ---------- */
  function logExercise(exId) {
    const t = today();
    if (!data.exerciseLog[t]) data.exerciseLog[t] = [];
    if (!data.exerciseLog[t].includes(exId)) data.exerciseLog[t].push(exId);
    save();
  }
  function exercisesDoneToday() { return data.exerciseLog[today()] || []; }
  function isExDone(exId) { return exercisesDoneToday().includes(exId); }

  /* 连续坚持天数：从今天(或昨天)往前数，每天至少1项训练 */
  function streak() {
    let d = today();
    if (!(data.exerciseLog[d] || []).length) d = addDays(d, -1);
    let n = 0;
    while ((data.exerciseLog[d] || []).length) { n++; d = addDays(d, -1); }
    return n;
  }

  /* ---------- 游戏成绩 ---------- */
  function logGame(game, score, detail) {
    const t = today();
    if (!data.gameLog[t]) data.gameLog[t] = [];
    data.gameLog[t].push({ game, score, detail, time: timeStr() });
    save();
  }

  /* ---------- 用药 ---------- */
  function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }

  function addMed(med) { data.meds.push({ id: uid(), ...med }); save(); }
  function updateMed(id, patch) {
    const m = data.meds.find(x => x.id === id);
    if (m) { Object.assign(m, patch); save(); }
  }
  function removeMed(id) {
    data.meds = data.meds.filter(m => m.id !== id);
    save();
  }
  function medKey(medId, time) { return `${medId}@${time}`; }
  function isMedTaken(medId, time, date = today()) {
    return !!(data.medLog[date] && data.medLog[date][medKey(medId, time)]);
  }
  function toggleMed(medId, time, date = today()) {
    if (!data.medLog[date]) data.medLog[date] = {};
    const k = medKey(medId, time);
    if (data.medLog[date][k]) delete data.medLog[date][k];
    else data.medLog[date][k] = true;
    save();
  }
  /* 今日应服总次数 / 已服次数 */
  function medProgressToday() {
    let total = 0, done = 0;
    const t = today();
    data.meds.forEach(m => (m.times || []).forEach(tm => {
      total++;
      if (isMedTaken(m.id, tm, t)) done++;
    }));
    return { total, done };
  }
  /* 近7天依从率 */
  function adherence7d() {
    let total = 0, done = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(today(), -i);
      data.meds.forEach(m => (m.times || []).forEach(tm => {
        total++;
        if (isMedTaken(m.id, tm, d)) done++;
      }));
    }
    return total ? Math.round(done / total * 100) : null;
  }

  /* ---------- 健康记录 ---------- */
  function addVital(kind, entry) {
    data.vitals[kind].unshift({ id: uid(), ...entry });
    save();
  }
  function removeVital(kind, id) {
    data.vitals[kind] = data.vitals[kind].filter(v => v.id !== id);
    save();
  }
  function vitalsSorted(kind) {
    return [...data.vitals[kind]].sort((a, b) =>
      (a.date + (a.time || '')) < (b.date + (b.time || '')) ? -1 : 1);
  }
  function bpToday() { return data.vitals.bp.some(v => v.date === today()); }

  /* ---------- 导出报告 ---------- */
  function exportReport() {
    const lines = [];
    const name = data.profile.name || '患者';
    lines.push(`【${name} 的健康记录】 导出日期：${today()}`);
    const rd = rehabDay();
    if (rd) lines.push(`康复第 ${rd} 天（发病日期 ${data.profile.strokeDate}）`);
    lines.push('');

    lines.push('■ 目前用药');
    if (data.meds.length) {
      data.meds.forEach(m => lines.push(`  ${m.name} ${m.dose || ''} 每日${(m.times || []).length}次(${(m.times || []).join('、')}) ${m.note || ''}`.trimEnd()));
      const ad = adherence7d();
      if (ad !== null) lines.push(`  近7天服药完成率：${ad}%`);
    } else lines.push('  （未登记）');
    lines.push('');

    lines.push('■ 血压记录（近30条）');
    const bp = vitalsSorted('bp').slice(-30);
    if (bp.length) bp.forEach(v => lines.push(`  ${v.date} ${v.time || ''}  ${v.sys}/${v.dia} mmHg${v.pulse ? '  脉搏' + v.pulse : ''}`));
    else lines.push('  （无记录）');
    lines.push('');

    lines.push('■ 血糖记录（近30条）');
    const gl = vitalsSorted('glucose').slice(-30);
    if (gl.length) gl.forEach(v => lines.push(`  ${v.date} ${v.time || ''}  ${v.gtype}  ${v.value} mmol/L`));
    else lines.push('  （无记录）');
    lines.push('');

    lines.push('■ 体重记录（近30条）');
    const wt = vitalsSorted('weight').slice(-30);
    if (wt.length) wt.forEach(v => lines.push(`  ${v.date}  ${v.value} kg`));
    else lines.push('  （无记录）');
    lines.push('');

    const exDays = Object.keys(data.exerciseLog).filter(d => data.exerciseLog[d].length).length;
    lines.push(`■ 康复训练：累计打卡 ${exDays} 天，当前连续坚持 ${streak()} 天`);
    lines.push('');
    lines.push('（由"脑梗康复助手"导出，数据为患者自行记录，供医生参考）');
    return lines.join('\n');
  }

  /* ---------- 备份导出 / 恢复导入 ---------- */
  const isObj = x => x && typeof x === 'object' && !Array.isArray(x);

  /* 生成全量备份 JSON 文本（带 schema 版本，便于将来兼容） */
  function exportBackup() {
    const snapshot = {
      app: 'stroke-rehab-assistant',
      schema: 1,
      exportedAt: `${today()} ${timeStr()}`,
      data,
    };
    return JSON.stringify(snapshot, null, 2);
  }

  /* 解析并校验备份文本，返回 { data, exportedAt }，不写入、不保存。
     必须能识别为我们的数据结构，否则抛错——防止误选任意文件把数据清空。 */
  function parseBackup(jsonText) {
    let obj;
    try { obj = JSON.parse(jsonText); } catch (e) { throw new Error('不是有效的 JSON 文件'); }
    if (!isObj(obj)) throw new Error('不是本应用导出的备份文件');

    const hasEnvelope = obj.app === 'stroke-rehab-assistant' && isObj(obj.data);
    const incoming = hasEnvelope ? obj.data : obj;

    const looksOurs = hasEnvelope
      || ['profile', 'meds', 'medLog', 'vitals', 'exerciseLog', 'gameLog', 'ui'].some(k => {
        const v = incoming[k];
        return k === 'meds' ? Array.isArray(v) : isObj(v);
      });
    if (!looksOurs) throw new Error('不是本应用导出的备份文件（未识别到数据结构）');

    /* 字段级类型守卫：只接受形状正确的字段，畸形内容回落默认 */
    const d = defaults();
    if (isObj(incoming.profile)) d.profile = Object.assign(defaults().profile, incoming.profile);
    if (Array.isArray(incoming.meds)) d.meds = incoming.meds;
    if (isObj(incoming.medLog)) d.medLog = incoming.medLog;
    if (isObj(incoming.vitals)) {
      d.vitals = defaults().vitals;
      ['bp', 'glucose', 'weight'].forEach(k => {
        if (Array.isArray(incoming.vitals[k])) d.vitals[k] = incoming.vitals[k];
      });
    }
    if (isObj(incoming.exerciseLog)) d.exerciseLog = incoming.exerciseLog;
    if (isObj(incoming.gameLog)) d.gameLog = incoming.gameLog;
    if (isObj(incoming.ui)) d.ui = Object.assign(defaults().ui, incoming.ui);
    return { data: d, exportedAt: obj.exportedAt || '' };
  }

  /* 用解析好的备份数据整体替换当前数据并保存 */
  function applyBackup(state) {
    data = state;
    save();
    return data;
  }

  /* 备份内容摘要（供恢复前预览） */
  function backupSummary(d) {
    return {
      meds: d.meds.length,
      bp: d.vitals.bp.length,
      glucose: d.vitals.glucose.length,
      weight: d.vitals.weight.length,
      checkinDays: Object.keys(d.exerciseLog).filter(k => (d.exerciseLog[k] || []).length).length,
    };
  }

  /* ---------- 清空 ---------- */
  function resetAll() {
    data = defaults();
    save();
  }

  return {
    load, save,
    get data() { return data; },
    today, timeStr, addDays, weekdayCN, rehabDay,
    logExercise, exercisesDoneToday, isExDone, streak,
    logGame,
    addMed, updateMed, removeMed, isMedTaken, toggleMed, medProgressToday, adherence7d,
    addVital, removeVital, vitalsSorted, bpToday,
    exportReport, resetAll,
    exportBackup, parseBackup, applyBackup, backupSummary,
    guideSeen: () => !!data.ui.guideSeen,
    markGuideSeen: () => { data.ui.guideSeen = true; save(); },
  };
})();
