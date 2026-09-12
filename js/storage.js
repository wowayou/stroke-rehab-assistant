/* ============================================================
   数据层：全部数据保存在本机浏览器 localStorage，不上传。
   ============================================================ */

const Store = (() => {
  const KEY = 'strokeRehab.v1';
  const RECOVERY_KEY = 'strokeRehab.recovery.v1';
  const BACKUP_SCHEMA = 1;
  const ENCRYPTION_SCHEMA = 1;
  const KDF_ITERATIONS = 600000;
  const ENCRYPTION_AAD = 'stroke-rehab-assistant|encrypted-backup|1';
  const BACKUP_LIMITS = Object.freeze({
    maxBytes: 5 * 1024 * 1024,
    maxEncryptedBytes: 8 * 1024 * 1024,
    meds: 100,
    timesPerMed: 12,
    vitalsPerKind: 5000,
    logDays: 3660,
    exercisesPerDay: 100,
    gamesPerDay: 100,
    medChecksPerDay: 1200,
  });

  const defaults = () => ({
    profile: {
      name: '',          // 称呼
      strokeDate: '',    // 发病日期 YYYY-MM-DD（算"康复第N天"）
      stage: 'sitting',  // bed/sitting/standing/walking
      font: 'normal',    // normal/large/xlarge
      speechRate: 'slow',   // 朗读语速 slow/mid/fast（默认慢，老人听得清比听得快重要）
      height: '',        // cm，可选，算BMI
      targets: {         // 个人目标值（遵医嘱，用户可调）：血压 140/90 与血糖 7.0/10.0 为默认
        bpSys: 140, bpDia: 90,
        gluFast: 7.0, gluPost: 10.0,
      },
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

  /* 目标值与设置页使用同一范围；非法组合整体回落默认，避免备份绕过界面校验。 */
  function sanitizeTargets(pt) {
    pt = isObj(pt) ? pt : {};
    const T = defaults().profile.targets;
    const inRange = (x, min, max, fb) => {
      const n = +x;
      return Number.isFinite(n) && n >= min && n <= max ? n : fb;
    };
    const bpSys = inRange(pt.bpSys, 60, 260, T.bpSys);
    const bpDia = inRange(pt.bpDia, 30, 200, T.bpDia);
    return {
      bpSys: bpSys > bpDia ? bpSys : T.bpSys,
      bpDia: bpSys > bpDia ? bpDia : T.bpDia,
      gluFast: inRange(pt.gluFast, 3, 20, T.gluFast),
      gluPost: inRange(pt.gluPost, 3, 30, T.gluPost),
    };
  }

  let data = defaults();
  let persistedJSON = JSON.stringify(data);
  let backupErrorMessage = '';

  const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
  const text = (x, max = 500) => typeof x === 'string' ? x.slice(0, max) : '';
  const finite = x => {
    const n = +x;
    return Number.isFinite(n) ? n : null;
  };
  function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
  function validDate(x) {
    if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
    if (x < '1900-01-01' || x > '2100-12-31') return false;
    const d = new Date(x + 'T00:00:00');
    return Number.isFinite(d.getTime()) && dateStr(d) === x;
  }
  function validTime(x) {
    return typeof x === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(x);
  }
  function cleanId(x, seen) {
    let id = typeof x === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(x) ? x : '';
    while (!id || seen.has(id)) id = uid();
    seen.add(id);
    return id;
  }
  function recentDateKeys(obj) {
    return Object.keys(obj).filter(validDate).sort().reverse().slice(0, BACKUP_LIMITS.logDays);
  }

  /* 本地数据和备份恢复共用同一条深度规范化路径。容器类型正确还不够，
     内部 null、非法数字、危险 id 一样会让计算/模板崩溃。 */
  function normalizeState(raw) {
    const out = defaults();
    if (!isObj(raw)) return out;

    if (isObj(raw.profile)) {
      const p = raw.profile;
      out.profile.name = text(p.name, 80);
      out.profile.strokeDate = validDate(p.strokeDate) ? p.strokeDate : '';
      out.profile.stage = ['bed', 'sitting', 'standing', 'walking'].includes(p.stage) ? p.stage : out.profile.stage;
      out.profile.font = ['normal', 'large', 'xlarge'].includes(p.font) ? p.font : out.profile.font;
      out.profile.speechRate = ['slow', 'mid', 'fast'].includes(p.speechRate) ? p.speechRate : out.profile.speechRate;
      const h = finite(p.height);
      out.profile.height = h !== null && h > 0 && h <= 300 ? String(p.height) : '';
      out.profile.targets = sanitizeTargets(p.targets);
    }

    const medIds = new Set();
    if (Array.isArray(raw.meds)) {
      out.meds = raw.meds.slice(0, BACKUP_LIMITS.meds).filter(isObj).map(m => {
        const from = validDate(m.from) ? m.from : '';
        let to = validDate(m.to) ? m.to : '';
        if (from && to && to < from) to = '';
        return {
          id: cleanId(m.id, medIds),
          name: text(m.name, 200),
          dose: text(m.dose, 200),
          times: Array.isArray(m.times) ? [...new Set(m.times.filter(validTime))].slice(0, BACKUP_LIMITS.timesPerMed) : [],
          note: text(m.note, 500),
          from,
          to,
          previousCourseId: typeof m.previousCourseId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(m.previousCourseId) ? m.previousCourseId : '',
        };
      }).filter(m => m.name);
    }
    const liveMedIds = new Set(out.meds.map(m => m.id));
    out.meds.forEach(m => {
      if (!liveMedIds.has(m.previousCourseId) || m.previousCourseId === m.id) m.previousCourseId = '';
    });

    out.medLog = Object.create(null);
    if (isObj(raw.medLog)) recentDateKeys(raw.medLog).forEach(d => {
      if (!isObj(raw.medLog[d])) return;
      const day = Object.create(null);
      Object.keys(raw.medLog[d]).slice(0, BACKUP_LIMITS.medChecksPerDay).forEach(k => {
        const at = k.lastIndexOf('@');
        const id = k.slice(0, at), tm = k.slice(at + 1);
        if (liveMedIds.has(id) && validTime(tm) && raw.medLog[d][k] === true) day[`${id}@${tm}`] = true;
      });
      out.medLog[d] = day;
    });

    const vitalIds = new Set();
    const cleanVitalId = x => cleanId(x, vitalIds);
    const cleanTime = x => validTime(x) ? x : '';
    if (isObj(raw.vitals)) {
      if (Array.isArray(raw.vitals.bp)) out.vitals.bp = raw.vitals.bp.slice(0, BACKUP_LIMITS.vitalsPerKind).filter(isObj).map(v => {
        const sys = finite(v.sys), dia = finite(v.dia), pulse = finite(v.pulse);
        if (!validDate(v.date) || sys === null || dia === null || sys <= 0 || sys > 500 || dia <= 0 || dia > 500) return null;
        return { id: cleanVitalId(v.id), date: v.date, time: cleanTime(v.time), sys, dia, pulse: pulse !== null && pulse > 0 && pulse <= 400 ? pulse : '' };
      }).filter(Boolean);
      if (Array.isArray(raw.vitals.glucose)) out.vitals.glucose = raw.vitals.glucose.slice(0, BACKUP_LIMITS.vitalsPerKind).filter(isObj).map(v => {
        const value = finite(v.value);
        if (!validDate(v.date) || value === null || value <= 0 || value > 100) return null;
        const gtype = ['空腹', '餐后2小时', '随机'].includes(v.gtype) ? v.gtype : '随机';
        return { id: cleanVitalId(v.id), date: v.date, time: cleanTime(v.time), gtype, value };
      }).filter(Boolean);
      if (Array.isArray(raw.vitals.weight)) out.vitals.weight = raw.vitals.weight.slice(0, BACKUP_LIMITS.vitalsPerKind).filter(isObj).map(v => {
        const value = finite(v.value);
        if (!validDate(v.date) || value === null || value <= 0 || value > 1000) return null;
        return { id: cleanVitalId(v.id), date: v.date, value };
      }).filter(Boolean);
    }

    out.exerciseLog = Object.create(null);
    if (isObj(raw.exerciseLog)) recentDateKeys(raw.exerciseLog).forEach(d => {
      if (Array.isArray(raw.exerciseLog[d])) {
        out.exerciseLog[d] = [...new Set(raw.exerciseLog[d].map(x => text(x, 100)).filter(Boolean))]
          .slice(0, BACKUP_LIMITS.exercisesPerDay);
      }
    });
    out.gameLog = Object.create(null);
    if (isObj(raw.gameLog)) recentDateKeys(raw.gameLog).forEach(d => {
      if (!Array.isArray(raw.gameLog[d])) return;
      out.gameLog[d] = raw.gameLog[d].slice(-BACKUP_LIMITS.gamesPerDay).filter(isObj).map(g => ({
        game: text(g.game, 100),
        score: finite(g.score) ?? 0,
        detail: text(g.detail, 500),
        time: cleanTime(g.time),
      })).filter(g => g.game);
    });
    if (isObj(raw.ui)) out.ui.guideSeen = raw.ui.guideSeen === true;
    return out;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        data = normalizeState(JSON.parse(raw));
      } else data = defaults();
      persistedJSON = JSON.stringify(data);
    } catch (e) {
      console.warn('读取本地数据失败，使用空数据', e);
      data = defaults();
      persistedJSON = JSON.stringify(data);
    }
    return data;
  }

  function save() {
    try {
      data = normalizeState(data);
      const json = JSON.stringify(data);
      localStorage.setItem(KEY, json);
      persistedJSON = json;
      return true;
    } catch (e) {
      console.warn('保存失败', e);
      try { data = normalizeState(JSON.parse(persistedJSON)); }
      catch (_) { data = defaults(); }
      return false;
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
    return save();
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

  /* 历史最长连续天数（用于"断了也不否定过去"的鼓励文案） */
  function bestStreak() {
    const dates = Object.keys(data.exerciseLog)
      .filter(d => (data.exerciseLog[d] || []).length).sort();
    let best = 0, run = 0, prev = null;
    dates.forEach(d => {
      run = (prev && addDays(prev, 1) === d) ? run + 1 : 1;
      if (run > best) best = run;
      prev = d;
    });
    return best;
  }
  /* 最近一次有训练打卡的日期（没有则 null） */
  function lastExerciseDate() {
    const dates = Object.keys(data.exerciseLog)
      .filter(d => (data.exerciseLog[d] || []).length).sort();
    return dates.length ? dates[dates.length - 1] : null;
  }
  /* 两个日期相差几天（b - a） */
  function daysBetween(a, b) {
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  }

  /* 最近 n 天的日期，旧→新（含今天） */
  function recentDates(n, from = today()) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) out.push(addDays(from, -i));
    return out;
  }

  /* ---------- 游戏成绩 ---------- */
  function logGame(game, score, detail) {
    const t = today();
    if (!data.gameLog[t]) data.gameLog[t] = [];
    data.gameLog[t].push({ game, score, detail, time: timeStr() });
    return save();
  }
  function logGameExercise(exId, game, score, detail) {
    const t = today();
    if (!data.gameLog[t]) data.gameLog[t] = [];
    data.gameLog[t].push({ game, score, detail, time: timeStr() });
    if (!data.exerciseLog[t]) data.exerciseLog[t] = [];
    if (!data.exerciseLog[t].includes(exId)) data.exerciseLog[t].push(exId);
    return save();
  }

  /* ---------- 训练/游戏历史 ---------- */
  function exercisesOn(date) { return data.exerciseLog[date] || []; }
  function gamesOn(date) { return data.gameLog[date] || []; }
  /* 累计有训练打卡的天数 */
  function exerciseDaysTotal() {
    return Object.keys(data.exerciseLog).filter(d => (data.exerciseLog[d] || []).length).length;
  }
  /* 有训练打卡或游戏成绩的日期，新→旧 */
  function activeDates() {
    const set = new Set();
    Object.keys(data.exerciseLog).forEach(d => { if ((data.exerciseLog[d] || []).length) set.add(d); });
    Object.keys(data.gameLog).forEach(d => { if ((data.gameLog[d] || []).length) set.add(d); });
    return [...set].sort().reverse();
  }
  /* 训练日历：最近 n 天，旧→新，count=当天训练项数，games=当天游戏局数 */
  function exerciseCalendar(n = 28) {
    return recentDates(n).map(d => ({
      date: d,
      count: exercisesOn(d).length,
      games: gamesOn(d).length,
    }));
  }

  /* ---------- 用药 ---------- */
  /* 新登记的药默认「从今天开始吃」：不写 from 的话，这药会被算进它还没
     开始吃的那些历史日期里，把过去的依从率冤枉成漏服。 */
  function addMed(med) {
    data.meds.push({ id: uid(), ...med, from: validDate(med.from) ? med.from : today(), to: '' });
    return save();
  }
  function updateMed(id, patch) {
    const m = data.meds.find(x => x.id === id);
    if (!m) return false;
    Object.assign(m, patch);
    return save();
  }
  function removeMed(id) {
    data.meds = data.meds.filter(m => m.id !== id);
    Object.keys(data.medLog).forEach(d => {
      Object.keys(data.medLog[d] || {}).forEach(k => {
        if (k.startsWith(id + '@')) delete data.medLog[d][k];
      });
    });
    return save();
  }
  /* 停药：不删记录，只写一个「吃到哪天为止」。
     删除会让这药从所有历史里消失（复诊时说不清吃过什么），
     而留着不管又会让它天天显示"漏服"——所以停药是第三种操作。
     to = 最后一次服药的日期（含当天）；'' 表示还在吃。 */
  function stopMed(id, lastDate = today()) {
    const m = data.meds.find(x => x.id === id);
    if (!m || !validDate(lastDate) || lastDate > today() || (m.from && lastDate < m.from)) return false;
    m.to = lastDate;
    return save();
  }
  /* 停错了：撤销停用，保持同一个疗程和历史核对键。 */
  function undoStopMed(id) {
    const m = data.meds.find(x => x.id === id);
    if (!m || !m.to || !canUndoStop(id)) return false;
    m.to = '';
    return save();
  }
  function canUndoStop(id) {
    return !data.meds.some(m => m.previousCourseId === id);
  }
  /* 医生重新开药：创建一个新疗程，旧疗程保持停用，避免把停药空档
     重新计成应服/漏服。新疗程不能与旧疗程重叠。 */
  function restartMed(id, fromDate = today()) {
    const old = data.meds.find(x => x.id === id);
    if (!old || !old.to || !validDate(fromDate)) return false;
    const from = fromDate <= old.to ? addDays(old.to, 1) : fromDate;
    data.meds.push({
      id: uid(), name: old.name, dose: old.dose || '', times: [...(old.times || [])],
      note: old.note || '', from, to: '', previousCourseId: old.id,
    });
    return save();
  }
  function isMedStopped(m) { return !!m.to; }
  /* 某天在吃的药：从 from 起、到 to 止（都含当天）。
     缺 from/to 的旧数据视为"一直在吃"，保持历史行为不变。 */
  function medsOn(date = today()) {
    return data.meds.filter(m => {
      if (m.from && date < m.from) return false;
      if (m.to && date > m.to) return false;
      return true;
    });
  }
  function activeMeds() { return data.meds.filter(m => !m.to); }
  function stoppedMeds() { return data.meds.filter(m => !!m.to); }
  function medKey(medId, time) { return `${medId}@${time}`; }
  function isMedTaken(medId, time, date = today()) {
    return !!(data.medLog[date] && data.medLog[date][medKey(medId, time)]);
  }
  function toggleMed(medId, time, date = today()) {
    if (!data.medLog[date]) data.medLog[date] = {};
    const k = medKey(medId, time);
    if (data.medLog[date][k]) delete data.medLog[date][k];
    else data.medLog[date][k] = true;
    return save();
  }
  /* 某天该吃几次 / 已核对几次。只算当天在吃的药（停用的、还没开始的都不算） */
  function medCountOn(date) {
    let total = 0, done = 0;
    medsOn(date).forEach(m => (m.times || []).forEach(tm => {
      total++;
      if (isMedTaken(m.id, tm, date)) done++;
    }));
    return { total, done };
  }
  /* 今日应服总次数 / 已服次数 */
  function medProgressToday() { return medCountOn(today()); }
  /* 近7天依从率 */
  function adherence7d() {
    let total = 0, done = 0;
    for (let i = 0; i < 7; i++) {
      const c = medCountOn(addDays(today(), -i));
      total += c.total; done += c.done;
    }
    return total ? Math.round(done / total * 100) : null;
  }
  /* 近 n 天里"当天该吃的都核对了"的天数。
     给患者看的主指标：整数天数比百分比好懂（避免让患者做心算/理解比率）。 */
  function medFullDays(n = 7) {
    let full = 0, counted = 0;
    for (let i = 0; i < n; i++) {
      const c = medCountOn(addDays(today(), -i));
      if (!c.total) continue;
      counted++;
      if (c.done >= c.total) full++;
    }
    return { full, days: counted };
  }

  /* 某天的服药情况。应服次数按**那一天在吃的药**计算（medsOn），
     所以停药、换药之后历史天数的分母不会被改动带偏。
     仍存在的取舍：同一种药中途改剂量/改时间点没有版本记录，
     改完之后历史日期会按新的时间点显示。 */
  function medStatusOn(date) {
    const items = [];
    medsOn(date).forEach(m => (m.times || []).forEach(t => {
      items.push({ medId: m.id, name: m.name, dose: m.dose || '', time: t, taken: isMedTaken(m.id, t, date) });
    }));
    items.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    return { date, total: items.length, done: items.filter(i => i.taken).length, items };
  }
  /* 最近 n 天服药情况，新→旧 */
  function medHistory(n = 14) {
    return recentDates(n).reverse().map(medStatusOn);
  }

  /* ---------- 健康记录 ---------- */
  function addVital(kind, entry) {
    data.vitals[kind].unshift({ id: uid(), ...entry });
    return save();
  }
  function removeVital(kind, id) {
    data.vitals[kind] = data.vitals[kind].filter(v => v.id !== id);
    return save();
  }
  /* 血压/血糖/体重记录：按日期+时间升序。同一天同一分钟的多条，
     按录入先后稳定排序（后录入的视为更新，排最末 = 「最近记录」/展示列表最上） */
  function vitalsSorted(kind) {
    const arr = data.vitals[kind];
    return arr.map((v, i) => ({ v, i }))
      .sort((a, b) => {
        const ka = a.v.date + (a.v.time || ''), kb = b.v.date + (b.v.time || '');
        if (ka !== kb) return ka < kb ? -1 : 1;
        return b.i - a.i; // 同时间：录入晚的（数组下标小）排后面，视为最新
      })
      .map(x => x.v);
  }
  function bpToday() { return data.vitals.bp.some(v => v.date === today()); }

  /* 最新一条与上一条的差值（应用替患者做减法，界面直接给"比上次高了几"）。
     返回 null 表示不足两条；血压返回 {sys, dia}，其余返回 {value}。 */
  function vitalDelta(kind) {
    const s = vitalsSorted(kind);
    if (s.length < 2) return null;
    const cur = s[s.length - 1], prev = s[s.length - 2];
    const d = { prevDate: prev.date, prevTime: prev.time || '' };
    if (kind === 'bp') {
      d.sys = +cur.sys - +prev.sys;
      d.dia = +cur.dia - +prev.dia;
    } else {
      d.value = Math.round((+cur.value - +prev.value) * 10) / 10;
    }
    return d;
  }

  /* ---------- 导出报告 ---------- */
  function exportReport() {
    const lines = [];
    const name = data.profile.name || '患者';
    lines.push(`【${name} 的健康记录】 导出日期：${today()}`);
    const rd = rehabDay();
    if (rd) lines.push(`康复第 ${rd} 天（发病日期 ${data.profile.strokeDate}）`);
    lines.push('');

    lines.push('■ 目前用药');
    const act = activeMeds(), stp = stoppedMeds();
    if (act.length) {
      act.forEach(m => lines.push(`  ${m.name} ${m.dose || ''} 每日${(m.times || []).length}次(${(m.times || []).join('、')})${m.from ? ' 自' + m.from : ''} ${m.note || ''}`.trimEnd()));
      const ad = adherence7d();
      if (ad !== null) lines.push(`  近7天服药完成率：${ad}%`);
    } else lines.push('  （未登记）');
    lines.push('');

    /* 停用的药单独列：复诊时医生常问"这个药吃到什么时候" */
    if (stp.length) {
      lines.push('■ 已停用的药');
      stp.forEach(m => lines.push(`  ${m.name} ${m.dose || ''} ${m.from || '?'} 至 ${m.to} 停用 ${m.note || ''}`.trimEnd()));
      lines.push('');
    }

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

    lines.push(`■ 康复训练：累计打卡 ${exerciseDaysTotal()} 天，当前连续坚持 ${streak()} 天`);
    lines.push('');
    lines.push('（由"脑梗康复助手"导出，数据为患者自行记录，供医生参考）');
    return lines.join('\n');
  }

  /* ---------- 备份导出 / 恢复导入 ---------- */
  function backupEnvelope(state) {
    return {
      app: 'stroke-rehab-assistant',
      schema: BACKUP_SCHEMA,
      exportedAt: `${today()} ${timeStr()}`,
      data: state,
    };
  }
  /* 生成全量备份 JSON 文本（带 schema 版本，便于将来兼容） */
  function exportBackup() {
    /* 不加缩进：接近 5MB 上限时，格式化空白可能让本应用导出的文件反而无法导入。 */
    return JSON.stringify(backupEnvelope(data));
  }

  function utf8Size(s) {
    if (s.length > BACKUP_LIMITS.maxBytes) return BACKUP_LIMITS.maxBytes + 1;
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
    let bytes = 0;
    for (const c of s) {
      const n = c.codePointAt(0);
      bytes += n <= 0x7f ? 1 : n <= 0x7ff ? 2 : n <= 0xffff ? 3 : 4;
    }
    return bytes;
  }

  function encryptionSupported() {
    return typeof crypto !== 'undefined' && !!crypto.subtle
      && typeof TextEncoder !== 'undefined' && typeof TextDecoder !== 'undefined'
      && typeof btoa === 'function' && typeof atob === 'function';
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToBytes(value, label) {
    if (typeof value !== 'string' || !value.length || value.length % 4 !== 0
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error(`${label}格式错误`);
    let binary;
    try { binary = atob(value); } catch (_) { throw new Error(`${label}格式错误`); }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function parseJSONWithLimit(jsonText, maxBytes, tooLargeMessage) {
    if (typeof jsonText !== 'string') throw new Error('不是有效的 JSON 文件');
    if (utf8Size(jsonText) > maxBytes) throw new Error(tooLargeMessage);
    try { return JSON.parse(jsonText); }
    catch (_) { throw new Error('不是有效的 JSON 文件'); }
  }

  function parseEncryptedEnvelope(jsonText) {
    const obj = parseJSONWithLimit(jsonText, BACKUP_LIMITS.maxEncryptedBytes, '加密备份文件超过 8MB');
    if (!isObj(obj) || obj.app !== 'stroke-rehab-assistant' || obj.encrypted !== true
      || obj.encryptionSchema !== ENCRYPTION_SCHEMA || !isObj(obj.encryption)) {
      throw new Error('不是本应用导出的加密备份文件');
    }
    const enc = obj.encryption;
    if (enc.name !== 'AES-GCM' || enc.kdf !== 'PBKDF2' || enc.hash !== 'SHA-256'
      || enc.iterations !== KDF_ITERATIONS) throw new Error('加密备份版本不兼容');
    const salt = base64ToBytes(enc.salt, '加密盐值');
    const iv = base64ToBytes(enc.iv, '加密随机数');
    const ciphertext = base64ToBytes(obj.ciphertext, '加密内容');
    if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) throw new Error('加密备份格式错误');
    return { salt, iv, ciphertext };
  }

  function isEncryptedBackup(jsonText) {
    const obj = parseJSONWithLimit(jsonText, BACKUP_LIMITS.maxEncryptedBytes, '备份文件超过 8MB');
    return isObj(obj) && obj.encrypted === true;
  }

  async function deriveBackupKey(passphrase, salt) {
    const encoder = new TextEncoder();
    const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({
      name: 'PBKDF2', salt, iterations: KDF_ITERATIONS, hash: 'SHA-256',
    }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function exportEncryptedBackup(passphrase) {
    if (!encryptionSupported()) throw new Error('这个浏览器不支持加密备份');
    if (typeof passphrase !== 'string' || passphrase.length < 8) throw new Error('备份密码至少需要 8 个字符');
    if (passphrase.length > 200) throw new Error('备份密码不能超过 200 个字符');
    const plaintext = exportBackup();
    if (utf8Size(plaintext) > BACKUP_LIMITS.maxBytes) throw new Error('当前数据超过 5MB，无法生成可恢复的备份');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveBackupKey(passphrase, salt);
    const encoder = new TextEncoder();
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({
      name: 'AES-GCM', iv, additionalData: encoder.encode(ENCRYPTION_AAD), tagLength: 128,
    }, key, encoder.encode(plaintext)));
    const output = JSON.stringify({
      app: 'stroke-rehab-assistant',
      encrypted: true,
      encryptionSchema: ENCRYPTION_SCHEMA,
      encryption: {
        name: 'AES-GCM', kdf: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ITERATIONS,
        salt: bytesToBase64(salt), iv: bytesToBase64(iv),
      },
      ciphertext: bytesToBase64(ciphertext),
    });
    if (utf8Size(output) > BACKUP_LIMITS.maxEncryptedBytes) throw new Error('加密备份文件超过 8MB');
    return output;
  }

  async function parseEncryptedBackup(jsonText, passphrase) {
    if (!encryptionSupported()) throw new Error('这个浏览器不支持加密备份，请换用最新版手机浏览器');
    if (typeof passphrase !== 'string' || !passphrase.length || passphrase.length > 200) {
      throw new Error('请输入备份密码');
    }
    const { salt, iv, ciphertext } = parseEncryptedEnvelope(jsonText);
    try {
      const key = await deriveBackupKey(passphrase, salt);
      const plaintext = await crypto.subtle.decrypt({
        name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(ENCRYPTION_AAD), tagLength: 128,
      }, key, ciphertext);
      return parseBackup(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
    } catch (e) {
      if (e && /超过|不是本应用|版本不兼容/.test(e.message || '')) throw e;
      throw new Error('密码不正确，或备份文件已损坏');
    }
  }

  /* 恢复文件来自应用外部：超限一律拒绝，不静默截断健康记录。 */
  function validateBackupLimits(raw) {
    const tooMany = (actual, max, label) => {
      if (actual > max) throw new Error(`${label}超过上限（最多 ${max}）`);
    };
    if (Array.isArray(raw.meds)) {
      tooMany(raw.meds.length, BACKUP_LIMITS.meds, '药物数量');
      raw.meds.filter(isObj).forEach(m => {
        if (Array.isArray(m.times)) tooMany(m.times.length, BACKUP_LIMITS.timesPerMed, '单种药的服药时间数量');
      });
    }
    if (isObj(raw.vitals)) ['bp', 'glucose', 'weight'].forEach(k => {
      if (Array.isArray(raw.vitals[k])) tooMany(raw.vitals[k].length, BACKUP_LIMITS.vitalsPerKind, '单类健康记录数量');
    });
    [
      ['medLog', BACKUP_LIMITS.medChecksPerDay, '单日服药核对数量'],
      ['exerciseLog', BACKUP_LIMITS.exercisesPerDay, '单日训练记录数量'],
      ['gameLog', BACKUP_LIMITS.gamesPerDay, '单日游戏记录数量'],
    ].forEach(([key, perDay, label]) => {
      if (!isObj(raw[key])) return;
      const days = Object.keys(raw[key]);
      tooMany(days.length, BACKUP_LIMITS.logDays, `${key} 日期数量`);
      days.forEach(d => {
        const day = raw[key][d];
        const count = Array.isArray(day) ? day.length : isObj(day) ? Object.keys(day).length : 0;
        tooMany(count, perDay, label);
      });
    });
  }

  /* 解析并校验备份文本，返回 { data, exportedAt }，不写入、不保存。
     必须能识别为我们的数据结构，否则抛错——防止误选任意文件把数据清空。 */
  function parseBackup(jsonText) {
    const obj = parseJSONWithLimit(jsonText, BACKUP_LIMITS.maxBytes, '备份文件超过 5MB');
    if (!isObj(obj)) throw new Error('不是本应用导出的备份文件');

    const hasEnvelope = Object.prototype.hasOwnProperty.call(obj, 'app');
    if (hasEnvelope) {
      if (obj.app !== 'stroke-rehab-assistant' || !isObj(obj.data)) throw new Error('不是本应用导出的备份文件');
      if (obj.schema !== BACKUP_SCHEMA) throw new Error(`备份版本不兼容（需要版本 ${BACKUP_SCHEMA}）`);
    }
    const incoming = hasEnvelope ? obj.data : obj;

    const looksOurs = hasEnvelope
      || ['profile', 'meds', 'medLog', 'vitals', 'exerciseLog', 'gameLog', 'ui'].some(k => {
        const v = incoming[k];
        return k === 'meds' ? Array.isArray(v) : isObj(v);
      });
    if (!looksOurs) throw new Error('不是本应用导出的备份文件（未识别到数据结构）');

    validateBackupLimits(incoming);
    return { data: normalizeState(incoming), exportedAt: text(obj.exportedAt, 100) };
  }

  /* 覆盖前先保存一个恢复点；恢复点写不下时宁可拒绝，也不冒险覆盖原数据。 */
  function applyBackup(state) {
    backupErrorMessage = '';
    let priorRecovery;
    try {
      priorRecovery = localStorage.getItem(RECOVERY_KEY);
      const recoveryJSON = JSON.stringify(backupEnvelope(normalizeState(data)));
      localStorage.setItem(RECOVERY_KEY, recoveryJSON);
    } catch (e) {
      backupErrorMessage = '没有建立恢复点，未覆盖现有数据。请检查浏览器存储空间后重试';
      return false;
    }
    data = normalizeState(state);
    if (save()) return true;
    try {
      if (priorRecovery === null) localStorage.removeItem(RECOVERY_KEY);
      else localStorage.setItem(RECOVERY_KEY, priorRecovery);
    } catch (_) { /* 主数据已由 save() 回滚，恢复点回滚失败不影响现有记录 */ }
    backupErrorMessage = '恢复文件没有保存成功，原有数据未改变';
    return false;
  }

  function hasRecoveryBackup() {
    try {
      const raw = localStorage.getItem(RECOVERY_KEY);
      if (!raw) return false;
      parseBackup(raw);
      return true;
    } catch (_) { return false; }
  }

  function undoLastRestore() {
    backupErrorMessage = '';
    let parsed;
    try {
      const raw = localStorage.getItem(RECOVERY_KEY);
      if (!raw) throw new Error('没有可撤销的恢复记录');
      parsed = parseBackup(raw);
    } catch (e) {
      backupErrorMessage = e.message || '恢复点已经损坏';
      return false;
    }
    data = parsed.data;
    if (!save()) {
      backupErrorMessage = '没有恢复成功，当前数据未改变';
      return false;
    }
    try { localStorage.removeItem(RECOVERY_KEY); }
    catch (_) { /* 主数据已经恢复，残留恢复点不影响结果 */ }
    return true;
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
    /* 先清理恢复点：若清理失败就不要让“清空成功”后仍能撤销出旧健康数据。 */
    try { localStorage.removeItem(RECOVERY_KEY); }
    catch (e) {
      backupErrorMessage = '无法清理恢复点，未清空现有数据。请检查浏览器存储权限后重试';
      return false;
    }
    data = defaults();
    if (!save()) return false;
    return true;
  }

  return {
    load, save,
    get data() { return data; },
    today, timeStr, addDays, weekdayCN, rehabDay, recentDates, daysBetween,
    logExercise, exercisesDoneToday, isExDone, streak, bestStreak, lastExerciseDate,
    exercisesOn, exerciseDaysTotal, activeDates, exerciseCalendar,
    logGame, logGameExercise, gamesOn,
    addMed, updateMed, removeMed, isMedTaken, toggleMed, medProgressToday, adherence7d,
    stopMed, undoStopMed, restartMed, canUndoStop, isMedStopped, medsOn, activeMeds, stoppedMeds, medCountOn,
    medFullDays, medStatusOn, medHistory,
    addVital, removeVital, vitalsSorted, bpToday, vitalDelta,
    exportReport, resetAll,
    exportBackup, parseBackup, applyBackup, backupSummary,
    encryptionSupported, isEncryptedBackup, exportEncryptedBackup, parseEncryptedBackup,
    hasRecoveryBackup, undoLastRestore,
    backupError: () => backupErrorMessage,
    get backupLimits() { return BACKUP_LIMITS; },
    guideSeen: () => !!data.ui.guideSeen,
    markGuideSeen: () => { data.ui.guideSeen = true; return save(); },
  };
})();
