const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const classicSource = fs.readFileSync(path.join(__dirname, "../status-classic.html"), "utf8");
const rootSource = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const script = classicSource.match(/<script id="taskflow-home-routing">([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "Classic status page must contain route controller");
const HOME = "https://qqweasdzxc.github.io/zhuge-ai-os/";
function navigate(query="", {session=false}={}) {
  const redirects=[];
  const reads=[];
  const window={
    location:{href:HOME+query,replace:url=>redirects.push(url)},
    localStorage:{getItem:key=>{reads.push(key);return session?"not-a-valid-session":null;}}
  };
  vm.runInNewContext(script,{window,URL,Set},{timeout:1000});
  return {redirects,reads};
}
test("classic status page IS the TF Dashboard, with or without stored session",()=>{
 for(const session of [false,true]){
   const result=navigate("",{session});
   assert.deepEqual(result.redirects,[]);
   assert.deepEqual(result.reads,[]);
 }
 assert.deepEqual(navigate("?utm_source=bookmark").redirects,[]);
});
test("explicit legacy AIOS routes still move to their original WorkLog entry",()=>{
 assert.deepEqual(navigate("?app=1&workspace=dashboard").redirects,
  [HOME+"modules/worklog/?app=1&workspace=dashboard"]);
 assert.deepEqual(navigate("?workspace=library").redirects,
  [HOME+"modules/worklog/?app=1&workspace=library"]);
 assert.deepEqual(navigate("?templateView=navigation").redirects,
  [HOME+"modules/worklog/?app=1&templateView=navigation"]);
});
test("unknown workspace is not an open redirect",()=>{
 assert.deepEqual(navigate("?workspace=attacker.example").redirects,[]);
});
test("OAuth callback is not redirected to Render and is not leaked",()=>{
 for(const query of ["?code=abc&state=xyz","?error=access_denied","#access_token=example"]){
   assert.deepEqual(navigate(query,{session:true}).redirects,[]);
 }
});
test("classic status page loads native Pages TaskFlow dashboard instead of Render redirect or iframe",()=>{
 assert.match(classicSource, /<title>經典報表（TaskFlow Dashboard） · Zhuge AI OS<\/title>/);
 assert.match(classicSource, /id="tf-workspace"/);
 assert.match(classicSource, /id="tf-issues"/);
 assert.match(classicSource, /src="labs\/taskflow\/pages-client\/app\.mjs/);
 assert.match(classicSource, /href="labs\/taskflow\/"/);
 assert.match(classicSource, /<link rel="canonical" href="https:\/\/qqweasdzxc\.github\.io\/zhuge-ai-os\/"/);
 assert.doesNotMatch(classicSource,/location\.replace\(["']https:\/\/zhuge-taskflow-web\.onrender\.com/);
 assert.doesNotMatch(classicSource,/<iframe\b/i);
});
test("root home keeps its own post-3D routing responsibilities",()=>{
 assert.match(rootSource, /labs\/pixel-office-3d\/index\.html/);
 assert.ok(rootSource.includes('zhuge-home-router.js"></script>'));
 assert.ok(!rootSource.includes('<script defer src='));
 assert.ok(rootSource.indexOf("zhuge-home-router.js") < rootSource.indexOf("labs/pixel-office-3d/index.html"),
  "OAuth router must load before the 3D iframe");
 assert.doesNotMatch(rootSource,/location\.replace\(["']https:\/\/zhuge-taskflow-web\.onrender\.com/);
});
