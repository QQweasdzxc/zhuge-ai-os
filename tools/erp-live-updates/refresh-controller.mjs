// Transport-neutral preparation. No timers, subscriptions or production effects.
export function refreshController({isVisible,isSafe,identity,refreshAssets,refreshObservations,onApplied,onError}){
 let busy=false,version=0,applied=0,stopped=false;
 async function flush(){
  if(stopped||busy||!isVisible()||!isSafe()||version===applied)return {status:'deferred'};
  const readVersion=version,who=identity();if(!who)return {status:'signed-out'};
  const canApply=()=>!stopped&&who===identity()&&isSafe();busy=true;
  try{
   // Implementations must stage rather than mutate before canApply is checked.
   const [assets,observations]=await Promise.all([refreshAssets(),refreshObservations()]);
   if(!canApply())return {status:'preserved'};
   await onApplied({assets,observations,identity:who});applied=readVersion;
   return {status:'applied',newerPending:version!==applied};
  }catch(error){onError?.(error);return {status:'failed'}}finally{busy=false}
 }
 return{invalidate(){version++;return flush()},flush,stop(){stopped=true},state(){return {busy,pending:version!==applied,stopped}}};
}
