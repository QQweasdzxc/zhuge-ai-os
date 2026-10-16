import test from "node:test";
import assert from "node:assert/strict";
import {canonicalTaskFlowHref,readPagesNativeRoute,
  validateTaskFlowNativePath,createPagesRouteController}
  from "../labs/taskflow/pages-client/taskflow-pages-navigation.mjs";

const HOME="https://qqweasdzxc.github.io/zhuge-ai-os/";

test("TF Dashboard is exactly user's original URL, never Render or a fragment",()=>{
 assert.equal(canonicalTaskFlowHref("/"),HOME);
 assert.deepEqual(readPagesNativeRoute(HOME),{state:"home",path:"/"});
 assert.deepEqual(readPagesNativeRoute(HOME+"?from=bookmark"),{state:"home",path:"/"});
});
test("genuine issue/project/settings navigation remains same-origin and reloadable",()=>{
 for(const native of ["/zhuge-lab/issues","/zhuge-lab/issues/ZG-6",
  "/zhuge-lab/projects/11111111-1111-4111-8111-111111111111",
  "/zhuge-lab/settings","/zhuge-lab/issues?q=live"]){
   const href=canonicalTaskFlowHref(native);
   assert.ok(href.startsWith(HOME+"#"+native));
   assert.equal(new URL(href).origin,new URL(HOME).origin);
   assert.equal(new URL(href).pathname,"/zhuge-ai-os/");
   assert.deepEqual(readPagesNativeRoute(href),{state:"route",path:native});
 }
});
test("TaskFlow may never create a redirect/link to untrusted host or parent directory",()=>{
 for(const hostile of ["//evil.example/","https://evil.example",
  "/../../secrets","/zhuge-lab/issues/%2fadmin",
  "/zhuge-lab/issues/%5cadmin","/zhuge-lab/issues/%00evil",
  "/zhuge-lab/issues/../../admin","/zhuge-lab/issues/\nadmin"]){
   assert.throws(()=>canonicalTaskFlowHref(hostile),/INVALID_NATIVE_PATH/,hostile);
 }
 assert.deepEqual(readPagesNativeRoute("https://evil.example/zhuge-ai-os/"),
   {state:"wrong-origin",path:null});
 assert.deepEqual(readPagesNativeRoute(HOME+"#/../../evil"),
   {state:"invalid-route",path:null});
});
test("browser navigation preserves canonical host and supports pop/reload",()=>{
 let current=HOME;
 const observers={hashchange:new Set(),popstate:new Set()};
 const writes=[];
 const win={
   location:{get href(){return current;}},
   history:{
     pushState(_s,_unused,url){writes.push({type:"push",url});current=url;},
     replaceState(_s,_unused,url){writes.push({type:"replace",url});current=url;},
     back(){current=HOME;for(const listener of observers.popstate)listener();}
   },
   addEventListener(n,fn){observers[n].add(fn);},
   removeEventListener(n,fn){observers[n].delete(fn);},
   open(href,target,features){writes.push({type:"newtab",url:href,target,features});}
 };
 const bridge=createPagesRouteController(win);
 const notifications=[];
 const unwatch=bridge.subscribe(v=>notifications.push(v));
 bridge.push("/zhuge-lab/issues/ZG-6");
 assert.deepEqual(bridge.snapshot(),{state:"route",path:"/zhuge-lab/issues/ZG-6"});
 assert.equal(writes[0].url,HOME+"#/zhuge-lab/issues/ZG-6");
 bridge.openInNewTab("/zhuge-lab/settings");
 assert.deepEqual(writes[1],{type:"newtab",url:HOME+"#/zhuge-lab/settings",
   target:"_blank",features:"noopener,noreferrer"});
 bridge.replace("/");
 assert.equal(current,HOME);
 assert.equal(new URL(current).pathname,"/zhuge-ai-os/");
 assert.equal(bridge.snapshot().path,"/");
 bridge.back();
 assert.ok(notifications.length>=3);
 unwatch();bridge.dispose();
 assert.equal(observers.hashchange.size,0);
 assert.equal(observers.popstate.size,0);
});
