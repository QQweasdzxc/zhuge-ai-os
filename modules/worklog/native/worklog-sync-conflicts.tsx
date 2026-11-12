"use client";
// Independent conflict-review subcomponent for the TQ6 WorkLog calendar sync.
// Contract with the host page (see taskflow-worklog-page.tsx):
//   request(action, body?) posts to the owner-only worklog-google-sync endpoint
//   and MUST rethrow endpoint errors with their bounded `code` preserved.
//   Actions used: 'conflicts' -> {conflicts: WorklogSyncConflict[]};
//   'resolve-conflict' {operationId,choice,eventEtag,entryUpdatedAt} -> {status:'resolved'}.
// The component renders nothing while no conflict is pending, so normal
// ordered updates never interrupt. Styles are inline on purpose: the shared
// worklog.css is owned by the integrator and stays untouched here.
import React,{useCallback,useEffect,useState} from 'react';

export type ConflictSide={title:string;date:string;at:string;hours:number;dateOnly?:boolean};
export type WorklogSyncConflict={operationId:string;eventId:string;entryId:string;eventEtag:string;entryUpdatedAt:string|null;eventUpdated:string|null;local:ConflictSide;remote:ConflictSide;updatedAt:string};
type ConflictRequest=(action:string,body?:Record<string,unknown>)=>Promise<any>;

const FIELDS:[keyof ConflictSide,string][]=[['title','標題'],['date','日期'],['at','開始時間'],['hours','時數']];
const fmt=(side:ConflictSide,key:keyof ConflictSide)=>key==='hours'?`${side.hours} 小時`:key==='at'?(side.dateOnly?'未指定時刻':String(side.at||'').replace('T',' ')):String(side[key]??'');
const when=(value:string|null)=>{if(!value)return '未知';const time=new Date(value);return Number.isFinite(time.getTime())?time.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'未知';};

const styles:Record<string,React.CSSProperties>={
 box:{flex:'none',maxHeight:'55dvh',overflow:'auto',margin:0,padding:'10px 14px',background:'#2c1f10',borderBottom:'1px solid #6b5426',color:'#f3e4c4',font:"400 13px/1.5 Arial,'Noto Sans TC',sans-serif"},
 title:{fontSize:15,margin:'0 0 4px',color:'#f7e9cd'},
 text:{margin:'4px 0 8px'},
 item:{border:'1px solid #6b5426',borderRadius:6,padding:8,margin:'8px 0',background:'#231a0d'},
 table:{width:'100%',tableLayout:'fixed',borderCollapse:'collapse',fontSize:12},
 cell:{textAlign:'left',padding:'3px 6px',verticalAlign:'top',overflowWrap:'anywhere'},
 differ:{color:'#ffd98a',fontWeight:600},
 actions:{display:'flex',flexWrap:'wrap',gap:8,marginTop:6},
 button:{border:'1px solid #8a6d33',background:'#3a2c12',color:'#ffe9bd',borderRadius:5,minHeight:44,padding:'6px 12px',font:'inherit',cursor:'pointer'},
};

export function WorklogSyncConflicts({request,refreshSignal=0,onResolved}:{request:ConflictRequest;refreshSignal?:number;onResolved?:()=>void}){
 const [conflicts,setConflicts]=useState<WorklogSyncConflict[]|null>(null);
 const [busy,setBusy]=useState('');
 const [message,setMessage]=useState('');
 const [loadError,setLoadError]=useState(false);
 const load=useCallback(async()=>{try{const result=await request('conflicts');if(!Array.isArray(result?.conflicts))throw new Error('Invalid conflict response');setConflicts(result.conflicts);setLoadError(false);}catch{setLoadError(true);}},[request]);
 useEffect(()=>{void load();},[load,refreshSignal]);
 if(loadError)return <section style={styles.box} role="alert"><p>工時差異清單讀取失敗，尚無法確認是否有待處理衝突。既有資料沒有更改。</p><button style={styles.button} onClick={()=>void load()}>重新讀取差異</button></section>;
 if(!conflicts||conflicts.length===0)return message?<p style={styles.box} role="status">{message}</p>:null;
 const choose=async(conflict:WorklogSyncConflict,choice:'keep-local'|'keep-remote')=>{
  if(busy)return;setBusy(conflict.operationId);setMessage('');
  try{
   await request('resolve-conflict',{operationId:conflict.operationId,choice,eventEtag:conflict.eventEtag,entryUpdatedAt:conflict.entryUpdatedAt});
   setConflicts(list=>(list||[]).filter(item=>item.operationId!==conflict.operationId));
   setMessage(choice==='keep-local'?'已保留 TF 版本，並同步到日曆。':'已保留日曆版本，並更新這筆工時。');
   onResolved?.();
  }catch(error){
   setMessage((error as {code?:string})?.code==='CONFLICT_CHANGED'?'這筆內容剛剛又有變動，已重新載入差異，請再確認一次。':'這次確認未完成；兩邊原資料都保留，請稍後再試。');
   if((error as {code?:string})?.code==='CONFLICT_CHANGED'){try{await request('run');}catch{}}
   await load();
  }finally{setBusy('');}
 };
 return <section style={styles.box} role="alertdialog" aria-label="工時日曆衝突確認">
  <h2 style={styles.title}>有 {conflicts.length} 筆工時在 TF 與 Google 日曆兩邊都修改過</h2>
  <p style={styles.text}>無法判定哪一邊較新，沒有自動覆寫。請逐筆選擇要保留的版本；平常的先後修改仍會自動同步，不會每次都問。</p>
  {message&&<p style={styles.text} role="status">{message}</p>}
  {conflicts.map(conflict=><article key={conflict.operationId} style={styles.item}>
   <table style={styles.table}>
    <thead><tr><th style={styles.cell}></th><th style={styles.cell}>TF 工時</th><th style={styles.cell}>Google 日曆</th></tr></thead>
    <tbody>
     {FIELDS.map(([key,label])=>{const differ=String(conflict.local[key]??'')!==String(conflict.remote[key]??'');const style=differ?{...styles.cell,...styles.differ}:styles.cell;return <tr key={key}><th style={style}>{label}</th><td style={style}>{fmt(conflict.local,key)}</td><td style={style}>{fmt(conflict.remote,key)}</td></tr>;})}
     <tr><th style={styles.cell}>修改時間</th><td style={styles.cell}>{when(conflict.entryUpdatedAt)}</td><td style={styles.cell}>{when(conflict.eventUpdated)}</td></tr>
    </tbody>
   </table>
   <div style={styles.actions}>
    <button style={styles.button} disabled={!!busy} onClick={()=>void choose(conflict,'keep-local')}>保留 TF 這版</button>
    <button style={styles.button} disabled={!!busy} onClick={()=>void choose(conflict,'keep-remote')}>保留日曆這版</button>
   </div>
  </article>)}
 </section>;
}
