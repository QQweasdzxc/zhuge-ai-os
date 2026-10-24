const status = document.querySelector('#status');
const refresh = document.querySelector('#refresh');
const bytes = value => (Number(value) / 1e6).toLocaleString('zh-TW', { maximumFractionDigits: 2 }) + ' MB';
async function call(body) {
  let token = '';
  for (const key of ['zhuge_ai_os_google_auth_session_v1', 'zhuge_ai_os_session_v1']) {
    try { token ||= JSON.parse(localStorage.getItem(key) || 'null')?.access_token || ''; } catch {}
  }
  if (!token) throw new Error('請先登入 Zhuge AI OS；容量儀表板需要管理權限。');
  const response = await fetch(AUTH_CONFIG.supabaseUrl + '/functions/v1/attachment-lifecycle', { method: 'POST', headers: { apikey: AUTH_CONFIG.supabaseAnonKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('無法讀取或變更附件；請確認管理權限及登入狀態。');
  return response.json();
}
async function load() {
  refresh.disabled = true;
  status.textContent = '正在讀取容量…';
  try {
    const data = await call({ action: 'capacity' });
    const percent = data.used_bytes / data.capacity_bytes * 100;
    document.querySelector('#usage').value = Math.min(100, percent);
    document.querySelector('#summary').textContent = `${bytes(data.used_bytes)} / ${bytes(data.capacity_bytes)}（${percent.toFixed(1)}%） · ${Object.entries(data.breakdown || {}).map(([name,size]) => name + ' ' + bytes(size)).join(' / ')} · 預計釋放 ${bytes(data.scheduled_release_bytes || 0)} · 最近清理：${data.last_cleanup?.action || '尚無紀錄'}`;
    status.textContent = percent >= 100 ? '容量已滿，新上傳會被拒絕。' : data.warning ? `容量警示：已達 ${data.warning}% 門檻。請檢視大型附件。` : '容量正常。';
    const rows = data.items.map(item => {
      const row = document.createElement('tr');
      const text = [item.filename, `${item.module} · ${item.card_title || item.card_id || '未綁定卡片'}`, bytes(item.byte_size), item.state === 'deleting' ? '刪除處理中' : item.delete_due_at ? new Date(item.delete_due_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : item.state === 'uploading' ? '上傳尚未完成' : '未完成卡片，持續保存'];
      for (const value of text) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
      const cell = document.createElement('td');
      const button = document.createElement('button'); button.textContent = '永久刪除'; button.disabled = !['ready', 'deleting'].includes(item.state);
      button.onclick = async () => {
        if (!confirm(`永久刪除「${item.filename}」？檔案無法復原，必要紀錄仍會保留。`)) return;
        button.disabled = true;
        try { await call({ action: 'delete', module: item.module, id: item.attachment_id, confirm: true }); await load(); }
        catch (error) { status.textContent = error.message; button.disabled = false; }
      };
      cell.append(button); row.append(cell); return row;
    });
    document.querySelector('#items').replaceChildren(...rows);
  } catch (error) { document.querySelector('#items').replaceChildren(); status.textContent = error.message; }
  finally { refresh.disabled = false; }
}
refresh.onclick = load;
await load();
