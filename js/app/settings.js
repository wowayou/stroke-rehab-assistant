/* ============================================================
   设置弹窗 + 字号/音色套用（applyFont/applyVoice）+ 换更自然的声音引导 + 首次指引
   字号/语速/音色是即时生效型设置（硬约定 9，回归：node test/settings.test.js）
   ============================================================ */

/* ============================================================
   【区】设置弹窗
   ============================================================ */
function openSettings() {
  const p = Store.data.profile;
  const revision = settingsRevision;
  /* 音色选项＝这台机器上真有的中文音色，只有两个以上才值得让用户选。
     不做"跟随系统"这一档：那是给开发者的概念，患者只想知道"现在是哪个声音"。
     高亮取真正在用的那个（存的名字在本机不存在时 Speech 已回落），
     保证"看到高亮的"和"按下听到的"永远是同一个声音。 */
  const voiceOpts = (Speech.supported() ? Speech.voices() : [])
    .map(v => ({ key: v.name, label: v.label, cls: 'f1' }));
  const voiceCurrent = () => {
    const want = Store.data.profile.speechVoice;
    return voiceOpts.some(o => o.key === want) ? want : Speech.voiceName();
  };
  const node = nodeFromHTML(`
    <div class="card">
      <div class="card-title">👤 基本信息</div>
      <div class="setting-row">
        <label class="sr-label" for="set-name">怎么称呼您</label>
        <input id="set-name" class="set-input" type="text" value="${esc(p.name)}" placeholder="如 王叔叔">
      </div>
      <div class="setting-row">
        <label class="sr-label" for="set-stroke-date">发病日期</label>
        <input id="set-stroke-date" class="set-input" type="date" value="${esc(p.strokeDate)}" max="${Store.today()}">
      </div>
      <div class="setting-row">
        <label class="sr-label" for="set-height">身高(cm)</label>
        <input id="set-height" class="set-input" type="number" inputmode="numeric" value="${esc(p.height)}" placeholder="算BMI用">
      </div>
    </div>
    <div class="card">
      <div class="card-title">🔊 显示与朗读</div>
      <div class="setting-row">
        <div class="sr-label">字体大小</div>
        ${segGroupHTML('font', '字体大小', FONT_OPTIONS, p.font)}
      </div>
      <div class="muted seg-hint">点一下立刻变大，不用再按保存。</div>
      ${Speech.supported() ? `
      <div class="setting-row">
        <div class="sr-label">朗读语速</div>
        ${segGroupHTML('rate', '朗读语速', RATE_OPTIONS, p.speechRate)}
      </div>
      <div class="muted">点一下就按这个速度念一句给您听，选好即生效。训练动作和科普文章里都有「<span class="nowrap">🔊 听一遍</span>」，读字费劲时可以让它念。<button class="link-btn" id="set-rate-try">再听一句</button></div>
      <div class="muted seg-hint">觉得声音太生硬？<button class="link-btn" id="set-voice-guide">教您换更自然的声音 →</button></div>
      ${voiceOpts.length > 1 ? `
      <div class="setting-row setting-stack">
        <div class="sr-label">朗读声音</div>
        ${segGroupHTML('voice', '朗读声音', voiceOpts, voiceCurrent())}
      </div>
      <div class="muted seg-hint">这台手机装了 ${voiceOpts.length} 个中文声音，点一下试听，挑个您听着舒服的。</div>
      ` : ''}
      ` : '<div class="muted">这个浏览器不支持语音朗读（换手机自带浏览器打开通常可用）。</div>'}
    </div>
    <div class="card">
      <div class="card-title">🎯 个人目标值（遵医嘱）</div>
      <div class="setting-row">
        <label class="sr-label" for="set-bpsys">血压高压目标</label>
        <input id="set-bpsys" class="set-input" type="number" inputmode="numeric" value="${esc(p.targets.bpSys)}"><span class="muted"> mmHg</span>
      </div>
      <div class="setting-row">
        <label class="sr-label" for="set-bpdia">血压低压目标</label>
        <input id="set-bpdia" class="set-input" type="number" inputmode="numeric" value="${esc(p.targets.bpDia)}"><span class="muted"> mmHg</span>
      </div>
      <div class="setting-row">
        <label class="sr-label" for="set-glufast">血糖空腹目标</label>
        <input id="set-glufast" class="set-input" type="number" step="0.1" inputmode="decimal" value="${esc(p.targets.gluFast)}"><span class="muted"> mmol/L</span>
      </div>
      <div class="setting-row">
        <label class="sr-label" for="set-glupost">血糖餐后2h目标</label>
        <input id="set-glupost" class="set-input" type="number" step="0.1" inputmode="decimal" value="${esc(p.targets.gluPost)}"><span class="muted"> mmol/L</span>
      </div>
      <div class="muted" style="margin-top:0.4rem">目标值按医生要求填写，图上会画出目标区、超过会提示"偏高"；血压 180/110、血糖极低/明显偏高等危险情况仍会单独警示。默认 140/90、空腹 7.0、餐后 10.0 仅为一般参考，以医嘱为准。</div>
    </div>
    <div class="section-label">使用帮助</div>
    <div class="card action-list">
      <button class="btn ghost block" id="set-guide">❓ 查看使用指引</button>
      <button class="btn ghost block" id="set-export" style="margin-top:0.6rem">📤 导出健康记录（给医生）</button>
    </div>
    <div class="section-label">数据与备份</div>
    <div class="card action-list">
      <div class="notice">记录只在当前浏览器里。换手机、换浏览器或换网址前，请先下载备份。${IS_IOS ? '苹果手机上，桌面图标和 Safari 里的记录也是分开存的，不会自动同步。' : ''}${IN_WECHAT ? `<br><b>现在是在微信里打开的</b>：记录存在微信里，清理微信缓存时可能被一起清掉，也不能下载备份文件。${WECHAT_ADVICE}` : ''}</div>
      ${Store.originalData() !== null ? '<button class="btn outline block" id="set-original">下载原始数据副本（供排查）</button>' : ''}
      <button class="btn ghost block" id="set-backup" style="margin-top:0.6rem">📦 备份全部数据（下载文件）</button>
      <div id="backup-age">${backupAgeHTML()}</div>
      <button class="btn ghost block" id="set-restore" style="margin-top:0.6rem">♻️ 从备份恢复</button>
      <input type="file" id="set-restore-input" accept=".json,application/json" style="display:none">
      <button class="link-btn" id="set-restore-paste">备份是复制下来的一段文字？点这里粘贴恢复</button>
      ${Store.hasRecoveryBackup() ? `
        <button class="btn outline block" id="set-undo-restore" style="margin-top:0.6rem">↩️ 撤销上次恢复</button>
        <div class="muted" style="margin-top:0.35rem">可恢复到上次导入备份前的数据，只能撤销一次。</div>` : ''}
      <button class="btn outline block" id="set-reset" style="margin-top:0.6rem;color:var(--red)">清空全部数据</button>
      <div class="muted" style="margin-top:0.6rem">本应用不会上传数据。健康记录保存在这台设备的浏览器里；共用手机时，能使用这个浏览器的人可能看到这些记录。清空缓存或换手机会丢数据，请定期备份。</div>
    </div>
    <p class="muted">称呼、发病日期、身高和目标值填写后，请按「保存设置」。</p>
    <button class="btn block" id="set-save">保存设置</button>`);

  const close = openModal('设置', node);
  close.onResume(() => {
    if (revision !== settingsRevision) {
      const y = node.closest('.modal-panel').scrollTop;
      close.replace(openSettings);
      topOverlay().querySelector('.modal-panel').scrollTop = y;
    }
  });
  const original = node.querySelector('#set-original');
  if (original) original.onclick = () => {
    if (!confirm('原始副本可能包含健康隐私，仅供本人或可信家人排查。继续下载吗？')) return;
    try {
      saveBackupFile(Store.originalData(), false, '原始数据待修复');
      toast('已发起下载；这不是可直接恢复的备份，请妥善保存');
    } catch (e) { showError(node, '没有下载成功，请重试；原始内容仍保留在浏览器里'); }
  };

  /* 字号/语速是「即时生效」型设置：点一下就落盘。
     绝不能等「保存设置」——弹窗有 ✕/返回键/Esc/点遮罩四种关法，
     等保存会让已经生效的字号丢掉，下次打开回显成旧值（v0.2.25 修复的 bug）。 */
  bindSegGroup(node, 'font', {
    current: () => Store.data.profile.font,
    commit: key => commitProfile(
      pf => { pf.font = key; },
      () => applyFont(Store.data.profile.font),
    ),
  });
  /* 语速：点一下即按新速度念一句，让用户用耳朵选而不是猜"适中"是多快 */
  bindSegGroup(node, 'rate', {
    current: () => Store.data.profile.speechRate,
    commit: key => {
      const ok = commitProfile(pf => { pf.speechRate = key; });
      if (ok) Speech.speak('这是朗读速度，听得清吗？', { rateKey: Store.data.profile.speechRate });
      return ok;
    },
  });
  /* 音色：同样点一下即试听。先 setVoice 再念，让耳朵听到的就是刚点的那个。
     落盘失败时 commitProfile 已把 profile 读回旧值，这里按旧值再套一次，
     免得"存没存上"和"正在用哪个声音"对不上。 */
  bindSegGroup(node, 'voice', {
    current: voiceCurrent,
    commit: key => {
      const ok = commitProfile(pf => { pf.speechVoice = key; });
      applyVoice(Store.data.profile.speechVoice);
      if (ok) Speech.speak('您好，以后就用这个声音念给您听。', { rateKey: Store.data.profile.speechRate });
      return ok;
    },
  });
  const tryBtn = node.querySelector('#set-rate-try');
  if (tryBtn) tryBtn.onclick = () =>
    Speech.speak('每天坚持一点，慢慢会好起来。', { rateKey: Store.data.profile.speechRate });
  /* 帮助与独立任务作为子层打开，保留设置草稿；任务内部步骤才用 replace。 */
  const voiceGuideBtn = node.querySelector('#set-voice-guide');
  if (voiceGuideBtn) voiceGuideBtn.onclick = openVoiceGuide;
  node.querySelector('#set-guide').onclick = () => openGuide({ review: true });
  node.querySelector('#set-export').onclick = openExport;
  node.querySelector('#set-backup').onclick = openBackupWarning;
  node.querySelector('#set-restore').onclick = () => { node.querySelector('#set-restore-input').click(); };
  node.querySelector('#set-restore-paste').onclick = openPasteRestore;
  const undoRestore = node.querySelector('#set-undo-restore');
  if (undoRestore) undoRestore.onclick = () => {
    if (!confirm('撤销后，当前恢复进来的全部数据会被替换。确定回到恢复前的数据吗？')) return;
    if (!Store.undoLastRestore()) {
      showError(node, Store.backupError() || '没有撤销成功，当前数据未改变');
      renderStorageNotice();
      return;
    }
    close();
    clearRecordSession();
    applyFont(Store.data.profile.font);
    applyVoice(Store.data.profile.speechVoice);
    render(currentView, { keepScroll: true });
    toast('已撤销上次恢复');
  };
  node.querySelector('#set-restore-input').onchange = () => {
    const fileInput = node.querySelector('#set-restore-input');
    const file = fileInput.files[0];
    fileInput.value = ''; // 重选同一文件也必须触发 change。
    if (!file) return;
    if (file.size > Store.backupLimits.maxEncryptedBytes) { showError(node, '备份文件超过 8MB，未读取'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (!close.active()) return;
      const jsonText = String(reader.result);
      try {
        if (Store.isEncryptedBackup(jsonText)) {
          if (!Store.encryptionSupported()) { toast('这个浏览器不能打开加密备份，请换用最新版手机浏览器'); return; }
          openEncryptedRestore(jsonText, file.name);
        } else {
          const parsed = Store.parseBackup(jsonText);
          openRestorePreview(parsed, file.name);
        }
      } catch (e) { showError(node, '恢复失败：' + e.message); }
    };
    reader.onerror = () => { if (close.active()) showError(node, '文件没有读成功，请重新选择已下载到本机的备份文件'); };
    reader.readAsText(file);
  };
  node.querySelector('#set-reset').onclick = () => {
    if (confirm('确定清空全部数据？此操作无法恢复！')) {
      if (confirm('再次确认：血压记录、用药、训练打卡都会被删除。')) {
        if (!stored(Store.resetAll())) return;
        clearRecordSession();
        close();
        applyFont('normal');
        applyVoice('');
        render(currentView, { keepScroll: true });
        toast('已清空');
      }
    }
  };
  node.querySelector('#set-save').onclick = () => {
    /* 字号与语速不在这里读：它们点一下就已经落盘了（见上方 bindSegGroup）。
       若在此按 DOM 再赋一次值，任何时序差都会把已生效的偏好覆盖回旧值。 */
    const g = id => +node.querySelector(id).value;
    const bs = g('#set-bpsys'), bd = g('#set-bpdia'), gf = g('#set-glufast'), gp = g('#set-glupost');
    if (!(bs >= 60 && bs <= 260) || !(bd >= 30 && bd <= 200)) { showError(node, '请输入有效的血压目标值'); return; }
    if (bs <= bd) { showError(node, '高压目标应高于低压目标'); return; }
    if (!(gf >= 3 && gf <= 20) || !(gp >= 3 && gp <= 30)) { showError(node, '请输入有效的血糖目标值'); return; }
    /* 以前这两项不校验：按米填的身高（1.7）会算出几十万的 BMI；将来的发病日期被静默丢掉 */
    const heightRaw = node.querySelector('#set-height').value.trim();
    const [hMin, hMax] = Store.heightRange;
    if (heightRaw && !(+heightRaw >= hMin && +heightRaw <= hMax)) { showError(node, '身高请按厘米填写，比如 165'); return; }
    const strokeDate = node.querySelector('#set-stroke-date').value;
    if (strokeDate && strokeDate > Store.today()) { showError(node, '发病日期不能晚于今天，请核对'); return; }
    if (strokeDate && strokeDate < '1900-01-01') { showError(node, '发病日期好像填错了年份，请核对'); return; }
    const p2 = Store.data.profile;
    p2.name = node.querySelector('#set-name').value.trim();
    p2.strokeDate = strokeDate;
    p2.height = heightRaw;
    p2.targets = { bpSys: bs, bpDia: bd, gluFast: gf, gluPost: gp };
    if (!stored(Store.save())) return;
    close();
    render(currentView, { keepScroll: true, preserveInputs: true });
    toast('设置已保存');
  };
}

/* 上次在这台设备下载备份是哪天：本地存储的应用，丢数据的头号原因是从没备份过。
   家属打开设置时一眼能看到；超过 30 天且确有记录时提醒再下一份。不在今日页催患者。 */
function backupAgeHTML() {
  const s = Store.backupSummary(Store.data);
  const hasData = s.meds + s.bp + s.glucose + s.weight + s.checkinDays > 0;
  const d = Store.lastBackupAt();
  if (!d) return hasData ? '<div class="muted backup-age due">这台设备上还没有下载过备份。</div>' : '';
  const n = Math.max(0, Store.daysBetween(d, Store.today()));
  const when = n === 0 ? '今天' : n === 1 ? '昨天' : `${n} 天前（${+d.slice(5, 7)}月${+d.slice(8, 10)}日）`;
  const due = hasData && n >= 30;
  return `<div class="muted backup-age${due ? ' due' : ''}">上次下载备份：${when}。${due ? '记录又多了不少，建议再下载一份。' : ''}</div>`;
}

function applyFont(f) {
  if (f === 'large' || f === 'xlarge') document.documentElement.dataset.font = f;
  else delete document.documentElement.dataset.font;
}
/* 把存着的音色告诉朗读层。和 applyFont 一样，凡是整体换掉 data 的地方
   （启动、恢复备份、撤销恢复、清空）都要重新套一次，否则朗读还用着上一份数据的音色。
   机上没有这个音色时 Speech 内部静默回落，这里不需要判断。 */
function applyVoice(name) {
  if (Speech.supported()) Speech.setVoice(name || '');
}

/* ============================================================
   【区】换更自然的朗读声音（图文引导）
   朗读"机器味"最有效的一招其实在手机系统里：多数手机能免费下载更自然的
   中文语音包，装一次长期可用。这里只教怎么找——不装任何东西、不联网、
   不碰第三方脚本（隐私红线）。系统菜单名各机型/版本不同，措辞留有余地，
   宁可让用户"搜一下"，也不给一个找不到的精确按钮名误导老人。 */
function openVoiceGuide() {
  const node = nodeFromHTML(`
    <div class="guide">
      <p class="guide-sub">觉得声音生硬，多半是手机默认的声音不够好。很多手机里可以<b>免费下载更自然的中文声音</b>，装一次就一直能用。下面教您怎么找。</p>
      <div class="card">
        <div class="card-title">🍎 苹果手机（iPhone）</div>
        <div class="guide-line">大致这样找：<b>设置 → 辅助功能 → 朗读内容 → 声音 → 中文</b></div>
        <div class="guide-line">挑一个名字后面带「增强／高质量」的声音，点旁边的下载按钮，装好回到本应用就会更自然。</div>
        <div class="muted">不同 iOS 版本菜单名略有不同，找不到就在手机「设置」顶部搜索框里搜「朗读」。</div>
      </div>
      <div class="card">
        <div class="card-title">🤖 安卓手机</div>
        <div class="guide-line">大致这样找：在手机「设置」里搜<b>「文字转语音」</b>（有的在 系统 → 语言和输入 里）。</div>
        <div class="guide-line">打开「首选引擎／文字转语音输出」，选一个语音服务，再进去<b>下载／安装中文语音数据</b>，挑带「自然」字样的。</div>
        <div class="muted">各品牌（华为／小米／OPPO／vivo 等）菜单名不一样，找不到就搜「您的手机型号 + 文字转语音 下载中文」。</div>
      </div>
      <div class="card">
        <div class="card-title">💬 在微信里点了没声音？</div>
        <div class="guide-line">微信内置浏览器有时不出声。点微信右上角「···」→「在浏览器打开」，用手机<b>自带浏览器</b>打开本应用再试。</div>
      </div>
      <div class="guide-line" style="margin-top:0.3rem">换好声音后，回到「设置」，如果「朗读声音」里出现好几个，挑一个您听着最舒服的就行。</div>
      <div class="disclaimer">以上都是手机系统自带的功能。本应用<b>不会安装任何东西，也不联网</b>，只是用手机里已有的声音念给您听。</div>
      <button class="btn green block huge" id="voice-guide-done" style="margin-top:0.7rem">我知道了</button>
    </div>`);
  const close = openModal('换更自然的朗读声音', node, { center: true });
  node.querySelector('#voice-guide-done').onclick = close;
}

/* ============================================================
   【区】首次使用指引
   ============================================================ */
function openGuide({ review = false } = {}) {
  const node = nodeFromHTML(`
    <div class="guide">
      <div class="guide-hero">🌱 欢迎使用<br>脑梗康复助手</div>
      <p class="guide-sub">帮脑梗恢复期的家人一起坚持康复。<br><b>所有数据只保存在这台设备</b>，不会上传到任何地方。</p>
      <div class="card">
        <div class="card-title">📋 每天先做这三件事</div>
        <div class="guide-step"><span class="gs-num">1</span><div><b>测血压</b><br><span class="muted">固定时间测量，「今日」页点「去记录」</span></div></div>
        <div class="guide-step"><span class="gs-num">2</span><div><b>按时服药</b><br><span class="muted">按医嘱吃完，在「用药」页点一下核对</span></div></div>
        <div class="guide-step"><span class="gs-num">3</span><div><b>康复训练</b><br><span class="muted">「训练」页按阶段选动作，做完点打卡</span></div></div>
      </div>
      <div class="card">
        <div class="card-title">🔧 还要会用</div>
        <div class="guide-line">📈 「记录」页：血压/血糖/体重，复诊时一键导出给医生</div>
        <div class="guide-line">📚 「知识」页：防复发科普；🚨 急救卡，疑似中风立即拨 120</div>
        <div class="guide-line">⚙️ 「设置」：填发病日期、身高，可调大字体</div>
      </div>
      <div class="card">
        <div class="card-title">🤝 用之前想说三句</div>
        <div class="guide-line">这里<b>不打分、不排名</b>。数字都由它替您算好，您只要照着做。</div>
        <div class="guide-line">中间<b>歇几天很正常</b>，回来做一个动作就又接上了。</div>
        <div class="guide-line">算数、说话、走路变难，都是<b>脑子在恢复中的常见情况</b>，不是您不行。认知练习里算不出来可以看提示、可以跳过、也可以换成不用算的。</div>
      </div>
      ${!review && IN_WECHAT ? `
      <div class="card">
        <div class="card-title">💬 在微信里打开的？</div>
        <div class="guide-line">在微信里用，记录会存在微信里：<b>清理微信缓存时可能被一起清掉</b>，也没法下载备份。</div>
        <div class="guide-line">${WECHAT_ADVICE}</div>
      </div>` : ''}
      ${!review && IS_IOS_HOME_ICON ? `
      <div class="card">
        <div class="card-title">📲 以前在浏览器里用过？</div>
        <div class="guide-line">苹果手机的桌面图标和 Safari 浏览器<b>各存各的记录</b>，以前的记录不会自动过来。</div>
        <div class="guide-line">请先在 Safari 里打开本应用，点「设置 → 备份全部数据」；再回到这个图标，点「设置 → 从备份恢复」。</div>
      </div>` : ''}
      <div class="disclaimer">本应用是家庭康复辅助工具，不能替代医生的诊断和治疗。<br>训练前请经康复医生评估，身体不适立即停止并就医。</div>
      <button class="btn green block huge" id="guide-done" style="margin-top:0.7rem">${review ? '我知道了' : '我知道了，开始使用'}</button>
    </div>`);
  const close = openModal(review ? '使用指引' : '首次使用指引', node, { center: true });
  node.querySelector('#guide-done').onclick = () => {
    if (!review && !stored(Store.markGuideSeen())) return;
    close();
    if (!review) toast('可以开始了，按页面上的提示慢慢来');
  };
}
