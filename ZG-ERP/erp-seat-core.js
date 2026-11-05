/* Seat maps: source layout is private ledger data, never bundled people data. */
(function(g){
'use strict';
const HEADER=['事件鍵','類型','圖版本','據點','區域','座位編號','資產編號','內容JSON','時間','經手人'];
const text=(el,tag)=>{const n=el&&el.getElementsByTagName(tag)[0];return n?n.textContent:''};
function reduce(rows){
 const out={maps:[],occupants:{},bindings:{},checks:{}}; const parts={},seen=new Set();
 for(const r of rows||[]){try{if(seen.has(r[0]))continue;seen.add(r[0]);
  const e={id:r[0],kind:r[1],version:r[2],site:r[3],zone:r[4],seat:Number(r[5]),code:r[6],data:JSON.parse(r[7]||'{}'),at:r[8],actor:r[9]};
  if(e.kind==='part')parts[e.id]=e.data.text;
  else if(e.kind==='map'){const data=e.data.parts?JSON.parse(e.data.parts.map(id=>parts[id]||'').join('')):e.data;validate(data);const mi=out.maps.findIndex(m=>m.site===e.site&&m.zone===e.zone);if(mi<0)out.maps.push(Object.assign({},data,{id:e.version,site:e.site,zone:e.zone}));else if(out.maps[mi].id===e.version)out.maps[mi]=Object.assign({},data,{id:e.version,site:e.site,zone:e.zone});}
  else if(['occupant','binding','placement','check'].includes(e.kind)&&!out.maps.some(m=>m.id===e.version&&m.site===e.site&&m.zone===e.zone))continue;
  else if(e.kind==='occupant'){const key=e.version+':'+e.seat,prior=out.occupants[key];if((e.data.previous||'')===(prior?.id||''))out.occupants[key]=e;}
  else if((e.kind==='binding'||e.kind==='placement')){const prior=out.bindings[e.code];if(!prior||(prior.version===e.version&&prior.seat===e.seat))out.bindings[e.code]=e;}
  else if(e.kind==='check')out.checks[e.version+':'+e.seat+':'+e.data.sessionId]=e;
 }catch{}}
 return out;
}
function ordered(seats){return [...seats].sort((a,b)=>a.number-b.number)}
function validate(m){
 if(!m||!Array.isArray(m.seats)||!m.seats.length||m.seats.length>500||!Array.isArray(m.cells)||m.cells.length>6000)throw Error('座位圖格式不符或過大');
 const nums=m.seats.map(x=>x.number);if(nums.some(n=>!Number.isInteger(n)||n<1)||new Set(nums).size!==nums.length)throw Error('座位編號重複或不合法，未匯入');
 if(!(m.width>0&&m.height>0&&m.width<10000&&m.height<10000))throw Error('圖面尺寸不合法');
 for(const c of m.cells)if(![c.x,c.y,c.w,c.h].every(Number.isFinite)||c.w<0||c.h<0)throw Error('圖面座標不合法');
 return m;
}
function progress(model,map,sessionId,records){
 const checks=ordered(map.seats).filter(s=>{const e=model.checks[map.id+':'+s.number+':'+sessionId];return e&&e.data.confirmed===true});
 const codes=new Set((records||[]).map(r=>r.code));
 return {total:map.seats.length,checked:checks.length,remaining:map.seats.length-checks.length,scanned:new Set(Object.values(model.bindings).filter(e=>e.version===map.id&&e.data.sessionId===sessionId&&codes.has(e.code)).map(e=>e.code)).size};
}
function colNum(ref){let n=0;for(const c of ref.replace(/[0-9]/g,''))n=n*26+c.charCodeAt(0)-64;return n}
function rgb(v,fallback){return /^([A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/.test(v||'')?'#'+v.slice(-6):fallback}
function color(el,theme,fallback){if(!el)return fallback;let c=rgb(el.getAttribute('rgb'),null);if(!c&&el.hasAttribute('theme'))c=theme[Number(el.getAttribute('theme'))];if(!c&&el.hasAttribute('indexed')){const i=Number(el.getAttribute('indexed'));c=i===64?'#000000':i===65?'#ffffff':null}if(!c)return fallback;const t=Number(el.getAttribute('tint')||0);if(t){c='#'+c.slice(1).match(/../g).map(h=>{let n=parseInt(h,16);n=Math.round(t<0?n*(1+t):n*(1-t)+255*t);return n.toString(16).padStart(2,'0')}).join('')}return c}
/* Seat label: trailing 1-3 digit number. Plain single-line labels allow a digit-free prefix; multi-line labels (department on its own line) allow digits in the prefix but require a real newline before the number, so asset codes like R005458 never match. */
function matchSeatLabel(t){const m=String(t||'').match(/^([^\d]*)(\d{1,3})$/)||String(t||'').match(/^([\s\S]*\S)[\r\n]+\s*(\d{1,3})$/);return m||null}
async function parseXlsx(buffer,filename){
 if(buffer.byteLength>5*1024*1024)throw Error('檔案超過5MB，請使用座位圖原檔');
 if(!g.fflate)throw Error('XLSX讀取元件未載入');
 let files;try{files=g.fflate.unzipSync(new Uint8Array(buffer),{filter:f=>f.originalSize<2000000&&/^(xl\/(worksheets\/sheet\d+\.xml|sharedStrings\.xml|styles\.xml|theme\/theme1\.xml|workbook\.xml|_rels\/workbook\.xml.rels))$/.test(f.name)})}catch{throw Error('無法讀取XLSX，原檔未修改')}
 const decode=n=>files[n]?g.fflate.strFromU8(files[n]):'';
 const xml=n=>{const d=new DOMParser().parseFromString(decode(n),'application/xml');if(d.getElementsByTagName('parsererror').length)throw Error('XLSX XML格式錯誤');return d};
 const wb=xml('xl/workbook.xml'), rels=xml('xl/_rels/workbook.xml.rels');const sheets=Array.from(wb.getElementsByTagName('sheet'));
 if(sheets.length!==1)throw Error('目前只接受單一工作表的座位圖，請保留原檔並另存要使用的單頁');
 const sheet=sheets[0],rid=sheet.getAttribute('r:id'),rel=Array.from(rels.getElementsByTagName('Relationship')).find(r=>r.getAttribute('Id')===rid);let target=rel&&rel.getAttribute('Target');if(!target)throw Error('找不到工作表');target=target.startsWith('/')?target.slice(1):'xl/'+target;
 const doc=xml(target),shared=files['xl/sharedStrings.xml']?Array.from(xml('xl/sharedStrings.xml').getElementsByTagName('si')).map(si=>Array.from(si.getElementsByTagName('t')).map(t=>t.textContent).join('')):[];
 const cells=Array.from(doc.getElementsByTagName('c'));if(cells.length>6000)throw Error('座位圖超過6000格');
 const raw=cells.map(c=>{const ref=c.getAttribute('r'),type=c.getAttribute('t');let v=type==='s'?shared[Number(text(c,'v'))]||'':type==='inlineStr'?Array.from(c.getElementsByTagName('t')).map(t=>t.textContent).join(''):text(c,'v');if(c.getElementsByTagName('f').length&&/\d/.test(v))throw Error('座位編號不可依賴公式，請先確認原始編號');return {ref,col:colNum(ref),row:Number(ref.replace(/\D/g,'')),style:Number(c.getAttribute('s')||0),text:String(v||'').trim()}});
 const maxCol=Math.max(...raw.map(c=>c.col)),maxRow=Math.max(...raw.map(c=>c.row));if(maxCol>50||maxRow>200)throw Error('版面過大，請使用座位圖範圍');
 const widths=Array(maxCol+1).fill(64),heights=Array(maxRow+1).fill(20);
 for(const c of doc.getElementsByTagName('col'))for(let i=Number(c.getAttribute('min'));i<=Number(c.getAttribute('max'))&&i<=maxCol;i++)widths[i]=c.getAttribute('hidden')==='1'?0:Number(c.getAttribute('width')||8.43)*7+5;
 for(const r of doc.getElementsByTagName('row')){const i=Number(r.getAttribute('r'));heights[i]=r.getAttribute('hidden')==='1'?0:Number(r.getAttribute('ht')||15)*4/3}
 const xs=[0],ys=[0];for(let i=1;i<=maxCol;i++)xs[i]=xs[i-1]+widths[i];for(let i=1;i<=maxRow;i++)ys[i]=ys[i-1]+heights[i];
 const mergeStarts={},covered=new Set();for(const m of doc.getElementsByTagName('mergeCell')){const [a,b]=m.getAttribute('ref').split(':'),ac=colNum(a),ar=Number(a.replace(/\D/g,'')),bc=colNum(b),br=Number(b.replace(/\D/g,''));mergeStarts[a]={bc,br};for(let r=ar;r<=br;r++)for(let c=ac;c<=bc;c++)if(r!==ar||c!==ac)covered.add(r+':'+c)}
 const theme=['#ffffff','#000000','#eeece1','#1f497d','#4f81bd','#c0504d','#9bbb59','#8064a2','#4bacc6','#f79646'];
 const style=xml('xl/styles.xml'),fills=Array.from(style.getElementsByTagName('fills')[0].children),fonts=Array.from(style.getElementsByTagName('fonts')[0].children),borders=Array.from(style.getElementsByTagName('borders')[0].children),xfs=Array.from(style.getElementsByTagName('cellXfs')[0].children);
 const out=[];for(const c of raw){if(covered.has(c.row+':'+c.col))continue;const xf=xfs[c.style]||xfs[0],font=fonts[Number(xf.getAttribute('fontId')||0)],fill=fills[Number(xf.getAttribute('fillId')||0)],border=borders[Number(xf.getAttribute('borderId')||0)],m=mergeStarts[c.ref];const b={};for(const side of ['left','right','top','bottom','diagonal']){const n=border.getElementsByTagName(side)[0];if(n&&n.getAttribute('style'))b[side]=n.getAttribute('style')};out.push({...c,x:xs[c.col-1],y:ys[c.row-1],w:xs[m?m.bc:c.col]-xs[c.col-1],h:ys[m?m.br:c.row]-ys[c.row-1],fill:color(fill.getElementsByTagName('fgColor')[0],theme,'#ffffff'),ink:color(font.getElementsByTagName('color')[0],theme,'#222222'),bold:font.getElementsByTagName('b').length>0,fontSize:Number(font.getElementsByTagName('sz')[0]?.getAttribute('val')||12),border:b})}
 const seats=[];for(const c of out){const m=matchSeatLabel(c.text);if(!m)continue;const n=Number(m[2]);if(n<1||n>500)continue;seats.push({number:n,rawLabel:c.text,ref:c.ref,x:c.x,y:c.y,w:c.w,h:c.h,sourceText:m[1]||'',sourceOccupant:'',occupantRef:''})}
 // White adjacent text is source reference only, never confirmed as a current person.
 const numberRefs=new Set(seats.map(s=>s.ref));for(const s of seats){const c=out.find(c=>c.ref===s.ref);const candidates=out.filter(x=>x.col===c.col&&Math.abs(x.row-c.row)===1&&x.text&&!numberRefs.has(x.ref)&&!/(門|區|部|手語|10F)/.test(x.text));s.nearbySource=candidates.map(x=>({ref:x.ref,text:x.text}));}
 const map={schema:1,sourceFilename:filename,sourceSheet:sheet.getAttribute('name'),width:xs[maxCol],height:ys[maxRow],cells:out,seats:ordered(seats)};validate(map);return map;
}
/* 姓名計畫（私下提供的 JSON：{seats:{座號:姓名}}）套用到「現有」座位圖：只選目前沒有使用人的座位，不重建圖、不動既有 ID。 */
function planNames(plan,map,occupants){const src=plan&&typeof plan==='object'&&plan.seats&&typeof plan.seats==='object'?plan.seats:null;if(!src)return {error:'檔案格式不對：需要 {"seats":{"座號":"姓名"}}。沒有任何資料被改。',todo:[],has:0,off:0,bad:0};const nums=new Set(map.seats.map(s=>s.number)),todo=[];let has=0,off=0,bad=0;for(const [k,v] of Object.entries(src)){const n=Number(k),name=typeof v==='string'?v.trim():'';if(!Number.isInteger(n)||!name||name.length>120){bad++;continue}if(!nums.has(n)){off++;continue}const cur=occupants[map.id+':'+n];if(cur&&cur.data&&(cur.data.name||cur.data.public)){has++;continue}todo.push({seat:n,name})}todo.sort((a,b)=>a.seat-b.seat);return {todo,has,off,bad}}
g.ErpSeatCore={planNames,HEADER,reduce,ordered,validate,progress,parseXlsx,matchSeatLabel};if(typeof module!=='undefined')module.exports=g.ErpSeatCore;
})(typeof window!=='undefined'?window:globalThis);
