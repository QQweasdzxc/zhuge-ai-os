/* Learning Archipelago - local day/night + weather atmosphere layer (v1).
   Follows the family's real location: sunrise/sunset tint (dawn/day/dusk/night)
   plus overcast, fog, rain and snow overlays on the existing world map art.
   Privacy: one-shot coarse geolocation -> Open-Meteo (no key, CC BY 4.0).
   Coordinates are never sent to the family backend or stored server-side;
   only a 45-minute localStorage cache on the device. Denial/failure falls
   back to a default city silently and never blocks or re-prompts play.
   Demo hook for testing: #wxdemo=<wmoCode>[,HH:MM] (e.g. #wxdemo=61,23:30). */
(function(){
'use strict';
var FALLBACK={lat:25.033,lon:121.565,label:'Taipei'};
var CACHE_KEY='la-wx-v1', GEO_KEY='la-wx-geo-v1';
var CACHE_TTL=45*60*1000, GEO_RETRY=24*60*60*1000;
var stage=null,shell=null;
var layers={};
var state={code:0,sunrise:null,sunset:null};
var demo=null;

var CSS=[
'.wx-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden}',
'.wx-tint{background:#0a1230;mix-blend-mode:multiply;opacity:0;transition:opacity 6s linear}',
'.wx-cloud{background:linear-gradient(180deg,#25313f 0%,#3b4a5c 34%,transparent 68%);mix-blend-mode:multiply;opacity:0;transition:opacity 6s linear}',
'.wx-warm{background:linear-gradient(180deg,rgba(255,122,47,0) 26%,rgba(255,122,47,.85) 72%,rgba(255,166,77,.95) 100%);mix-blend-mode:overlay;opacity:0;transition:opacity 6s linear}',
'.wx-fog{background:radial-gradient(ellipse 75% 42% at 22% 18%,rgba(226,236,244,.5),transparent 70%),radial-gradient(ellipse 85% 46% at 74% 30%,rgba(226,236,244,.42),transparent 70%),radial-gradient(ellipse 95% 40% at 45% 78%,rgba(226,236,244,.36),transparent 70%);mix-blend-mode:screen;opacity:0;transition:opacity 6s linear}',
'.wx-stars{background-repeat:repeat;mix-blend-mode:screen;opacity:0;transition:opacity 6s linear;animation:wxTwinkle 4.5s ease-in-out infinite alternate}',
'@keyframes wxTwinkle{from{filter:brightness(.75)}to{filter:brightness(1.2)}}',
'.voyage-shell.wx-noanim .wx-layer,.voyage-shell.wx-noanim .wx-precip{transition:none!important}',
'.wx-precip{display:none;opacity:0;transition:opacity 3s linear}',
'.wx-precip.on{display:block;opacity:1}',
'.wx-precip i{position:absolute;left:-6%;right:-6%;top:-180px;bottom:0;background-repeat:repeat;will-change:transform;animation:wxFall .82s linear infinite}',
'.wx-precip i+i{opacity:.55;animation-duration:1.25s}',
'.wx-precip.wx-light i{opacity:.45}',
'.wx-precip.wx-heavy i{animation-duration:.6s}.wx-precip.wx-heavy i+i{animation-duration:.9s;opacity:.7}',
'.wx-precip.wx-snow i{animation:wxSnow 5.5s linear infinite}',
'.wx-precip.wx-snow i+i{animation-duration:8s}',
'@keyframes wxFall{from{transform:translate3d(0,0,0)}to{transform:translate3d(0,180px,0)}}',
'@keyframes wxSnow{from{transform:translate3d(0,0,0)}to{transform:translate3d(-24px,180px,0)}}',
'.voyage-shell.wx-night .voyage-glow{filter:brightness(1.45) saturate(1.15)}',
'.voyage-shell.wx-night .voyage-sign{box-shadow:0 3px 0 #54371d,0 0 14px rgba(255,214,130,.55)}',
'@media(max-width:690px){.wx-fog{background:radial-gradient(ellipse 90% 34% at 30% 16%,rgba(226,236,244,.45),transparent 70%),radial-gradient(ellipse 100% 38% at 60% 72%,rgba(226,236,244,.38),transparent 70%)}}',
'@media(prefers-reduced-motion:reduce){.wx-precip i,.wx-stars{animation:none!important}.wx-tint,.wx-cloud,.wx-warm,.wx-fog,.wx-precip,.wx-stars{transition:none!important}}'
].join('\n');

/* Rain tile: 140x180 SVG, slanted streaks fully inside the tile (seamless loop). */
function rainTile(alpha){
 var lines=[[12,8],[52,28],[96,6],[130,44],[30,66],[74,88],[116,70],[10,116],[58,132],[102,112],[134,150],[36,160],[84,170],[124,96]];
 var s='<svg xmlns="http://www.w3.org/2000/svg" width="140" height="180">';
 for(var i=0;i<lines.length;i++){
  var x=lines[i][0],y=lines[i][1];
  s+='<line x1="'+x+'" y1="'+y+'" x2="'+(x+5)+'" y2="'+(y+22)+'" stroke="rgba(196,220,242,'+alpha+')" stroke-width="1.4" stroke-linecap="round"/>';
 }
 return 'url("data:image/svg+xml,'+encodeURIComponent(s+'</svg>')+'")';
}
function starsTile(){
 var dots=[[18,20,1.3],[66,10,.9],[110,26,1.1],[134,60,.8],[40,54,1],[88,72,.7],[122,96,1.2],[10,104,.9],[58,118,1],[100,132,.8],[30,148,1.2],[76,160,.7],[126,158,1],[52,92,.6],[16,68,.7]];
 var s='<svg xmlns="http://www.w3.org/2000/svg" width="150" height="180">';
 for(var i=0;i<dots.length;i++){
  s+='<circle cx="'+dots[i][0]+'" cy="'+dots[i][1]+'" r="'+dots[i][2]+'" fill="rgba(235,244,255,.9)"/>';
 }
 return 'url("data:image/svg+xml,'+encodeURIComponent(s+'</svg>')+'")';
}
function snowTile(alpha){
 var dots=[[16,14,2.4],[58,40,1.8],[104,10,2.8],[132,64,1.9],[34,86,2.2],[82,104,1.6],[120,92,2.5],[8,140,1.9],[64,156,2.6],[108,138,1.7],[44,128,1.5],[136,168,2.1]];
 var s='<svg xmlns="http://www.w3.org/2000/svg" width="140" height="180">';
 for(var i=0;i<dots.length;i++){
  s+='<circle cx="'+dots[i][0]+'" cy="'+dots[i][1]+'" r="'+dots[i][2]+'" fill="rgba(240,248,255,'+alpha+')"/>';
 }
 return 'url("data:image/svg+xml,'+encodeURIComponent(s+'</svg>')+'")';
}

function build(){
 if(build.done)return true;
 var st=document.createElement('style');
 st.id='wx-world-style';
 st.textContent=CSS;
 document.head.appendChild(st);
 var mk=function(cls){var d=document.createElement('div');d.className='wx-layer '+cls;d.setAttribute('aria-hidden','true');stage.appendChild(d);return d};
 layers.tint=mk('wx-tint');
 layers.cloud=mk('wx-cloud');
 layers.warm=mk('wx-warm');
 layers.fog=mk('wx-fog');
 layers.stars=mk('wx-stars');
 layers.stars.style.backgroundImage=starsTile();
 layers.precip=mk('wx-precip');
 layers.precip.appendChild(document.createElement('i'));
 layers.precip.appendChild(document.createElement('i'));
 build.done=true;
 return true;
}

/* --- time-of-day math ---------------------------------------------------- */
function parseLocal(iso){ // "2026-11-09T06:06" -> local Date (device tz == location tz)
 var d=new Date(iso);
 return isNaN(d)?null:d;
}
function minutes(a,b){return (a-b)/60000}
/* dayness 0..1 and warm 0..1 from now vs sunrise/sunset */
function sunFactors(now,sr,ss){
 if(!sr||!ss||ss<=sr){return {day:1,warm:0}}
 var day;
 if(now>=new Date(sr.getTime()-45*60000)&&now<=new Date(sr.getTime()+60*60000)){
  day=(minutes(now,sr)+45)/105;          // dawn ramp: night -> day
 }else if(now>new Date(sr.getTime()+60*60000)&&now<new Date(ss.getTime()-30*60000)){
  day=1;
 }else if(now>=new Date(ss.getTime()-30*60000)&&now<=new Date(ss.getTime()+60*60000)){
  day=1-(minutes(now,ss)+30)/90;         // dusk ramp: day -> night
 }else{
  day=0;
 }
 day=clamp01(day);
 var e1=Math.abs(minutes(now,sr)), e2=Math.abs(minutes(now,ss));
 var edge=Math.min(e1,e2);
 var warm=clamp01(1-edge/75)*clamp01(day*2.2)*clamp01((1-day)*2.2+0.25);
 return {day:day,warm:clamp01(warm)};
}
function clamp01(v){return v<0?0:v>1?1:v}

/* WMO weather_code -> overlay plan */
function weatherPlan(code){
 var p={dim:0,fog:0,precip:null};
 if(code===2){p.dim=.14}
 else if(code===3){p.dim=.42}
 else if(code===45||code===48){p.dim=.16;p.fog=.75}
 else if(code>=51&&code<=57){p.dim=.2;p.precip='light'}
 else if((code>=61&&code<=67)||(code>=80&&code<=82)){p.dim=.24;p.precip=(code===65||code===67||code===82)?'heavy':'rain'}
 else if((code>=71&&code<=77)||code===85||code===86){p.dim=.18;p.precip='snow'}
 else if(code>=95){p.dim=.38;p.precip='heavy'}
 return p;
}

function apply(){
 var now=demo&&demo.now?demo.now:new Date();
 var f=sunFactors(now,state.sunrise,state.sunset);
 var w=weatherPlan(state.code);
 var nightOp=(1-f.day)*.68;
 layers.tint.style.opacity=(nightOp+w.dim*(1-nightOp)*.5).toFixed(3);
 layers.cloud.style.opacity=(w.dim).toFixed(3);
 layers.warm.style.opacity=(f.warm*.6*(1-nightOp)).toFixed(3);
 layers.fog.style.opacity=(w.fog*(0.35+0.65*f.day)).toFixed(3);
 layers.stars.style.opacity=(nightOp>0.3?(nightOp*1.1):0).toFixed(3);
 var pr=layers.precip;
 pr.className='wx-layer wx-precip'+(w.precip?' on':'')+(w.precip?' wx-'+w.precip:'');
 if(w.precip){
  var kids=pr.children;
  var tile=w.precip==='snow'?snowTile(.85):rainTile(w.precip==='light'?.32:(w.precip==='heavy'?.5:.42));
  if(pr.dataset.tile!==tile){pr.dataset.tile=tile;kids[0].style.backgroundImage=tile;kids[1].style.backgroundImage=tile}
 }
 shell.classList.toggle('wx-night',f.day<.35);
}

/* --- data ---------------------------------------------------------------- */
function readCache(){
 try{
  var c=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');
  if(c&&c.ts&&Date.now()-c.ts<CACHE_TTL&&c.sunrise&&c.sunset)return c;
 }catch(e){}
 return null;
}
function writeCache(c){try{localStorage.setItem(CACHE_KEY,JSON.stringify(c))}catch(e){}}
function fetchWeather(lat,lon,cb){
 var url='https://api.open-meteo.com/v1/forecast?latitude='+lat.toFixed(3)+'&longitude='+lon.toFixed(3)+
  '&current=weather_code&daily=sunrise,sunset&timezone=auto&forecast_days=1';
 fetch(url).then(function(r){return r.json()}).then(function(j){
  if(!j||!j.daily||!j.daily.sunrise)throw 0;
  var c={lat:lat,lon:lon,ts:Date.now(),code:(j.current&&typeof j.current.weather_code==='number')?j.current.weather_code:0,
   sunrise:j.daily.sunrise[0],sunset:j.daily.sunset[0]};
  writeCache(c);cb(c);
 }).catch(function(){
  cb({lat:lat,lon:lon,ts:Date.now(),code:0,sunrise:null,sunset:null});
 });
}
function locate(cb){
 var last=0;
 try{last=parseInt(localStorage.getItem(GEO_KEY)||'0',10)||0}catch(e){}
 var fallback=function(){cb(FALLBACK.lat,FALLBACK.lon)};
 if(!navigator.geolocation){fallback();return}
 if(last&&Date.now()-last<GEO_RETRY){fallback();return} // denied/failed recently: never re-ask
 var mark=function(){try{localStorage.setItem(GEO_KEY,String(Date.now()))}catch(e){}};
 var done=false;
 var to=setTimeout(function(){if(!done){done=true;mark();fallback()}},9000);
 navigator.geolocation.getCurrentPosition(function(pos){
  if(done)return;done=true;clearTimeout(to);
  try{localStorage.removeItem(GEO_KEY)}catch(e){}
  cb(pos.coords.latitude,pos.coords.longitude);
 },function(){
  if(done)return;done=true;clearTimeout(to);mark();fallback();
 },{enableHighAccuracy:false,timeout:8000,maximumAge:30*60000});
}
function applyData(c){
 state.code=c.code||0;
 state.sunrise=c.sunrise?parseLocal(c.sunrise):null;
 state.sunset=c.sunset?parseLocal(c.sunset):null;
 if(!state.sunrise||!state.sunset){
  var t=new Date();
  state.sunrise=new Date(t.getFullYear(),t.getMonth(),t.getDate(),6,0);
  state.sunset=new Date(t.getFullYear(),t.getMonth(),t.getDate(),18,0);
 }
 apply();
}
function refresh(force){
 if(demo){applyData({code:demo.code,sunrise:demo.sr,sunset:demo.ss});return}
 var c=force?null:readCache();
 if(c){applyData(c);return}
 locate(function(lat,lon){fetchWeather(lat,lon,applyData)});
}

/* demo hook: #wxdemo=61,23:30 or #wxdemo=3 -> deterministic state, no geo/fetch */
function readDemo(){
 try{
  var h=new URLSearchParams(location.hash.slice(1));
  var v=h.get('wxdemo');
  if(v==null)return null;
  var parts=v.split(','),code=parseInt(parts[0],10);
  if(isNaN(code))code=0;
  var t=new Date();
  var sr=new Date(t.getFullYear(),t.getMonth(),t.getDate(),6,5);
  var ss=new Date(t.getFullYear(),t.getMonth(),t.getDate(),17,10);
  var now=new Date();
  if(parts[1]&&/^\d{1,2}:\d{2}$/.test(parts[1])){
   var hm=parts[1].split(':');
   now=new Date(t.getFullYear(),t.getMonth(),t.getDate(),+hm[0],+hm[1]);
  }
  return {code:code,sr:sr,ss:ss,now:now};
 }catch(e){return null}
}

function attribution(){
 var f=document.querySelector('.footer');
 if(f&&!f.dataset.wxAttr){
  f.dataset.wxAttr='1';
  var s=document.createElement('span');
  s.textContent=' · 天氣與日出日落資料 © Open-Meteo.com（CC BY 4.0）';
  f.appendChild(s);
 }
}

var tries=0;
function boot(){
 stage=document.querySelector('.voyage-stage');
 shell=document.querySelector('.voyage-shell');
 if(!stage||!shell){
  if(++tries<25)setTimeout(boot,300);
  return;
 }
 build();
 attribution();
 demo=readDemo();
 if(demo)shell.classList.add('wx-noanim');
 refresh(false);
 setInterval(function(){
  if(demo){demo.now=new Date(demo.now.getTime()+60000)}
  refresh(false);
 },60000);
 document.addEventListener('visibilitychange',function(){if(!document.hidden)refresh(false)});
 window.addEventListener('hashchange',function(){demo=readDemo();refresh(true)});
 window.LAWeather={refresh:function(){refresh(true)},state:function(){return state}};
}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',boot)}else{boot()}
})();
