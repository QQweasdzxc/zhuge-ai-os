export const VERIFIED_EVENT='observation-verified';
const keys=['id','sessionId','site','zone','map','seat','label','raw','serial','model','capturedAt','savedAt','epoch'];
const text=(v,n,required=false)=>typeof v==='string'&&v.length<=n&&(!required||v.trim().length>0);
export function isVerifiedObservation(p){
 if(!p||Object.getPrototypeOf(p)!==Object.prototype||Object.keys(p).length!==2||p.v!==2||!p.item||Object.getPrototypeOf(p.item)!==Object.prototype)return false;
 const i=p.item;if(Object.keys(i).length!==keys.length||keys.some(k=>!Object.hasOwn(i,k)))return false;
 return ['id','sessionId','site','zone','map'].every(k=>text(i[k],200,true))&&Number.isInteger(i.seat)&&i.seat>0&&i.seat<=10000&&['有QR','沒有QR'].includes(i.label)&&text(i.raw,4096)&&text(i.serial,200)&&text(i.model,200)&&text(i.epoch,200)&&text(i.capturedAt,40,true)&&text(i.savedAt,40,true)&&Number.isFinite(Date.parse(i.capturedAt))&&Number.isFinite(Date.parse(i.savedAt))&&(i.label==='有QR'?!!i.raw.trim():i.raw==='');
}
// Only canonical rows returned after exact durable readback may be passed here.
export function verifiedObservation(body){
 if(body?.ok!==true||body.historical===true||!Array.isArray(body.row)||![15,16].includes(body.row.length))return null;
 const r=body.row,p={v:2,item:{id:r[0],sessionId:r[1],site:r[2],zone:r[3],map:r[4],seat:Number(r[5]),label:r[6],raw:r[7],serial:r[8],model:r[9],capturedAt:r[11],savedAt:r[12],epoch:r[15]||''}};
 return isVerifiedObservation(p)?p:null;
}
