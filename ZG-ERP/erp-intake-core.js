/* XLSX intake tables only. No seat layout, no inferred assets or custodians. */
(function(g){'use strict';
const FIELDS={serial:'設備序號（必選）',po:'PO 編號',vendor:'廠商',brand:'品牌',model:'型號',origin:'產地',type:'產品類型',mfgYear:'製造年份',note:'備註'};
const aliases={serial:['序號','設備序號','廠商序號','sn','serial','serialnumber'],po:['po','po編號','採購編號'],vendor:['廠商','供應商','vendor','supplier'],brand:['品牌','brand'],model:['型號','型號規格','model'],origin:['產地','製造產地','origin'],type:['類型','產品類型','type'],mfgYear:['製造年份','年份','mfgyear'],note:['備註','note']};
const norm=s=>String(s??'').trim().toLowerCase().replace(/[\s/_-]/g,'');
const str=n=>n?n.textContent:'';
const col=ref=>{let n=0;for(const c of ref.replace(/[0-9]/g,''))n=n*26+c.charCodeAt(0)-64;return n-1};
async function parseXlsx(buffer,filename){
 if(!/\.xlsx$/i.test(filename)||buffer.byteLength>5*1024*1024)throw Error('請選擇5MB以內的 XLSX 原檔');
 if(!g.fflate)throw Error('XLSX讀取元件未載入');
 let total=0,files;try{files=g.fflate.unzipSync(new Uint8Array(buffer),{filter:f=>{if(!/^xl\/(workbook\.xml|_rels\/workbook\.xml.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(f.name))return false;total+=f.originalSize;if(total>15*1024*1024||f.originalSize>8*1024*1024)throw Error('large');return true}})}catch{throw Error('XLSX無法讀取或展開後過大，原檔未修改')}
 const xml=n=>{if(!files[n])throw Error('XLSX缺少工作表內容');const d=new DOMParser().parseFromString(g.fflate.strFromU8(files[n]),'application/xml');if(d.getElementsByTagName('parsererror').length)throw Error('XLSX XML格式錯誤');return d};
 const shared=files['xl/sharedStrings.xml']?[...xml('xl/sharedStrings.xml').getElementsByTagName('si')].map(si=>[...si.getElementsByTagName('t')].map(str).join('')):[];
 const rels=[...xml('xl/_rels/workbook.xml.rels').getElementsByTagName('Relationship')];
 const sheets=[...xml('xl/workbook.xml').getElementsByTagName('sheet')].map(s=>{const rel=rels.find(r=>r.getAttribute('Id')===s.getAttribute('r:id'));let target=rel?.getAttribute('Target')||'';target=target.startsWith('/')?target.slice(1):'xl/'+target;if(!/^xl\/worksheets\/[^/]+\.xml$/.test(target))throw Error('工作表路徑不支援');const d=xml(target),rows=[];const cells=[...d.getElementsByTagName('c')];if(cells.length>30000)throw Error('工作表超過30000格');for(const c of cells){const ref=c.getAttribute('r')||'',ri=Number(ref.replace(/\D/g,''))-1,ci=col(ref);if(!Number.isInteger(ri)||ri<0||ri>2000||ci<0||ci>99)throw Error('最多讀取2001列、100欄，請另存本次入庫範圍');const t=c.getAttribute('t'),v=str(c.getElementsByTagName('v')[0]);let value=t==='s'?shared[Number(v)]:t==='inlineStr'?[...c.getElementsByTagName('t')].map(str).join(''):v;if(value===undefined)throw Error('共用文字索引錯誤');(rows[ri]||(rows[ri]=[]))[ci]={value:String(value).trim(),numeric:!t||t==='n',formula:c.getElementsByTagName('f').length>0,error:t==='e',ref};}return {name:s.getAttribute('name')||'',rows};});
 if(!sheets.length)throw Error('沒有工作表');return {filename,sheets};
}
function mapping(sheet,header){const row=sheet.rows[header]||[],out={};for(const k of Object.keys(FIELDS)){const hits=row.map((c,i)=>aliases[k].includes(norm(c?.value))?i:-1).filter(i=>i>=0);out[k]=hits.length===1?hits[0]:-1;}return out;}
function preview(sheet,header,map,assets,batches){
 const rows=[],errors=[],warnings=[];const used=Object.values(map).filter(i=>i>=0);if(map.serial<0)errors.push('請指定設備序號欄');if(new Set(used).size!==used.length)errors.push('同一來源欄不可對應多個欄位');
 const seen=new Set(),assetSerials=new Set((assets||[]).map(a=>String(a.serial||'').trim()).filter(Boolean)),openSerials=new Set((batches||[]).filter(b=>!b.closed).flatMap(b=>(b.items||[]).map(i=>String(i.serial||'').trim())).filter(Boolean));
 for(let i=header+1;i<sheet.rows.length;i++){const source=sheet.rows[i]||[];if(!source.some(c=>c&&c.value!==''))continue;const out={line:i+1},issues=[];for(const k of Object.keys(FIELDS)){const c=source[map[k]];out[k]=c?.value||'';if(c&&(c.formula||c.error))issues.push(FIELDS[k]+'含公式或錯誤，請改成已確認的文字值');if(out[k].length>2000)issues.push(FIELDS[k]+'超過2000字');}
  if(!out.serial)issues.push('缺少設備序號');else{const c=source[map.serial];if(c.numeric)issues.push('序號是數值儲存，前導零／長碼可能已遺失，請在原檔改成文字後重選');if(seen.has(out.serial))issues.push('本檔序號重複');seen.add(out.serial);if(assetSerials.has(out.serial))issues.push('序號已在設備清冊');if(openSerials.has(out.serial))issues.push('序號已在未結案批次');}
  if(out.mfgYear&&!/^\d{4}$/.test(out.mfgYear))issues.push('製造年份須為四位數，或留空');if(!out.model&&!out.brand)warnings.push('第'+out.line+'列未填品牌、型號，保留空白');out.issues=issues;rows.push(out);for(const m of issues)errors.push('第'+out.line+'列：'+m);
 }
 if(!rows.length)errors.push('標題列之後沒有資料');if(rows.length>500)errors.push('每次最多500筆，請分檔');return {rows,errors,warnings};
}
function groups(rows){const out=[],keys=new Map();for(const r of rows){const meta={};for(const k of Object.keys(FIELDS))if(k!=='serial')meta[k]=r[k]||'';if(!meta.origin)meta.origin='未確認';const key=JSON.stringify(meta);let b=keys.get(key);if(!b){b={...meta,serials:[]};keys.set(key,b);out.push(b)}b.serials.push(r.serial)}return out;}
g.ErpIntakeCore={FIELDS,parseXlsx,mapping,preview,groups};if(typeof module!=='undefined')module.exports=g.ErpIntakeCore;
})(typeof window!=='undefined'?window:globalThis);
