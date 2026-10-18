(function(){'use strict';
var here=new URL(location.href);var params=here.searchParams;var base=new URL('.',here.href);
var inDocs=/\/docs\//.test(here.pathname);var productRoot=inDocs?new URL('..',base):base;
if(params.has('code')||params.has('error')||/(?:^|[&#])access_token=/.test(here.hash)){
 var classic=new URL('status-classic.html',base);
 classic.search=here.search;classic.hash=here.hash;location.replace(classic.href);return;
}
var valid=new Set(['dashboard','worklog','library','sync','management','settings']);
var ws=params.get('workspace');var view=params.get('templateView');
if(params.get('app')==='1'||valid.has(ws)||['navigation','workspace'].includes(view)){
 var dest=new URL('modules/worklog/',productRoot);dest.searchParams.set('app','1');
 if(valid.has(ws))dest.searchParams.set('workspace',ws);
 if(['navigation','workspace'].includes(view))dest.searchParams.set('templateView',view);
 location.replace(dest.href);
}
})();