/* Pure ordered map reduction. Shared byte-for-byte with the bridge. */
(function(g){'use strict';
function backgroundValid(b){return b&&b.type==='image/jpeg'&&typeof b.data==='string'&&b.data.length<=620000&&/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(b.data);}
function validate(m){
 if(!m||!Array.isArray(m.seats)||(!m.seats.length&&!backgroundValid(m.background))||m.seats.length>500||!Array.isArray(m.cells)||m.cells.length>6000)throw Error('MAP_SHAPE');
 if(m.background&&!backgroundValid(m.background))throw Error('MAP_BACKGROUND');
 const n=m.seats.map(s=>s.number);if(n.some(x=>!Number.isInteger(x)||x<1||x>500)||new Set(n).size!==n.length)throw Error('MAP_SEATS');
 if(!(m.width>0&&m.height>0&&m.width<10000&&m.height<10000))throw Error('MAP_SIZE');
 for(const c of m.cells)if(![c.x,c.y,c.w,c.h].every(Number.isFinite)||c.w<0||c.h<0)throw Error('MAP_CELLS');
 return m;
}
function snapshot(rows){
 const seen=new Set(),parts=new Map(),maps=new Map(),accepted=new Set();
 for(const r of rows||[]){if(!Array.isArray(r)||!r[0]||seen.has(r[0]))continue;seen.add(r[0]);try{
  const [id,kind,version,site,zone]=r;if(!version||!site||!zone)continue;const place=JSON.stringify([site,zone]),data=JSON.parse(r[7]);
  if(kind==='part'){if(data&&typeof data.text==='string'&&data.text.length<=12000)parts.set(id,{version,site,zone,text:data.text});continue;}
  if(kind==='area'){
   const prior=maps.get(place),n=Number(r[5]);if(!prior||prior.id!==version||!Number.isInteger(n)||n<1||n>500||prior.seats.some(s=>s.number===n))continue;
   const {x,y,w,h}=data||{};if(![x,y,w,h].every(Number.isFinite)||x<0||y<0||w<16||h<16||x+w>prior.width||y+h>prior.height)continue;
   if(typeof data.label!=='string'||data.label.length>60||data.public!==true)continue;
   if(prior.seats.some(s=>Math.min(x+w,s.x+s.w)>Math.max(x,s.x)&&Math.min(y+h,s.y+s.h)>Math.max(y,s.y)))continue;
   const ref='area:'+id,label=data.label.trim()||'公共區域',seat={number:n,rawLabel:label+'\n'+n,sourceText:label,sourceOccupant:'',occupantRef:'',nearbySource:[],ref,x,y,w,h,custom:true};
   const cell={ref,x,y,w,h,text:seat.rawLabel,fill:'#fff2cc',ink:'#222222',fontSize:12,border:{left:'thin',right:'thin',top:'thin',bottom:'thin'}};
   maps.set(place,validate({...prior,cells:[...prior.cells,cell],seats:[...prior.seats,seat].sort((a,b)=>a.number-b.number)}));accepted.add(id);continue;
  }
  if(kind!=='map')continue;const prior=maps.get(place);if(prior&&prior.id!==version)continue;
  let map;if(Object.prototype.hasOwnProperty.call(data||{},'parts')){if(!Array.isArray(data.parts)||!data.parts.length||data.parts.length>60||new Set(data.parts).size!==data.parts.length)continue;const text=data.parts.map(id=>{const p=parts.get(id);if(!p||p.version!==version||p.site!==site||p.zone!==zone)throw Error('MAP_PART');return p.text}).join('');map=validate(JSON.parse(text));}else map=validate(data);
  if(prior&&prior.seats.filter(s=>s.custom).some(s=>!map.seats.some(t=>t.number===s.number&&t.custom&&t.ref===s.ref)))continue;
  maps.set(place,Object.assign({},map,{id:version,site,zone}));accepted.add(id);
 }catch{}}
 return {maps:[...maps.values()],accepted};
}
function reduce(rows){return snapshot(rows).maps;}
g.ErpSeatMapCore=Object.freeze({validate,reduce,snapshot,backgroundValid});if(typeof module!=='undefined')module.exports=g.ErpSeatMapCore;
})(globalThis);
