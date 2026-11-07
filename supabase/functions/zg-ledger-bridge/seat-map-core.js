/* Pure ordered map reduction. Shared byte-for-byte with the bridge. */
(function(g){'use strict';
function validate(m){
 if(!m||!Array.isArray(m.seats)||!m.seats.length||m.seats.length>500||!Array.isArray(m.cells)||m.cells.length>6000)throw Error('MAP_SHAPE');
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
  if(kind!=='map')continue;const prior=maps.get(place);if(prior&&prior.id!==version)continue;
  let map;if(Object.prototype.hasOwnProperty.call(data||{},'parts')){if(!Array.isArray(data.parts)||!data.parts.length||data.parts.length>60||new Set(data.parts).size!==data.parts.length)continue;const text=data.parts.map(id=>{const p=parts.get(id);if(!p||p.version!==version||p.site!==site||p.zone!==zone)throw Error('MAP_PART');return p.text}).join('');map=validate(JSON.parse(text));}else map=validate(data);
  maps.set(place,Object.assign({},map,{id:version,site,zone}));accepted.add(id);
 }catch{}}
 return {maps:[...maps.values()],accepted};
}
function reduce(rows){return snapshot(rows).maps;}
g.ErpSeatMapCore=Object.freeze({validate,reduce,snapshot});if(typeof module!=='undefined')module.exports=g.ErpSeatMapCore;
})(globalThis);
