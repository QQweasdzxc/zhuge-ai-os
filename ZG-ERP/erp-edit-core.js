(function(root){'use strict';
function rebase(base,draft,fresh){const conflicts=[],values={};for(const k of Object.keys(draft)){const old=String(base[k]??''),typed=String(draft[k]??''),live=String(fresh[k]??'');if(typed!==old&&live!==old&&live!==typed)conflicts.push(k);values[k]=typed!==old?typed:live;}return{conflicts,values,base:Object.fromEntries(Object.keys(base).map(k=>[k,String(fresh[k]??'')]))};}
const api=Object.freeze({rebase});root.ErpEditCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
