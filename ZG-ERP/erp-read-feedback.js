/* Decoded feedback only. Never signifies persisted inventory. */
window.ErpReadFeedback=(()=>{let ctx,ready=false;return{
 async unlock(){try{ctx=ctx||new(window.AudioContext||window.webkitAudioContext)();if(ctx.state==='suspended')await ctx.resume();ready=ctx.state==='running';return ready;}catch{return false;}},
 beep(){if(!ready||!ctx||ctx.state!=='running')return false;try{const o=ctx.createOscillator(),g=ctx.createGain(),t=ctx.currentTime;o.frequency.value=1600;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.12,t+.008);g.gain.exponentialRampToValueAtTime(.001,t+.11);o.connect(g);g.connect(ctx.destination);o.start(t);o.stop(t+.12);return true;}catch{return false;}}
};})();
