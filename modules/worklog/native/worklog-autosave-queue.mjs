// Isolated autosave controller. No storage and no network of its own.
// A revision is saved serially. New edits during a save are queued, never overwritten.
export class WorklogAutosaveQueue {
 constructor({save,validate,onState=()=>{},delay=700}){this.save=save;this.validate=validate;this.onState=onState;this.delay=delay;this.revision=0;this.savedRevision=0;this.running=false;this.disposed=false;this.composing=false;this.value=null;this.timer=null;this.previousValueKey='';this.failedRevision=0;}
 emit(status,extra={}){if(!this.disposed)this.onState({status,revision:this.revision,savedRevision:this.savedRevision,...extra});}
 update(value){if(this.disposed)return;const key=JSON.stringify(value);if(key===this.previousValueKey)return;this.previousValueKey=key;this.value=structuredClone(value);this.revision++;this.failedRevision=0;clearTimeout(this.timer);const error=this.validate(this.value);this.emit(error?'invalid':this.running?'saving':'pending',{error});if(!error&&!this.composing)this.schedule();}
 setComposing(value){this.composing=value;clearTimeout(this.timer);if(!value&&this.value&&!this.validate(this.value)&&this.revision>this.savedRevision)this.schedule();}
 schedule(){clearTimeout(this.timer);this.timer=setTimeout(()=>void this.flush(),this.delay);}
 async flush(){clearTimeout(this.timer);if(this.disposed||this.running||this.composing||!this.value||this.revision===this.savedRevision)return;const error=this.validate(this.value);if(error){this.emit('invalid',{error});return}const revision=this.revision,value=structuredClone(this.value);this.running=true;this.emit('saving');try{await this.save(value,{revision});this.savedRevision=revision;this.failedRevision=0;if(!this.disposed){const latestError=this.validate(this.value);this.emit(this.revision===revision?'saved':latestError?'invalid':'pending',{error:latestError});}}catch(error){this.failedRevision=revision;if(!this.disposed)this.emit('failed',{error:error instanceof Error?error.message:String(error)});}finally{this.running=false;if(!this.disposed&&this.revision>revision&&!this.composing&&!this.validate(this.value))this.schedule();}}
 retry(){this.failedRevision=0;return this.flush();}
 // Parent retains the editor session when hidden; dispose only when owner ends it.
 dispose(){this.disposed=true;clearTimeout(this.timer);}
}
