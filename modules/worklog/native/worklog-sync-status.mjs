// Display-only sync messages. Never starts a sync or changes persistence rules.
export function syncFailureLabel(error){
 const value=String(error?.code||'');
 const code=/^[A-Z0-9_-]{1,80}$/.test(value)?value:'UNKNOWN';
 return `Google 同步未完成（${code}）。TF 已儲存的工時不受影響；日曆事件可能尚未更新，請勿重複新增工時。`;
}
export function syncConnectionLabel(calendar,{syncing=false,lastAttempt=''}={}){
 if(syncing)return 'Google 同步中，TF 儲存狀態另行顯示';
 if(lastAttempt)return lastAttempt;
 if(calendar?.error)return 'Google 同步尚有未完成項目，請確認日曆結果；TF 已儲存的工時保留。';
 return '已連接 Google；未重新驗證本次同步結果';
}
