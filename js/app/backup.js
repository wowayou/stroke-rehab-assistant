/* ============================================================
   备份与恢复：从备份恢复（选文件/粘贴 → 解密 → 预览 → 确认）+ 下载/复制/加密备份
   流程标准见 docs/DESIGN-SYSTEM.md §5；数据校验与恢复点在 storage.js。
   微信里不能下载文件 → 复制备份内容（IN_WECHAT，见 DEVELOPMENT §6 兼容性）。
   ============================================================ */

/* ============================================================
   【区】从备份恢复（选文件/粘贴 → 解密 → 预览 → 确认，见 DESIGN-SYSTEM §5）
   ============================================================ */
function openRestorePreview(parsed, fileName) {
  const s = Store.backupSummary(parsed.data);
  const confirmNode = nodeFromHTML(`
    <p class="muted" style="margin-bottom:0.5rem">备份文件：<b>${esc(fileName)}</b>${parsed.exportedAt ? '<br>导出时间：' + esc(parsed.exportedAt) : ''}</p>
    <div class="card" style="margin-bottom:0.7rem">
      <div class="card-title">恢复后将包含</div>
      <div class="guide-line">💊 药物 ${s.meds} 种　·　🩺 血压 ${s.bp} 条</div>
      <div class="guide-line">🩸 血糖 ${s.glucose} 条　·　⚖️ 体重 ${s.weight} 条</div>
      <div class="guide-line">💪 训练打卡 ${s.checkinDays} 天</div>
    </div>
    <div class="disclaimer" style="padding:0.2rem 0 0.6rem">恢复会用备份<b>覆盖本机现有全部数据</b>。应用会自动保留恢复前的数据，可在设置中撤销一次。</div>
    <button class="btn block" id="restore-confirm">确认恢复</button>`);
  const closeConfirm = openModal('从备份恢复', confirmNode, { center: true });
  confirmNode.querySelector('#restore-confirm').onclick = () => {
    if (!Store.applyBackup(parsed.data)) {
      showError(confirmNode, Store.backupError() || '恢复失败，原有数据未改变');
      renderStorageNotice();
      return;
    }
    applyFont(Store.data.profile.font);
    applyVoice(Store.data.profile.speechVoice);
    settingsRevision++;
    clearRecordSession();
    closeConfirm();
    render(currentView, { keepScroll: true });
    toast('已从备份恢复，可在设置中撤销一次');
  };
}

function openEncryptedRestore(jsonText, fileName) {
  const node = nodeFromHTML(`
    <div class="vital-form">
      <div class="muted" style="margin-bottom:0.7rem">这是密码加密的备份。密码只在本机用于解密，不会保存或上传。</div>
      <div class="field">
        <label for="restore-password">备份密码</label>
        <input id="restore-password" type="password" maxlength="200" autocomplete="current-password">
      </div>
      <label style="display:flex;align-items:center;gap:0.6rem;min-height:48px;margin:0.35rem 0">
        <input id="restore-password-show" type="checkbox" style="width:24px;height:24px">显示密码
      </label>
      <div id="restore-password-error" role="alert" style="min-height:1.6em;color:var(--red);font-weight:600"></div>
      <button class="btn block" id="restore-decrypt">解密并查看内容</button>
    </div>`);
  const closePassword = openModal('打开加密备份', node, { center: true });
  const input = node.querySelector('#restore-password');
  const button = node.querySelector('#restore-decrypt');
  const error = node.querySelector('#restore-password-error');
  node.querySelector('#restore-password-show').onchange = e => { input.type = e.target.checked ? 'text' : 'password'; };
  let decrypting = false;
  const decrypt = async () => {
    if (decrypting || !closePassword.active()) return;
    if (!input.value) { error.textContent = '请输入备份密码'; input.focus(); return; }
    button.disabled = true;
    decrypting = true;
    button.textContent = '正在验证，请稍候…';
    error.textContent = '';
    try {
      const parsed = await Store.parseEncryptedBackup(jsonText, input.value);
      if (!closePassword.active()) return;
      input.value = '';
      closePassword.replace(() => openRestorePreview(parsed, fileName));
    } catch (e) {
      error.textContent = e.message || '没有解密成功';
      input.focus();
      input.select();
    } finally {
      decrypting = false;
      if (!dismissPending) button.disabled = false;
      button.textContent = '解密并查看内容';
    }
  };
  button.onclick = decrypt;
  input.onkeydown = e => { if (e.key === 'Enter') decrypt(); };
  setTimeout(() => { if (closePassword.active()) input.focus(); }, 80);
}

/* ============================================================
   【区】备份下载（隐私提醒 → 明文备份 / 密码加密备份）
   ============================================================ */
