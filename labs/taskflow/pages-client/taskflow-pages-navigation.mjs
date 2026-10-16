/**
 * Github Pages-compatible native TF route bridge.
 *
 * Root Dashboard is literally https://qqweasdzxc.github.io/zhuge-ai-os/
 * Deep links use hash routes on the SAME origin; no Next server rewrites,
 * Render frontend redirects, arbitrary external URLs, or iframe wrappers.
 * Future React shell passes its current snapshot to the native
 * @multica/views/navigation NavigationProvider adapter.
 */
import {PAGES_CANONICAL} from "./taskflow-pages-api.mjs";

const BASE = new URL(PAGES_CANONICAL);
const ROOT = BASE.pathname;
const BAD = /[\\\x00-\x1f\x7f]|%2f|%5c|%00|%0a|%0d/i;
const SAFE_NATIVE = /^\/(?:[a-z0-9-]+(?:\/(?:issues|projects|inbox|my-issues|settings|agents|runtimes|skills|automations|usage|chat)(?:\/[a-z0-9._~-]+)*)?)?$/i;

export function validateTaskFlowNativePath(value){
  if(typeof value!=="string" || value.length>2048 || !value.startsWith("/") ||
    value.startsWith("//")||BAD.test(value))throw Error("INVALID_NATIVE_PATH");
  const [beforeAnchor]=value.split("#",1);
  // WHATWG URL normalizes /../ and /%2e%2e/ *before* pathname inspection.
  // Validate raw segments first, including encoded dot-only segments.
  const rawPath=beforeAnchor.split("?",1)[0];
  try {
    if(rawPath.split("/").some(segment=>{
      const decoded=decodeURIComponent(segment);
      return decoded==="."||decoded==="..";
    }))throw Error("INVALID_NATIVE_PATH");
  }catch{throw Error("INVALID_NATIVE_PATH");}
  const url=new URL(beforeAnchor,BASE);
  if(url.origin!==BASE.origin || !SAFE_NATIVE.test(url.pathname) ||
      url.pathname.includes(".."))
    throw Error("INVALID_NATIVE_PATH");
  if(url.search.length>1024)throw Error("INVALID_NATIVE_PATH");
  return value;
}

export function canonicalTaskFlowHref(nativePath="/"){
  validateTaskFlowNativePath(nativePath);
  if(nativePath==="/")return PAGES_CANONICAL;
  const url=new URL(PAGES_CANONICAL);
  // Route lives entirely in the fragment, so GitHub Pages still serves the
  // same root HTML on refresh. Within a route, the native anchor comes last.
  url.hash=nativePath;
  return url.href;
}

export function readPagesNativeRoute(urlInput){
  let url;
  try{url=new URL(urlInput)}catch{return {state:"wrong-origin",path:null};}
  if(url.origin!==BASE.origin || ![ROOT,ROOT+"index.html"].includes(url.pathname))
    return {state:"wrong-origin",path:null};
  if(!url.hash || !url.hash.startsWith("#/"))return {state:"home",path:"/"};
  const candidate=url.hash.slice(1);
  try{return {state:"route",path:validateTaskFlowNativePath(candidate)};}
  catch{return {state:"invalid-route",path:null};}
}

/** Browser implementation of Multica's NavigationAdapter contract.
 * A shell may subscribe to both hashchange and popstate; this controller
 * never manipulates a new origin or uses window.location.replace().
 */
export function createPagesRouteController(win){
  if(!win?.location || !win.history || typeof win.addEventListener!=="function")
    throw Error("BROWSER_REQUIRED");
  const listeners=new Set();
  const notify=()=>{for(const cb of listeners)cb(readPagesNativeRoute(win.location.href));};
  const eventHandler=()=>notify();
  win.addEventListener("hashchange",eventHandler);
  win.addEventListener("popstate",eventHandler);
  const routeWrite=(path,replace)=>{
    const href=canonicalTaskFlowHref(path);
    if(replace)win.history.replaceState(null,"",href);
    else win.history.pushState(null,"",href);
    notify();
  };
  return Object.freeze({
    snapshot:()=>readPagesNativeRoute(win.location.href),
    subscribe(callback){listeners.add(callback);return()=>listeners.delete(callback);},
    push(path){routeWrite(path,false);},
    replace(path){routeWrite(path,true);},
    back(){win.history.back();},
    getShareableUrl:canonicalTaskFlowHref,
    // Native AppLink uses this method to keep Cmd/Middle-click on the same
    // Pages origin; when a popup is blocked the route still remains unchanged.
    openInNewTab(path){
      const href=canonicalTaskFlowHref(path);
      win.open?.(href,"_blank","noopener,noreferrer");
    },
    dispose(){
      win.removeEventListener("hashchange",eventHandler);
      win.removeEventListener("popstate",eventHandler);
      listeners.clear();
    }
  });
}
