/* ============================================================
   今日页（三件事 + 今日推荐训练）。视图只读 Store、只拼 HTML，数据变更走 Store 再 render()。
   ============================================================ */

/* ============================================================
   【区】今日页
   ============================================================ */
function renderToday() {
  const p = Store.data.profile;
  const now = new Date();
  const h = now.getHours();
  const greet = h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好';
  const name = p.name ? `，${esc(p.name)}` : '';
  const rd = Store.rehabDay();
  const streak = Store.streak();

  const plan = (DAILY_PLAN[p.stage] || DAILY_PLAN.sitting)
    .map(id => EXERCISES.find(e => e.id === id)).filter(Boolean);
  const doneIds = Store.exercisesDoneToday();
  const planDone = plan.filter(e => doneIds.includes(e.id)).length;
  const mp = Store.medProgressToday();
  const bpDone = Store.bpToday();

  const stageName = (STAGES.find(s => s.key === p.stage) || {}).name || '';

  const medDone = mp.total > 0 && mp.done >= mp.total;
  const trainDone = plan.length > 0 && planDone >= plan.length;
  /* 三件事里"已经做到"的件数：只用来说一句肯定的话，不做评分 */
  const thingsDone = [bpDone, medDone, trainDone].filter(Boolean).length;
  const summary = thingsDone === 3
    ? '今天三件事都做到了，很稳。'
    : thingsDone > 0
      ? `今天已经做到 ${thingsDone} 件，剩下的慢慢来就好。`
      : '一天做一点就好，从最容易的一件开始。';

  /* 连续天数断了不清零、不指责：先肯定过去，再把重新开始说成很轻的一步 */
  const best = Store.bestStreak();
  const last = Store.lastExerciseDate();
  let streakHTML = '';
  if (streak > 0) {
    streakHTML = `<div class="streak-chip">🔥 已连续坚持训练 ${streak} 天</div>`;
  } else if (last) {
    const gap = Store.daysBetween(last, Store.today());
    streakHTML = `<div class="streak-chip">🌱 ${gap <= 2 ? '歇了一下没关系' : '欢迎回来'}${best > 1 ? `，之前最长连续 ${best} 天` : ''}，今天做一个动作就重新开始</div>`;
  }

  let html = `
  <div class="today-hero">
    <div class="date-line">${now.getMonth() + 1}月${now.getDate()}日 ${Store.weekdayCN(now)}</div>
    <h1 class="greet" tabindex="-1">${greet}${name}</h1>
    ${rd ? `<div class="rehab-day">今天是康复第 <b>${rd}</b> 天，每一天都算数</div>`
         : `<div class="rehab-day">坚持康复，每一天都算数</div>`}
    ${streakHTML}
  </div>

  <div class="card">
    <h2 class="card-title">今日三件事</h2>
    <div class="today-summary">${summary}</div>
    <div class="check-item ${bpDone ? 'done' : ''}">
      <div class="ci-icon" aria-hidden="true">🩺</div>
      <div class="ci-body">
        <div class="ci-name">测量血压</div>
        <div class="ci-sub">${bpDone ? '今天记好了 ✓' : '每天固定时间测量并记录'}</div>
      </div>
      <button class="ci-action ${bpDone ? 'done' : ''}" data-go="records" data-rec="bp">${bpDone ? '已完成' : '去记录'}</button>
    </div>
    <div class="check-item ${medDone ? 'done' : ''}">
      <div class="ci-icon" aria-hidden="true">💊</div>
      <div class="ci-body">
        <div class="ci-name">按时服药</div>
        <div class="ci-sub">${mp.total
          ? (medDone ? '今天该吃的都核对了 ✓' : leftText(mp.done, mp.total, '次没核对'))
          : '先到「用药」页登记药物'}</div>
        ${mp.total ? dotsHTML(mp.done, mp.total) : ''}
      </div>
      <button class="ci-action ${medDone ? 'done' : ''}" data-go="meds">${medDone ? '已完成' : '去核对'}</button>
    </div>
    <div class="check-item ${trainDone ? 'done' : ''}">
      <div class="ci-icon" aria-hidden="true">💪</div>
      <div class="ci-body">
        <div class="ci-name">康复训练</div>
        <div class="ci-sub">${esc(stageName)}${trainDone ? '推荐都练过了 ✓' : ' · ' + leftText(planDone, plan.length, '项')}</div>
        ${dotsHTML(planDone, plan.length)}
      </div>
      <button class="ci-action ${trainDone ? 'done' : ''}" data-go="train">${trainDone ? '已完成' : '去训练'}</button>
    </div>
  </div>

  <div class="card">
    <h2 class="card-title">今日推荐训练 <span class="card-meta">${esc(stageName)}</span></h2>
    ${plan.map(e => exItemHTML(e, doneIds.includes(e.id))).join('')}
    <div class="muted" style="margin-top:0.5rem">阶段不符？到「训练」页可切换康复阶段。</div>
  </div>

  <div class="disclaimer">本应用是家庭康复辅助工具，不能替代医生的诊断和治疗。<br>训练内容请经康复医生评估后进行，身体不适立即停止并就医。</div>`;

  $view().innerHTML = html;

  $view().querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
    if (b.dataset.rec) recTab = b.dataset.rec;
    go(b.dataset.go);
  });
  bindExItems($view());
}

/* 训练条目公共 HTML（今日推荐 & 训练库共用）：行样式由 CSS 的 .ex-item 统一给，
   今天页在 .card 里、训练库在 #ex-list 分组卡里，都是"一卡多行"的分组列表 */
function exItemHTML(e, done) {
  return `
  <div class="ex-item">
    <div class="ex-icon" aria-hidden="true">${e.icon}</div>
    <div class="ex-body">
      <div class="ex-name">${e.name}</div>
      <div class="ex-dose">${e.dose}</div>
      ${done ? '<div class="ex-done-mark">✓ 今日已完成</div>' : ''}
    </div>
    <button class="ex-start ${done ? 'done' : ''}" data-ex="${e.id}" aria-label="${done ? '再练一次' : '开始'}：${esc(e.name)}">${done ? '再练一次' : '开始'}</button>
  </div>`;
}
function bindExItems(root) {
  root.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => {
    const ex = EXERCISES.find(x => x.id === b.dataset.ex);
    if (ex) openTrainer(ex);
  });
}
