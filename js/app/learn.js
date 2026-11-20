/* ============================================================
   知识页 + 急救弹窗（BE-FAST + 拨 120）。文章内容在 data-articles.js。
   ============================================================ */

/* ============================================================
   【区】知识页
   ============================================================ */
function renderLearn() {
  const groups = [];
  ARTICLES.forEach(a => { if (!groups.includes(a.group)) groups.push(a.group); });

  let html = `
  ${pageHeading('康复知识', '常用知识，和家人一起慢慢了解。')}
  <div class="card" style="border:2px solid var(--red)">
    <div class="card-title" style="color:var(--red)">🚨 出现这些情况，立即拨打120</div>
    <div class="muted" style="margin-bottom:0.5rem">口角歪斜 · 单侧肢体无力 · 说话不清 · 突然看不清 · 走不稳</div>
    <button class="btn red block" id="btn-open-emergency">查看急救指引 + 拨打120</button>
  </div>
  ${groups.map(g => `
    <h2 class="section-label">${esc(g)}</h2>
    <div class="list-group">
      ${ARTICLES.filter(a => a.group === g).map(a => `
        <button type="button" class="art-item" data-art="${a.id}" aria-labelledby="art-title-${a.id}" aria-describedby="art-sub-${a.id}">
          <span class="art-icon" aria-hidden="true">${a.icon}</span>
          <span class="art-body">
            <strong class="art-title" id="art-title-${a.id}">${a.title}</strong>
            <span class="art-sub" id="art-sub-${a.id}">${a.sub}</span>
          </span>
          <span class="art-arrow" aria-hidden="true">›</span>
        </button>`).join('')}
    </div>
  `).join('')}
  <div class="disclaimer">内容参考国内卒中防治与康复指南整理，仅作健康教育用途，<br>不能替代医生的诊断和治疗建议。</div>`;

  $view().innerHTML = html;

  document.getElementById('btn-open-emergency').onclick = openEmergency;
  $view().querySelectorAll('[data-art]').forEach(elm => {
    elm.onclick = () => {
      const a = ARTICLES.find(x => x.id === elm.dataset.art);
      if (a) {
        const sb = speakBtnHTML('art-speak', '听这篇');
        const node = nodeFromHTML(
          `${sb ? `<div class="speak-row">${sb}</div>` : ''}<div class="article-view">${a.body}</div>`);
        openModal(a.title, node);
        bindSpeak(node.querySelector('#art-speak'), () => articleSpeechText(a));
      }
    };
  });
}

/* ============================================================
   【区】紧急弹窗（BE-FAST + 拨 120）
   ============================================================ */
function openEmergency() {
  if (document.querySelector('.emergency-view')) return;
  const trainer = document.getElementById('trainer');
  if (trainer && trainer._pause) trainer._pause();
  const node = nodeFromHTML(`
    <div class="emergency-view">
      <div class="emergency-action">
        <div class="ev-title">疑似中风，立即行动！</div>
        <a class="call-120" href="tel:120">📞 立即拨打 120</a>
        <p class="muted">未打开拨号界面时，请用手机直接拨打 120。</p>
      </div>
      <div class="card" style="margin-bottom:0.8rem">
        ${BEFAST.map(b => `
          <div class="befast-item">
            <div class="bf-letter">${b.letter}</div>
            <div><div class="bf-name">${b.name}</div><div class="bf-desc">${b.desc}</div></div>
          </div>`).join('')}
      </div>
      <div class="card">
        <div class="card-title">同时要做的事</div>
        <ul style="padding-left:1.3rem">
          <li><b>记下发病时间</b>（最后一次看起来正常是几点）</li>
          <li>让患者平卧，头偏向一侧，解开衣领</li>
          <li><b>不要喂水、喂药、喂任何东西</b></li>
          <li>症状缓解了也要就医，不要"再观察观察"</li>
        </ul>
      </div>
    </div>`);
  openModal('紧急识别', node, { emergency: true });
}
