const test=require('node:test'),assert=require('node:assert/strict');const C=require('../ZG-ERP/erp-seat-core.js');
const row=(id,k,v,s,c,d)=>[id,k,v,'S','Z',s,c,JSON.stringify(d),'2026-11-04','fixture'];
function base(){const m={schema:1,width:100,height:100,cells:[],seats:[{number:1},{number:2}]};return [row('p','part','v','','',{text:JSON.stringify(m)}),row('m','map','v','','',{parts:['p']})]}
test('canonical first binding wins, repeat same seat is valid, conflicting later seat ignored',()=>{const r=base();r.push(row('a','binding','v',1,'QR',{sessionId:'s'}),row('b','binding','v',2,'QR',{sessionId:'s'}));assert.equal(C.reduce(r).bindings.QR.seat,1);r.push(row('c','binding','v',1,'QR',{sessionId:'s2'}));assert.equal(C.reduce(r).bindings.QR.id,'c')});
test('occupants require expected previous event, not stale last writer',()=>{const r=base();r.push(row('a','occupant','v',1,'',{name:'A',previous:''}),row('b','occupant','v',1,'',{name:'B',previous:''}));assert.equal(C.reduce(r).occupants['v:1'].data.name,'A');r.push(row('c','occupant','v',1,'',{name:'C',previous:'a'}));assert.equal(C.reduce(r).occupants['v:1'].data.name,'C')});
test('same-area concurrent replacement map cannot hide bindings; rejected version edits ignored',()=>{const r=base(),m={schema:1,width:100,height:100,cells:[],seats:[{number:1}]};r.push(row('p2','part','v2','','',{text:JSON.stringify(m)}),row('m2','map','v2','','',{parts:['p2']}),row('x','binding','v2',1,'QR',{sessionId:'s'}));const md=C.reduce(r);assert.equal(md.maps.length,1);assert.equal(md.maps[0].id,'v');assert.equal(md.bindings.QR,undefined)});
test('duplicate event ids retain first payload, checks independent of device count',()=>{const r=base();r.push(row('c','check','v',1,'',{sessionId:'s',confirmed:true}),row('c','check','v',2,'',{sessionId:'s',confirmed:true}));const md=C.reduce(r);assert.deepEqual(C.progress(md,md.maps[0],'s',[]),{total:2,checked:1,remaining:1,scanned:0})});
test('same-version map event replaces geometry in place; bindings and occupants kept',()=>{const r=base();const m2={schema:1,width:100,height:100,cells:[],seats:[{number:1},{number:2},{number:3}]};r.push(row('p2','part','v','','',{text:JSON.stringify(m2)}),row('m2','map','v','','',{parts:['p2']}),row('o1','occupant','v',1,'',{name:'A',previous:''}),row('b1','binding','v',1,'QR',{sessionId:'s'}));const md=C.reduce(r);assert.equal(md.maps.length,1);assert.equal(md.maps[0].seats.length,3);assert.equal(md.bindings.QR.seat,1);assert.equal(md.occupants['v:1'].data.name,'A')});
test('same-version replacement needs fresh event ids: reused id is deduped',()=>{const r=base();const m2={schema:1,width:100,height:100,cells:[],seats:[{number:9}]};r.push(row('p','part','v','','',{text:JSON.stringify(m2)}));const md=C.reduce(r);assert.equal(md.maps[0].seats.length,2)});
test('seat label matcher: single-line digit-free prefix, trailing 1-3 digits',()=>{
 assert.equal(C.matchSeatLabel('管理部1')[2],'1');assert.equal(C.matchSeatLabel('手語80')[2],'80');assert.equal(C.matchSeatLabel('5')[2],'5');
 assert.equal(C.matchSeatLabel('門口'),null);assert.equal(C.matchSeatLabel('置物區'),null);assert.equal(C.matchSeatLabel('10F座位圖'),null);});
test('seat label matcher: multi-line labels match even with digits in the prefix',()=>{
 assert.equal(C.matchSeatLabel('手語\n70')[2],'70');assert.equal(C.matchSeatLabel('手語/管理部\n71')[2],'71');
 assert.equal(C.matchSeatLabel('10F茶水區\n81')[2],'81');assert.equal(C.matchSeatLabel('10F大會議室\n82')[2],'82');
 assert.equal(C.matchSeatLabel('10F茶水區\n81')[1],'10F茶水區');});
test('seat label matcher: asset codes and serial-like text never match',()=>{
 assert.equal(C.matchSeatLabel('R005458'),null);assert.equal(C.matchSeatLabel('CKMN111040133'),null);
 assert.equal(C.matchSeatLabel('VS2209'),null);assert.equal(C.matchSeatLabel('Acer 227Q'),null);
 assert.equal(C.matchSeatLabel('批次\nR005458'),null);assert.equal(C.matchSeatLabel(''),null);});
