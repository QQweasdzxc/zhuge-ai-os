"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {minify}=require("terser"),{version}=require("terser/package.json");
const VERSION="5.44.1",FILES=["ZG-ERP/erp-app.js","ZG-ERP/erp-sheets-adapter.js"];
const OPTIONS={ecma:2020,compress:false,mangle:{toplevel:false,reserved:["S","seatUI","fieldObservation","intakeUI","repairUI","capList","LOADED_BUILD"]},keep_fnames:true,keep_classnames:true,format:{comments:false,ascii_only:false,semicolons:true}};
const hash=b=>crypto.createHash("sha256").update(b).digest("hex");
async function buildErpArtifacts(directory){
 if(version!==VERSION)throw Error("ERP minifier version mismatch");
 const output=fs.realpathSync(path.resolve(directory)),root=path.resolve(__dirname,".."),relative=path.relative(root,output),files=[];
 if(relative===""||(!relative.startsWith("..")&&!path.isAbsolute(relative)))throw Error("ERP artifact output must be outside the editable source tree");

 for(const name of FILES){const target=path.join(output,name);if(!fs.lstatSync(target).isFile()||fs.lstatSync(target).isSymbolicLink())throw Error("ERP artifact source must be a regular copied file");const actual=fs.realpathSync(target),inside=path.relative(output,actual);if(inside.startsWith("..")||path.isAbsolute(inside))throw Error("ERP artifact target escaped output");const source=fs.readFileSync(target);const result=await minify({[name]:source.toString("utf8")},structuredClone(OPTIONS));if(result.error||!result.code)throw Error("ERP minification failed: "+name);const bytes=Buffer.from(result.code+"\n");if(bytes.length>=source.length)throw Error("ERP minification did not reduce "+name);fs.writeFileSync(target,bytes);files.push({name,sourceBytes:source.length,outputBytes:bytes.length,sourceSHA256:hash(source),outputSHA256:hash(bytes)});}
 const manifest={schema:1,minifier:"terser",version,options:OPTIONS,files};
 fs.writeFileSync(path.join(output,"ZG-ERP/artifact-manifest.json"),JSON.stringify(manifest,null,2)+"\n");return manifest;
}
if(require.main===module)buildErpArtifacts(process.argv[2]).then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={buildErpArtifacts,FILES,OPTIONS,VERSION};
