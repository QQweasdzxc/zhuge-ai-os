(() => {
  'use strict';
  // P3 sandbox ONLY. Currency is fictional, local to this browser, never production-authoritative.
  const KEY = 'zhuge:p3:preview:v1';
  const EVENT = 'github:QQweasdzxc/zhuge-ai-os:pull:63:pages:39137616982';
  const DOC = document;
  const $ = id => DOC.getElementById(id);
  const items = [
    {id:'plant',icon:'🪴',name:'像素植栽',cost:120,desc:'在辦公室收藏一盆綠意'},
    {id:'sofa',icon:'🛋️',name:'軟綿綿沙發',cost:260,desc:'休息區裝飾收藏'},
    {id:'lamp',icon:'💡',name:'復古桌燈',cost:100,desc:'小夜燈造型收藏'},
    {id:'poster',icon:'🖼️',name:'成就掛畫',cost:180,desc:'牆上紀念收藏'},
    {id:'coffee',icon:'☕',name:'咖啡機',cost:220,desc:'辦公室生活小物'},
    {id:'plant2',icon:'🌵',name:'仙人掌',cost:90,desc:'不怕忘記澆水'}
  ];
  const animals = [
    {id:'orangecat',icon:'🐈',name:'橘貓'}, {id:'dog',icon:'🐕',name:'小柴犬'},
    {id:'bird',icon:'🐦',name:'小藍鳥'}, {id:'hamster',icon:'🐹',name:'小倉鼠'}
  ];
  const initial = () => ({coins:0,claims:[],items:[],pets:['blackcat']});
  function getState() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!s || !Number.isSafeInteger(s.coins) || s.coins < 0 ||
        !Array.isArray(s.claims) || !Array.isArray(s.items) || !Array.isArray(s.pets)) return initial();
      return {coins:Math.min(s.coins,1000000),claims:s.claims.filter(x=>typeof x==='string').slice(0,100),
        items:s.items.filter(x=>typeof x==='string').slice(0,50),
        pets:s.pets.filter(x=>typeof x==='string').slice(0,20)};
    } catch { return initial(); }
  }
  let state = getState();
  function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch{showToast('儲存失敗：此瀏覽器可能停用了本機儲存。');}}
  function paint(){ $('balance').textContent = new Intl.NumberFormat('zh-TW').format(state.coins); paintCollection(); }
  let timeoutId;
  function showToast(t){ const toast=$('toast');toast.textContent=t;toast.hidden=false;clearTimeout(timeoutId);timeoutId=setTimeout(()=>{toast.hidden=true;},3000);}
  function todayTaipei(){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const d={};for(const p of parts) d[p.type]=p.value;return d.year+'-'+d.month+'-'+d.day;
  }
  function dailyOffer() {
    const day=todayTaipei();
    let n=0;for(const c of day)n=((n*31+c.charCodeAt(0))>>>0);
    const pool=items.slice();
    for(let i=pool.length-1;i>0;i--){ const j=n%(i+1);[pool[i],pool[j]]=[pool[j],pool[i]];n=(n*1664525+1013904223)>>>0; }
    return pool.slice(0,3);
  }
  function buy(item){
    if(state.items.includes(item.id)) return showToast('已收藏這件物品');
    if(state.coins<item.cost) return showToast('金幣不足，完成已驗證里程碑後再來！');
    state.coins-=item.cost;state.items.push(item.id);save();paint();showToast('購買成功：'+item.name);openDaily();
  }
  function paintCollection(){
    let box=$('collection');
    if(!box){box=DOC.createElement('div');box.id='collection';box.style.cssText='position:absolute;left:9px;bottom:32px;z-index:4;display:flex;gap:3px;max-width:65%;flex-wrap:wrap';$('scene').append(box);}
    box.replaceChildren();
    for(const id of state.items){const itm=items.find(x=>x.id===id);if(!itm)continue;const span=DOC.createElement('span');span.textContent=itm.icon;span.title='已收藏：'+itm.name;span.style.cssText='display:inline-grid;place-items:center;width:28px;height:28px;background:#182944e0;border:1px solid #788b9a;border-radius:6px';box.append(span);}
    for(const id of state.pets.filter(p=>p!=='blackcat')){const p=animals.find(x=>x.id===id);if(!p)continue;const span=DOC.createElement('span');span.textContent=p.icon;span.title='寵物：'+p.name;span.style.cssText='display:inline-grid;place-items:center;width:28px;height:28px;background:#182944e0;border:1px solid #5abb9f;border-radius:6px';box.append(span);}
  }
  function row(icon,name,desc,label,disabled,click){
    const e=DOC.createElement('div');e.className='item';
    const im=DOC.createElement('span');im.textContent=icon;
    const body=DOC.createElement('div');body.className='details';
    const title=DOC.createElement('strong');title.textContent=name;
    const more=DOC.createElement('small');more.textContent=desc;
    body.append(title,more);
    const btn=DOC.createElement('button');btn.type='button';btn.textContent=label;btn.disabled=disabled;btn.addEventListener('click',click);
    e.append(im,body,btn);return e;
  }
  function openModal(title){$('dialog-title').textContent=title;$('dialog-content').replaceChildren();if(!$('dialog').open)$('dialog').showModal();}
  function info(t){const p=DOC.createElement('p');p.className='dialog-p';p.textContent=t;$('dialog-content').append(p);}
  function openDaily(){
    openModal('🏪 每日商店 · '+todayTaipei());
    info('依台北日期每天輪換三件。價格與金幣皆為 P3 測試值，收藏只保存在本裝置，不扣真錢。');
    for(const item of dailyOffer()){
      const owned=state.items.includes(item.id);
      $('dialog-content').append(row(item.icon,item.name,item.desc,owned?'已收藏':'🪙 '+item.cost,owned||state.coins<item.cost,()=>buy(item)));
    }
  }
  function openPets(){
    openModal('🐾 寵物商店');
    info('米粒黑貓是 P3 初始寵物，永久免費。神秘寵物以遊戲測試金幣兌換，不涉及機率付費或真實金錢。');
    $('dialog-content').append(row('🐈‍⬛','米粒・黑貓','已經在辦公室散步','已擁有',true,()=>{}));
    $('dialog-content').append(row('🎁','神秘寵物蛋','隨機獲得尚未收藏的可愛寵物','🪙 350',state.coins<350||animals.every(p=>state.pets.includes(p.id)),()=>{
      const remaining=animals.filter(p=>!state.pets.includes(p.id));
      if(!remaining.length)return showToast('全部寵物都收藏了！');
      if(state.coins<350)return showToast('金幣不足');
      const animal=remaining[Math.floor(Math.random()*remaining.length)];
      state.coins-=350;state.pets.push(animal.id);save();paint();showToast('你獲得了：'+animal.name+'！');openPets();
    }));
    for(const pet of animals.filter(p=>state.pets.includes(p.id))) $('dialog-content').append(row(pet.icon,pet.name,'我的寵物收藏','已收藏',true,()=>{}));
  }
  function openStaff(person){
    const people={
      co:['Co・首席工程師','生活動畫：走動與休息。真實工程進度需要經認證的任務事件，這個 P3 Preview 尚未接入 CLI 狀態，不表示 Co 正在開發。'],
      gem:['Gem・第二工程師','生活動畫：走動與休息。這個預覽沒有串接 Gemini 執行狀態，不表示 Gem 正在 Review。'],
      pm:['PM・指揮者','辦公室角色形象。真正決策和派工仍以 TaskFlow 核准流程為準。']
    };
    openModal(people[person][0]);info(people[person][1]);
  }
  async function verifyP2(){
    const claim=$('claim'),line=$('reward-status');
    const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),8000);
    try{
      const opt={cache:'no-store',signal:ctrl.signal,headers:{'Accept':'application/vnd.github+json'}};
      const [prRes,runRes]=await Promise.all([
        fetch('https://api.github.com/repos/QQweasdzxc/zhuge-ai-os/pulls/63',opt),
        fetch('https://api.github.com/repos/QQweasdzxc/zhuge-ai-os/actions/runs/39137616982',opt)
      ]);
      if(!prRes.ok||!runRes.ok)throw new Error('status unavailable');
      const [pr,run]=await Promise.all([prRes.json(),runRes.json()]);
      if(pr.merged!==true||run.conclusion!=='success'||run.head_sha!=='a9db9b2fe3051e22d59e52ad083c8d54d12dba62')throw new Error('release not verified');
      line.textContent='GitHub PR #63 + 正式 Pages CI 均已驗證：+500 🪙';
      const claimed=state.claims.includes(EVENT);claim.disabled=claimed;claim.textContent=claimed?'已領取':'領取 +500';
      if(!claimed)claim.onclick=()=>{
        if(state.claims.includes(EVENT))return;
        state.claims.push(EVENT);state.coins+=500;save();paint();claim.disabled=true;claim.textContent='已領取';showToast('🎉 P2 上線獎勵 +500 金幣！');
      };
    }catch{
      line.textContent='暫時無法核對 GitHub 事件，停發金幣以避免誤領';
      claim.disabled=true;claim.textContent='待查核';
    }finally{clearTimeout(t);}
  }
  const scene=$('scene'),cam=$('camera'),iframe=$('office-frame');
  let scale=window.matchMedia('(max-width:700px)').matches?1.22:1.02,offsetX=0,offsetY=0;
  const WIDTH=1150,HEIGHT=770;
  function clamp(n,a,b){return Math.max(a,Math.min(b,n));}
  function drawCamera(){
    const w=scene.clientWidth,h=scene.clientHeight;
    offsetX=clamp(offsetX,Math.min(0,w-WIDTH*scale),Math.max(0,w-WIDTH*scale));
    offsetY=clamp(offsetY,Math.min(0,h-HEIGHT*scale),Math.max(0,h-HEIGHT*scale));
    cam.style.transform='translate('+offsetX+'px,'+offsetY+'px) scale('+scale+')';
  }
  function centerCamera(){offsetX=(scene.clientWidth-WIDTH*scale)/2;offsetY=(scene.clientHeight-HEIGHT*scale)/2;drawCamera();}
  function zoom(factor){const old=scale;scale=clamp(scale*factor,0.75,2.25);const cx=scene.clientWidth/2,cy=scene.clientHeight/2;offsetX=cx-(cx-offsetX)*(scale/old);offsetY=cy-(cy-offsetY)*(scale/old);drawCamera();}
  let dragging=null;
  scene.addEventListener('pointerdown',e=>{
    if(e.target.closest('button'))return;dragging={id:e.pointerId,x:e.clientX,y:e.clientY};scene.setPointerCapture(e.pointerId);scene.classList.add('dragging');
  });
  scene.addEventListener('pointermove',e=>{if(!dragging||e.pointerId!==dragging.id)return;offsetX+=e.clientX-dragging.x;offsetY+=e.clientY-dragging.y;dragging.x=e.clientX;dragging.y=e.clientY;drawCamera();});
  for(const n of ['pointerup','pointercancel','lostpointercapture'])scene.addEventListener(n,()=>{dragging=null;scene.classList.remove('dragging');});
  $('zoom-in').onclick=()=>zoom(1.18);$('zoom-out').onclick=()=>zoom(1/1.18);$('recenter').onclick=centerCamera;
  window.addEventListener('resize',drawCamera);centerCamera();
  // Ambient movement is intentionally cosmetic: NEVER mapped to a claim that an AI agent is actively working.
  const cast=Array.from(DOC.querySelectorAll('.actor'));
  function roam(){if(DOC.visibilityState!=='visible'||window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
    cast.forEach((el,i)=>{el.style.left=(18+Math.random()*62)+'%';el.style.top=(26+Math.random()*54)+'%';});
    $('cat').style.left=(15+Math.random()*65)+'%';$('cat').style.top=(22+Math.random()*55)+'%';
  }
  let ambientTimer=setInterval(roam,7500);
  DOC.addEventListener('visibilitychange',()=>{if(DOC.visibilityState==='visible')roam();});
  cast.forEach(el=>el.addEventListener('click',()=>openStaff(el.dataset.person)));
  $('cat').addEventListener('click',()=>showToast('🐈‍⬛ 米粒：喵～！今天也辛苦了 ♡'));
  $('daily-shop-button').addEventListener('click',openDaily);
  $('pet-shop-button').addEventListener('click',openPets);
  $('shop-tab').addEventListener('click',openDaily);
  $('staff-tab').addEventListener('click',()=>openStaff('co'));
  $('close-dialog').addEventListener('click',()=>$('dialog').close());
  $('dialog').addEventListener('click',e=>{if(e.target===$('dialog'))$('dialog').close();});
  $('daily-teaser').textContent='今日精選：'+dailyOffer().map(x=>x.icon).join(' ');
  paint();void verifyP2();
})();