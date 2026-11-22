// A staged inventory-only read. Asset master and other editors are not replaced.
const headers=['事件鍵','類型','圖版本','據點','區域','座位編號','資產編號','內容JSON','時間','經手人'];
export async function stageInventory(store,safe){
 if(typeof store.sharedSnapshotSafe!=='function'||!store.sharedSnapshotSafe(safe))throw Error('仍有本機操作，暫不核對現場清單');
 const generation=store._writeGeneration||0,result=await store._readFull('座位圖');
 if(!Array.isArray(result.header)||!headers.every((v,i)=>result.header[i]===v)||!Array.isArray(result.rows)||result.rows.length>=9999||result.rows.some(r=>!Array.isArray(r)||r.length!==10||!r[0])||new Set(result.rows.map(r=>r[0])).size!==result.rows.length)throw Error('現場位置資料不完整，保留原畫面');
 return{owner:store,generation,rows:result.rows.map(r=>r.slice())};
}
export function canCommitInventory(store,snapshot,safe){return snapshot?.owner===store&&snapshot.generation===(store._writeGeneration||0)&&store.sharedSnapshotSafe(safe)}
export function commitInventory(store,snapshot,safe){if(!canCommitInventory(store,snapshot,safe))throw Error('核對期間有本機操作，保留原畫面');store.seatRows=snapshot.rows;store.seatReady=true;store.seatError='';}