function openBackupWarning() {
  const node = nodeFromHTML(`
    <div class="card">
      <div class="card-title">🔒 备份里有健康隐私</div>
      <div class="guide-line">备份文件包含称呼、用药、血压、血糖、体重和训练记录，内容是可以直接阅读的。</div>
      <div class="guide-line">请保存在自己的设备或可信位置，不要发到群聊，也不要交给无关人员。</div>
    </div>
    ${IN_WECHAT ? '' : `<div class="notice">
      <b>换手机或换网址时</b><br>先在这里下载备份并确认文件已保存，再到新网址的「设置 → 从备份恢复」选择这份文件。核对记录齐全后再使用新网址；旧网址的数据不会自动搬过去。
    </div>`}
    ${IN_WECHAT ? `
    <div class="notice danger"><b>微信里不能下载文件</b><br>可以把备份内容复制下来，粘贴到手机自带的「备忘录」（内容多时比发微信更稳妥）或微信「文件传输助手」保存。以后在任何浏览器里点「设置 → 粘贴备份内容恢复」就能恢复。</div>
    <button class="btn block" id="backup-copy">📋 复制备份内容</button>
    <div class="muted" style="margin-top:0.4rem">${WECHAT_ADVICE}搬过去之前，先用这份备份把记录恢复到浏览器里。</div>` : `
    <button class="btn block" id="backup-plain">下载普通备份</button>`}
    ${!IN_WECHAT && Store.encryptionSupported() ? `
      <button class="btn outline block" id="backup-encrypted" style="margin-top:0.6rem">🔐 设置密码并加密</button>
      <div class="muted" style="margin-top:0.4rem">备份要放网盘或共享电脑时可选。应用不会保存密码，忘记后无法替您找回。</div>` : ''}`);
  const close = openModal(IN_WECHAT ? '备份数据' : '下载备份', node, { center: true });
  const plain = node.querySelector('#backup-plain');
  if (plain) plain.onclick = () => {
    try { downloadBackup(); close(); }
    catch (e) { showError(node, e.message || '没有生成备份，请重试'); }
  };
  const copy = node.querySelector('#backup-copy');
  if (copy) copy.onclick = () => {
    let text;
    try { text = Store.exportBackup(); }
    catch (e) { showError(node, e.message || '没有生成备份，请重试'); return; }
    copyBackupText(node, text);
  };
  const encrypted = node.querySelector('#backup-encrypted');
  if (encrypted) encrypted.onclick = () => close.replace(openEncryptedBackup);
}

/* 复制备份内容（下载不了文件的环境用）。临时 textarea 必须放在弹窗里面：
   放到 body 上会被焦点陷阱拉回弹窗标题，选区丢了，execCommand 什么也复制不到。
   两种复制都失败时把内容摆出来让人长按复制，不能让人以为已经复制好了。 */
function copyBackupText(node, text) {
  const done = () => toast('已复制备份内容，请粘贴到「备忘录」或「文件传输助手」保存');
  const manual = () => {
    let box = node.querySelector('#backup-text');
    if (!box) {
      box = document.createElement('textarea');
      box.id = 'backup-text';
      box.readOnly = true;
      box.setAttribute('aria-label', '备份内容');
      box.style.cssText = 'width:100%;height:30vh;margin-top:0.7rem;border:1.5px solid var(--border);border-radius:12px;padding:0.6rem;font-size:0.9rem';
      node.appendChild(box);
    }
    box.value = text;
    box.focus();
    box.select();
    showError(node, '没能自动复制。请长按下面的内容，选「全选」再「复制」。');
  };
  /* 先同步 execCommand（Safari 只认点按同一调用栈里的复制，老浏览器也只有它），
     不成再试异步的 Clipboard API，都不成就摆出来让人手动复制 */
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.readOnly = true;
  ta.style.cssText = 'position:absolute;left:-9999px;top:0;opacity:0';
  node.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
  ta.remove();
  if (ok) { done(); return; }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, manual);
  else manual();
}

