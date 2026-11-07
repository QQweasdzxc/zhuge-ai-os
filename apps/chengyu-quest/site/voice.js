/* Chengyu Quest V1.2 — more conversational device speech, no external TTS billing. */
(function(){
'use strict';
const synth=window.speechSynthesis;
if(!synth||!('SpeechSynthesisUtterance' in window))return;
let style='teacher',selectedVoice='auto',generation=0,delayHandle=null;
const $=id=>document.getElementById(id);
const setup=document.querySelector('.setup-grid');
if(!setup)return;
const css=document.createElement('style');
css.textContent='.voice-settings{grid-column:1/-1;padding:17px 19px;margin-top:4px;border-radius:16px;background:#fff9ee;border:1px solid #f1e1c4}.voice-settings .field-label{margin-bottom:9px}.voice-settings .voice-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px}.voice-settings select{min-width:170px;max-width:100%;flex:1 1 190px;background:white;border:1.5px solid #d4cde1;color:#2b3551;border-radius:12px;padding:11px;font:inherit}.voice-settings .voice-note{font-size:12px;line-height:1.7;color:#6d6577;margin:8px 0 0}.voice-settings .voice-status{font-size:13px;margin-top:9px;color:#6b567c}.voice-settings button:focus-visible,.voice-settings select:focus-visible{outline:3px solid #f4b85e;outline-offset:2px}@media(max-width:500px){.voice-settings{padding:13px}.voice-settings select{width:100%}}';
document.head.append(css);
const section=document.createElement('div');
section.className='voice-settings';
section.innerHTML='<div class="field-label">④ 語音風格（試聽後選自己喜歡的聲音）</div>'+
'<div class="option-grid" id="voiceStyles">'+
'<button type="button" class="pill selected" data-voice-style="teacher">👩‍🏫 親切老師</button>'+
'<button type="button" class="pill" data-voice-style="slow">🐢 慢速講解</button>'+
'<button type="button" class="pill" data-voice-style="standard">🎙️ 原始朗讀</button></div>'+
'<div class="voice-row"><label for="voiceSelect">國語聲音</label><select id="voiceSelect" aria-label="選擇國語語音"><option value="auto">自動選擇台灣國語</option></select><button type="button" class="speak-btn" id="tryVoice">🔊 試聽老師講解</button></div>'+
'<div class="voice-status" id="voiceStatus" role="status"></div>'+
'<p class="voice-note">優先使用裝置可提供的台灣國語聲音。不同手機／瀏覽器提供的音色不同；這是加強語氣節奏，尚非雲端真人感 AI 配音。</p>';
setup.append(section);
function voiceOptions(){
 let list=synth.getVoices().filter(v=>/^zh[-_]/i.test(v.lang));
 return list.sort((a,b)=>scoreVoice(b)-scoreVoice(a));
}
function scoreVoice(v){
 let score=0;
 if(/^zh[-_]TW$/i.test(v.lang))score+=100;
 else if(/^zh[-_]HK$/i.test(v.lang))score+=50;
 else score+=15;
 if(/premium|enhanced|neural|natural|高品質|優質|增強|siri/i.test(v.name))score+=35;
 if(/mei[- ]?jia|美佳|yating|ya[- ]?ting|雅婷/i.test(v.name))score+=12;
 if(v.localService)score+=2;
 return score;
}
function chosenVoice(){
 const list=voiceOptions();
 if(selectedVoice==='auto')return list[0]||null;
 return list.find(v=>v.voiceURI===selectedVoice)||list[0]||null;
}
function fillVoices(){
 const list=voiceOptions(),select=$('voiceSelect');
 select.innerHTML='<option value="auto">✨ 自動選擇台灣國語</option>';
 list.forEach(v=>{
  const opt=document.createElement('option');
  opt.value=v.voiceURI;
  opt.textContent=v.name+'（'+v.lang.replace('_','-')+'）';
  select.appendChild(opt);
 });
 if(selectedVoice!=='auto'&&!list.some(v=>v.voiceURI===selectedVoice))selectedVoice='auto';
 select.value=selectedVoice;
 const v=chosenVoice();
 $('voiceStatus').textContent=v
 ?'目前使用：'+v.name+'（'+v.lang+'）｜可試聽其他聲音'
 :'目前找不到中文語音清單，將嘗試瀏覽器預設中文聲音。';
}
fillVoices();
if(typeof synth.addEventListener==='function')synth.addEventListener('voiceschanged',fillVoices);
function stopSpeech(){
 generation++;
 if(delayHandle!==null){clearTimeout(delayHandle);delayHandle=null}
 try{synth.cancel()}catch(e){}
}
window.chengyuStopSpeaking=stopSpeech;
function natural(text){
 const t=String(text||'').trim();
 if(style!=='teacher')return t;
 const explain=t.match(/^成語：(.+?)。意思：(.+?)。例句：(.+?)。記憶提示：(.+?)。?$/s);
 if(explain)return '今天我們來認識「'+explain[1]+'」。'+explain[1]+'。它的意思是，'+explain[2]+'。比如說，'+explain[3]+'。記憶小提醒：'+explain[4]+'。';
 const meaning=t.match(/^請選出「(.+?)」的正確意思。$/);
 if(meaning)return '這題來想想看，「'+meaning[1]+'」，是什麼意思呢？';
 const reverse=t.match(/^請依照下面的意思選出成語。(.+)$/s);
 if(reverse)return '來聽聽這段意思，猜猜是哪個成語。'+reverse[1];
 const context=t.match(/^請選出最適合填入句子的成語。(.+)$/s);
 if(context)return '請仔細聽這個句子，想想空格應該填入哪個成語。'+context[1];
 return t;
}
function chunks(text){
 if(style==='standard')return [text];
 const pieces=(text.match(/[^。！？!?；;]+[。！？!?；;]?/g)||[text]).map(p=>p.trim()).filter(Boolean);
 if(pieces.length<=1)return [text];
 return pieces.slice(0,20);
}
function speakHuman(text){
 if(!text)return;
 stopSpeech();
 const myGeneration=generation,voice=chosenVoice();
 const segments=chunks(natural(text));
 const base=(typeof config==='object'&&Number.isFinite(config.speed))?config.speed:0.9;
 let rate=style==='slow'?Math.min(base,0.82):style==='teacher'?Math.min(base+0.06,1.04):base;
 let pitch=style==='teacher'?1.05:style==='slow'?1.01:1.0;
 function emit(index){
  delayHandle=null;
  if(myGeneration!==generation||index>=segments.length)return;
  const u=new SpeechSynthesisUtterance(segments[index]);
  if(voice)u.voice=voice;
  u.lang=voice?voice.lang:'zh-TW';
  u.rate=rate;u.pitch=pitch;u.volume=1;
  u.onend=()=>{if(myGeneration!==generation||index>=segments.length-1)return;delayHandle=setTimeout(()=>emit(index+1),style==='slow'?240:130)};
  u.onerror=event=>{if(myGeneration!==generation)return;if(event.error!=='canceled'&&event.error!=='interrupted')$('voiceStatus').textContent='⚠️ 語音中斷，請切換另一個聲音後再試。'};
  synth.speak(u);
 }
 try{emit(0)}catch(error){$('voiceStatus').textContent='⚠️ 暫時無法朗讀，請先點「試聽」或換一個聲音。'}
}
speak=speakHuman;
$('voiceStyles').addEventListener('click',e=>{
 const b=e.target.closest('[data-voice-style]');if(!b)return;
 style=b.dataset.voiceStyle;
 $('voiceStyles').querySelectorAll('.pill').forEach(p=>p.classList.toggle('selected',p===b));
 speakHuman('我們一起來學習成語。舉一反三，就是從一個例子推想其他類似的情況。');
});
$('voiceSelect').addEventListener('change',e=>{selectedVoice=e.target.value;fillVoices();speakHuman('你好，今天我們來學習成語。')});
$('tryVoice').addEventListener('click',()=>speakHuman('今天我們來認識「舉一反三」。它的意思是，從一件事情舉出其他相似的例子。比如說，學會一題，就能想出更多解法。'));
})();
