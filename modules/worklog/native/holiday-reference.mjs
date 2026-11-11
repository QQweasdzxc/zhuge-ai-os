// Official reference data only. Never infer personal attendance or create work entries.
export const suspensionSource='https://www.dgpa.gov.tw/typh/daily/nds.html';
const plain=value=>String(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/[ \t]+/g,' ').trim();
export function parseSuspensions(html,{now=Date.now()}={}){
 if(typeof html!=='string'||html.length>2000000)throw new Error('官方停班資料格式無法確認');
 const stamp=plain(html).match(/更新時間[：:]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})/);
 const table=html.match(/<table\b[^>]*id=["']?Table["']?[^>]*>([\s\S]*?)<\/table>/i);
 if(!stamp||!table)throw new Error('官方停班資料格式無法確認');
 const sourceUpdatedAt=`${stamp[1]}-${stamp[2].padStart(2,'0')}-${stamp[3].padStart(2,'0')}T${stamp[4].padStart(2,'0')}:${stamp[5]}:${stamp[6]}+08:00`;
 const sourceTime=Date.parse(sourceUpdatedAt);if(!Number.isFinite(sourceTime)||sourceTime>now+300000)throw new Error('官方停班資料時間無法確認');
 const rows=[];let noNotices=false;
 for(const row of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cells=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(x=>plain(x[1]));
  if(cells.length===1&&cells[0].includes('無停班停課訊息')){noNotices=true;continue}
  if(cells.length>=2&&cells[0]&&cells[1]&&cells[0]!=='縣市名稱')rows.push({area:cells[0],notice:cells.slice(1).join(' ')});
 }
 if(!rows.length&&!noNotices)throw new Error('官方停班資料尚未完整公布或格式變更');
 return {source:suspensionSource,sourceUpdatedAt,checkedAt:new Date(now).toISOString(),stale:now-sourceTime>7200000,noNotices,rows,scope:'各地方政府公布資訊；是否適用仍依你的機關、學校或雇主規定。'};
}