/* 粘贴备份内容恢复：和选文件恢复走同一条校验与预览（同一任务，用 close.replace 换成预览） */
function openPasteRestore() {
  const node = nodeFromHTML(`
    <div class="vital-form">
      <div class="muted" style="margin-bottom:0.6rem">把之前复制下来的备份内容<b>整段</b>粘贴到下面。</div>
      <div class="field">
        <label for="paste-backup">备份内容</label>
        <textarea id="paste-backup" spellcheck="false" autocomplete="off" style="width:100%;min-height:9rem;border:1.5px solid var(--control-border);border-radius:12px;padding:0.6rem;font-size:1rem"></textarea>
      </div>
      <div id="paste-error" role="alert" style="min-height:1.6em;color:var(--red);font-weight:600"></div>
      <button class="btn block" id="paste-check">查看备份内容</button>
    </div>`);
  const close = openModal('粘贴备份内容恢复', node, { center: true });
  const input = node.querySelector('#paste-backup');
  const error = node.querySelector('#paste-error');
  node.querySelector('#paste-check').onclick = () => {
    const text = input.value.trim();
    if (!text) { error.textContent = '请先粘贴备份内容'; input.focus(); return; }
    try {
      if (Store.isEncryptedBackup(text)) {
        if (!Store.encryptionSupported()) { error.textContent = '这个浏览器不能打开加密备份，请换用最新版手机浏览器'; return; }
        close.replace(() => openEncryptedRestore(text, '粘贴的内容'));
      } else {
        const parsed = Store.parseBackup(text);
        close.replace(() => openRestorePreview(parsed, '粘贴的内容'));
      }
    } catch (e) {
      error.textContent = /不是有效的 JSON/.test(e.message || '')
        ? '粘贴的内容不完整，或不是本应用的备份。复制时要整段复制，一个字都不能少。'
        : '没能识别：' + (e.message || '请检查粘贴的内容');
    }
  };
  setTimeout(() => { if (close.active()) input.focus(); }, 80);
}

function saveBackupFile(text, encrypted = false, label = '') {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `脑梗康复助手-${label || (encrypted ? '加密备份' : '备份')}-${Store.today()}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}

function downloadBackup() {
  saveBackupFile(Store.exportBackup());
  noteBackupDownloaded();
  toast('已发起备份下载，请到下载列表或「文件」中确认已保存');
}
/* 记下日期，只换掉设置页里那一行——不重建设置弹窗，免得冲掉还没保存的称呼等输入 */
function noteBackupDownloaded() {
  Store.markBackupDownloaded();
  const slot = document.getElementById('backup-age');
  if (slot) slot.innerHTML = backupAgeHTML();
}

function openEncryptedBackup() {
  const node = nodeFromHTML(`
    <div class="vital-form">
      <div class="muted" style="margin-bottom:0.7rem">密码只用于这份备份，不会保存或上传。以后恢复时必须输入完全相同的密码。</div>
      <div class="field" style="margin-bottom:0.7rem">
        <label for="backup-password">设置备份密码（至少 8 个字符）</label>
        <input id="backup-password" type="password" maxlength="200" autocomplete="new-password" placeholder="数字、字母或汉字都可以">
      </div>
      <div class="field">
        <label for="backup-password-again">再输入一次</label>
        <input id="backup-password-again" type="password" maxlength="200" autocomplete="new-password">
      </div>
      <label style="display:flex;align-items:center;gap:0.6rem;min-height:48px;margin:0.35rem 0">
        <input id="backup-password-show" type="checkbox" style="width:24px;height:24px">显示密码
      </label>
      <div id="backup-password-error" role="alert" style="min-height:1.6em;color:var(--red);font-weight:600"></div>
      <button class="btn block" id="backup-encrypt-confirm">加密并下载</button>
      <div class="disclaimer" style="margin-top:0.7rem">请使用只有本人或可信家人知道、但记得住的密码，并记在可信位置。忘记密码后本应用无法恢复；过于简单的密码仍可能被猜中。</div>
    </div>`);
  const close = openModal('密码加密备份', node, { center: true });
  const password = node.querySelector('#backup-password');
  const again = node.querySelector('#backup-password-again');
  const button = node.querySelector('#backup-encrypt-confirm');
  const error = node.querySelector('#backup-password-error');
  node.querySelector('#backup-password-show').onchange = e => {
    password.type = again.type = e.target.checked ? 'text' : 'password';
  };
  let encrypting = false;
  button.onclick = async () => {
    if (encrypting || !close.active()) return;
    if (password.value.length < 8) { error.textContent = '密码至少需要 8 个字符'; password.focus(); return; }
    if (password.value !== again.value) { error.textContent = '两次输入的密码不一样'; again.focus(); return; }
    button.disabled = true;
    encrypting = true;
    button.textContent = '正在加密，请稍候…';
    error.textContent = '';
    try {
      const text = await Store.exportEncryptedBackup(password.value);
      if (!close.active()) return;
      password.value = again.value = '';
      saveBackupFile(text, true);
      noteBackupDownloaded();
      close();
      toast('已发起加密备份下载，请确认文件已保存，并保管好密码');
    } catch (e) {
      error.textContent = e.message || '没有生成加密备份';
    } finally {
      encrypting = false;
      if (!dismissPending) {
        button.disabled = false;
        button.textContent = '加密并下载';
      }
    }
  };
  setTimeout(() => { if (close.active()) password.focus(); }, 80);
}
