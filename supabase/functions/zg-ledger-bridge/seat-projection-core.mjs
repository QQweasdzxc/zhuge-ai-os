// AA is a display projection only. Seat events remain the source of truth.
export function projectSeats(assetRows, seatRows, acceptedIds, maps) {
 const bindings=new Map(),seen=new Set(),counts=new Map();
 for(const r of seatRows){if(seen.has(r[0]))continue;seen.add(r[0]);if(!acceptedIds.has(String(r[0])))continue;if(['binding','placement'].includes(r[1]))bindings.set(String(r[6]),r);}
 for(const r of assetRows){const code=String(r[0]??'').trim();if(code)counts.set(code,(counts.get(code)||0)+1);}
 return assetRows.map((a,i)=>{const code=String(a[0]??'').trim(),b=bindings.get(code);let value='';
  if(code&&counts.get(code)!==1)value='待確認';
  else if(b){const map=maps.find(m=>m.id===b[2]&&m.site===b[3]&&m.zone===b[4]);value=map&&map.seats.some(s=>s.number===Number(b[5]))&&a[4]===b[3]&&a[5]===b[4]?Number(b[5]):'待確認';}
  return {row:i+2,code,value};
 });
}
