// zg-ledger-bridge - deployed source custody recovered 2026-11-04; structured scan department + authenticated actor.
// ZG-ERP「現存資料庫」專用橋接：前台 → 本函式（Google 服務帳號）→ Google Sheets。
// 架構定案：新帳（LEDGER_SPREADSHEET_ID）是唯一讀寫目標；舊帳 59 工作簿唯讀比對。
// 與 gas-vendor-bridge 的差異（必要政策，不照抄既有缺口）：
//   requireUser 之後、任何表格讀寫之前，以呼叫者 JWT 呼叫 is_app_access_approved()
//   —— false / null / 錯誤 / 逾時一律 fail closed（403），任何路徑不得因錯誤處理放行。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";

import {scanPlan,scanBatch} from "./scan-core.mjs";
import {repairPlan,repairBatch} from "./repair-core.mjs";
import { RowCustody } from "./row-control-server.ts";
import { logicalKeys, trackedAttempt,validOperationId } from "./row-control-core.mjs";

type JsonObject = Record<string, unknown>;

const LEGACY_SPREADSHEET_ID = "1-NPASgtZTcvf_JvmPfjfNU6I7yxD7JPveKGzZrKH6BI"; // 舊帳（唯讀比對）
const LEDGER_SPREADSHEET_ID_SECRET = "ZG_LEDGER_SPREADSHEET_ID"; // 新帳 ID 由 secret 提供（建表後設定）
const SERVICE_ACCOUNT_EMAIL_SECRET = "GOOGLE_SERVICE_ACCOUNT_EMAIL";
const SERVICE_ACCOUNT_PRIVATE_KEY_SECRET = "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY";
const GOOGLE_SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const GOOGLE_REQUEST_TIMEOUT_MS = 20000;
const APPROVAL_CHECK_TIMEOUT_MS = 10000;
const DEFAULT_ORIGIN = "https://qqweasdzxc.github.io";

// 新帳分頁（唯寫目標；釐清標示記錄每筆舊帳的核對進度與人工結論，不改寫舊帳原文）；舊帳僅整合-主檔/待確認/整合-流轉對應可比對讀取
const LEDGER_TABS = ["資產", "盤點場次", "盤點紀錄", "流轉紀錄", "進貨批次", "位置表", "釐清標示", "座位圖"] as const;
const LEGACY_READABLE_TABS = ["整合-主檔", "整合-待確認", "整合-流轉對應"] as const;

class HttpError extends Error {
  status: number; code: string; details: JsonObject;
  constructor(message: string, status: number, code: string, details: JsonObject = {}) {
    super(message); this.status = status; this.code = code; this.details = details;
  }
}
const asText = (value: unknown, fallback = "") => {
  const text = value == null ? fallback : String(value);
  return text.trim();
};

function allowedOrigin(request: Request) {
  const origin = asText(request.headers.get("origin"));
  if (origin && origin !== DEFAULT_ORIGIN) {
    throw new HttpError("Origin is not allowed.", 403, "ORIGIN_NOT_ALLOWED");
  }
  return origin;
}

async function callerClient(request: Request, supabaseUrl: string, anonKey: string) {
  const authorization = asText(request.headers.get("authorization"));
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    throw new HttpError("Authenticated Zhuge AI OS session is required.", 401, "AUTH_REQUIRED");
  }
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function requireUser(caller: ReturnType<typeof createClient>) {
  const { data: { user }, error } = await caller.auth.getUser();
  if (error || !user) throw new HttpError("Authenticated Zhuge AI OS session is required.", 401, "AUTH_REQUIRED");
  return user;
}

// 必要政策：伺服器端確認「已放行」。false/null/錯誤/逾時一律拒絕（fail closed）。
async function requireApproved(caller: ReturnType<typeof createClient>) {
  let result: { data: unknown; error: unknown };
  try {
    const pending = caller.rpc("is_app_access_approved");
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("approval check timeout")), APPROVAL_CHECK_TIMEOUT_MS));
    result = await Promise.race([pending, timeout]) as typeof result;
  } catch (e) {
    throw new HttpError("Access approval check failed.", 403, "ACCESS_CHECK_FAILED",
      { reason: asText((e as Error)?.message).slice(0, 200) });
  }
  if (result.error) {
    throw new HttpError("Access approval check failed.", 403, "ACCESS_CHECK_FAILED",
      { reason: asText((result.error as { message?: string })?.message).slice(0, 200) });
  }
  if (result.data !== true) { // false 與 null（無申請紀錄）都不得放行
    throw new HttpError("Access is not approved for this account.", 403, "ACCESS_NOT_APPROVED");
  }
}

/* --- Google 服務帳號（比照 gas-vendor-bridge：SA 於 Deno secrets，簽 JWT 換 access token） --- */
function pemToArrayBuffer(pem: string): ArrayBuffer { /* 同 gas-vendor-bridge */
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64); const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
async function googleAccessToken(email: string, privateKey: string): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", pemToArrayBuffer(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = btoa(JSON.stringify({
    iss: email, scope: GOOGLE_SCOPE, aud: GOOGLE_TOKEN_URL, iat: now, exp: now + 3600
  }));
  const unsigned = `${header}.${claim}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
    signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS)
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    throw new HttpError("Google token exchange failed.", 502, "GOOGLE_TOKEN_FAILED");
  }
  return body.access_token as string;
}

/* --- Sheets 讀寫（寫入後讀回驗證） --- */
function resolveTarget(tab: string): { spreadsheetId: string; readonly: boolean } {
  if ((LEGACY_READABLE_TABS as readonly string[]).includes(tab)) {
    return { spreadsheetId: LEGACY_SPREADSHEET_ID, readonly: true };
  }
  if ((LEDGER_TABS as readonly string[]).includes(tab)) {
    const id = asText(Deno.env.get(LEDGER_SPREADSHEET_ID_SECRET));
    if (!id) throw new HttpError("Ledger spreadsheet is not configured.", 503, "LEDGER_CONFIG_MISSING");
    return { spreadsheetId: id, readonly: false };
  }
  throw new HttpError("Unknown tab.", 400, "TAB_UNKNOWN");
}

async function sheetsRead(token: string, spreadsheetId: string, tab: string) {
  const url = `${GOOGLE_SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(tab)}!A1:Z10000?valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS) });
  const body = await res.json();
  if (!res.ok) throw new HttpError("Sheet read failed.", 502, "SHEET_READ_FAILED");
  const values = (body.values || []) as unknown[][];
  return { header: values[0] || [], rows: values.slice(1) };
}

async function sheetsUpdate(token: string, spreadsheetId: string, range: string, row: unknown[], custody: RowCustody) {
  const url = `${GOOGLE_SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const res = await trackedAttempt(custody,()=>fetch(url, {
    method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ values: [row] }), signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS)
  }));
  const body = await res.json();
  if (!res.ok) throw new HttpError("Sheet update failed.", 502, "SHEET_UPDATE_FAILED");
  return body;
}

async function sheetsAppend(token: string, spreadsheetId: string, tab: string, row: unknown[], custody: RowCustody) {
  const url = `${GOOGLE_SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(tab)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const res = await trackedAttempt(custody,()=>fetch(url, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ values: [row] }), signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS)
  }));
  const body = await res.json();
  if (!res.ok) throw new HttpError("Sheet append failed.", 502, "SHEET_APPEND_FAILED");
  return body; // 讀回驗證由呼叫端以 updatedRange 再 read 確認
}

// Update changed cells only. Sheets has no atomic compare-and-set across simultaneous writers.
async function sheetsPatchCells(token:string, spreadsheetId:string, tab:string, rowNum:number, changes:Record<string,unknown>,custody:RowCustody) {
  const letters=(n:number):string=>n?letters(Math.floor((n-1)/26))+String.fromCharCode(65+(n-1)%26):"";
  const data=Object.entries(changes).map(([col,v])=>({range:tab+"!"+letters(Number(col)+1)+rowNum,values:[[v]]}));
  const res=await trackedAttempt(custody,()=>fetch(`${GOOGLE_SHEETS_API}/${spreadsheetId}/values:batchUpdate`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({valueInputOption:"RAW",data}),signal:AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS)}));
  const b=await res.json();if(!res.ok||b.totalUpdatedCells!==data.length)throw new HttpError("儲存未確認，請保留輸入後重試。",502,"WRITE_VERIFY_FAILED");
}

// Sheets append assigns a single row order. Reconcile after append so racing writes cannot silently supersede a winner.
function canonicalSeatEvents(rows: unknown[][]) {
  const occupants=new Map<string,string>(),bindings=new Map<string,{version:string;seat:string}>(),maps=new Map<string,string>(),accepted=new Set<string>();
  for(const r of rows){try{const id=asText(r[0]),kind=r[1],version=asText(r[2]),place=JSON.stringify([r[3],r[4]]),seat=String(r[5]),data=JSON.parse(String(r[7]));if(accepted.has(id))continue;
    if(kind==='map'){const prior=maps.get(place);if(prior&&prior!==version)continue;maps.set(place,version);}
    if(['occupant','binding','placement','check'].includes(String(kind))&&maps.get(place)!==version)continue;
    if(kind==='occupant'){const key=version+':'+seat;if((data.previous||'')!==(occupants.get(key)||''))continue;occupants.set(key,id);}
    if(kind==='binding'||kind==='placement'){const key=asText(r[6]),prior=bindings.get(key);if(prior&&(prior.version!==version||prior.seat!==seat))continue;bindings.set(key,{version,seat});}
    accepted.add(id);
  }catch{}}
  return accepted;
}

/* --- 動作路由 --- */
Deno.serve(async (request) => {
  let origin = "";
  let custody:RowCustody|undefined;
  let beganWrite=false;let retainKeys:string[]=[];
  try {
    origin = allowedOrigin(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    const supabaseUrl = asText(Deno.env.get("SUPABASE_URL"));
    const anonKey = asText(Deno.env.get("SUPABASE_ANON_KEY"));
    const caller = await callerClient(request, supabaseUrl, anonKey);
    const user = await requireUser(caller);
    const actor = user.id;
    await requireApproved(caller); // 必要政策：任何表格讀寫之前

    const email = asText(Deno.env.get(SERVICE_ACCOUNT_EMAIL_SECRET));
    const privateKey = asText(Deno.env.get(SERVICE_ACCOUNT_PRIVATE_KEY_SECRET));
    if (!email || !privateKey) {
      throw new HttpError("Google service account credential is not configured.", 503, "GOOGLE_SERVICE_ACCOUNT_CONFIG_MISSING");
    }
    const token = await googleAccessToken(email, privateKey);

    const url = new URL(request.url);
    const action = asText(url.searchParams.get("action") || "read");
    const tab = asText(url.searchParams.get("tab"));
    const target = resolveTarget(tab);

    if (action === "read") {
      return json({ ...(await sheetsRead(token, target.spreadsheetId, tab)), actor }, 200, origin);
    }
    if (target.readonly) {
      throw new HttpError("Legacy workbook is comparison-only and read-only.", 400, "TARGET_READ_ONLY");
    }
    const payload = request.method==='POST' ? await request.json() : {};
    const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
    const reservation=payload.reservationToken, operation=payload.operationId;
    if(!uuid(reservation))throw new HttpError('更新版本後重整頁面再操作，未寫入。',409,'CUSTODY_REQUIRED');
    if(!validOperationId(operation))throw new HttpError('操作識別已到期或裝置時間不準，未寫入。請校正裝置時間並重新整理後再操作。',409,'OPERATION_EXPIRED');
    let keys:string[]=[];
    async function scanDatabase(){
      const [assets,sessions,records,seats,legacy]=await Promise.all(['資產','盤點場次','盤點紀錄','座位圖','整合-主檔'].map(t=>sheetsRead(token,t==='整合-主檔'?LEGACY_SPREADSHEET_ID:target.spreadsheetId,t)));
      if([assets,sessions,records,seats].some(x=>x.rows.length>=9999))throw new HttpError('讀取範圍不足，未寫入。',409,'SCAN_LIMIT');
      if(assets.header[0]!=='資產編號'||assets.header[21]!=='使用部門'||sessions.header[12]!=='使用部門'||records.header[10]!=='經手人'||seats.header[0]!=='事件鍵')throw new HttpError('盤點欄位尚未就緒，未寫入。',503,'SCHEMA_NOT_READY');
      const ix=(...names:string[])=>names.map(n=>legacy.header.indexOf(n)).find(i=>i>=0),get=(r:unknown[],...names:string[])=>String(r[ix(...names)]??'').trim();
      const old=legacy.rows.map(r=>({code:get(r,'資產編號'),name:get(r,'名稱'),model:get(r,'型號規格','型號'),serial:get(r,'S-N','S/N','序號'),purchase:get(r,'採購日期'),recordKey:get(r,'記錄鍵'),provenance:get(r,'來源工作表')+' 第'+get(r,'來源列')+'列'}));
      return {assets:assets.rows,sessions:sessions.rows,records:records.rows,seats:seats.rows,legacy:old};
    }

    if(action==='scan-intent'){
      if(tab!=='資產')throw new HttpError('Asset tab required.',400,'BAD_REQUEST');
      const initial=scanPlan(await scanDatabase(),payload,user.id,new Date().toISOString());
      keys=[...logicalKeys('資產',initial.asset,initial.original||undefined),...logicalKeys('盤點紀錄',initial.record),...(initial.binding?logicalKeys('座位圖',initial.binding):[])];
    }else if(['reserve','renew','release','asset-edit','repair-stage'].includes(action)){
      if(tab!=="資產"||typeof payload.code!=='string'||!payload.code.trim())throw new HttpError("Asset identity required.",400,"BAD_REQUEST");
      const assets=await sheetsRead(token,target.spreadsheetId,tab),hits=assets.rows.filter(r=>r[0]===payload.code);
      if(hits.length!==1)throw new HttpError("設備編號不是唯一記錄，未寫入。",409,"ASSET_CONFLICT");
      const row=[...hits[0]];if(action==='asset-edit'&&payload.patch?.serial!==undefined)row[3]=payload.patch.serial;
      keys=action==='asset-edit'?logicalKeys(tab,row,hits[0]):logicalKeys(tab,[payload.code]);
      if(action==='repair-stage')keys.push(...logicalKeys('流轉紀錄',['repair:'+operation,'','',payload.code]));
    }else if(action==='update'){
      const match=new RegExp('^'+tab+'!A([2-9][0-9]*|1[0-9]+):[A-Z]+([0-9]+)$').exec(String(payload.range||''));
      if(!match||match[1]!==match[2]||!Array.isArray(payload.row))throw new HttpError("Single server-resolved row required.",400,"BAD_REQUEST");
      const prior=(await sheetsRead(token,target.spreadsheetId,tab)).rows[Number(match[1])-2];
      if(!prior)throw new HttpError("Original row missing.",409,"ROW_MISSING");
      // Both original and resulting logical identities must be reserved. Asset code cannot change.
      keys=[...new Set([...logicalKeys(tab,prior),...logicalKeys(tab,payload.row,prior)])].sort();
    }else if(action==='append'||action==='seat-event')keys=logicalKeys(tab,payload.row);
    else if(action==='intake-import'){
      if(tab!=="進貨批次"||!Array.isArray(payload.groups))throw new HttpError("Import invalid.",400,"BAD_REQUEST");
      for(const [i,g] of payload.groups.entries())for(const serial of g.serials||[])keys.push(...logicalKeys(tab,['明細',payload.id+'-'+i,'','','','','','','','','','pending',serial]));
      keys=[...new Set(keys)].sort();
    }else throw new HttpError("Unknown action.",400,"ACTION_UNKNOWN");
    const serviceKey=asText(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    if(!serviceKey)throw new HttpError("ERP control is not configured.",503,"CUSTODY_UNAVAILABLE");
    const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    custody=new RowCustody(admin,user.id,reservation,operation,keys);
    if(action==='renew'){await custody.renew();return json({ok:true},200,origin)}
    if(action==='release'){await custody.release();return json({ok:true},200,origin)}
    if(action==='seat-event'&&payload.row?.[1]==='placement'){
      if(!payload.editorCode)throw new HttpError('需要有效設備編輯權限，未寫入。',409,'CUSTODY_REQUIRED');
      if(payload.row[6]!==payload.editorCode)throw new HttpError('Editor asset mismatch.',409,'CUSTODY_REQUIRED');
      retainKeys=logicalKeys('資產',[payload.editorCode]);await new RowCustody(admin,user.id,reservation,operation,retainKeys).renew();
    }
    if(action==='repair-stage'&&payload.editorCode){
      if(payload.editorCode!==payload.code)throw new HttpError('Editor asset mismatch.',409,'CUSTODY_REQUIRED');
      await new RowCustody(admin,user.id,reservation,operation,logicalKeys('資產',[payload.code])).renew();
    }
    if(action==='asset-edit'){
      // Primary edit reservation must still be alive BEFORE acquiring added serial key.
      const primary=new RowCustody(admin,user.id,reservation,operation,logicalKeys('資產',[payload.code]));
      await primary.renew();await custody.reserve();
    }else await custody.reserve();
    if(action==='reserve')return json({ok:true,expiresIn:300},200,origin);
    await custody.begin();beganWrite=true;
    if(action==='scan-intent'){
      const db=await scanDatabase(),plan=scanPlan(db,payload,user.id,new Date().toISOString());
      const freshKeys=[...logicalKeys('資產',plan.asset,plan.original||undefined),...logicalKeys('盤點紀錄',plan.record),...(plan.binding?logicalKeys('座位圖',plan.binding):[])];
      if(freshKeys.some(k=>!keys.includes(k)))throw new HttpError('設備資料已改變，未寫入，請重新核對。',409,'SCAN_CONFLICT');
      const metaRes=await fetch(`${GOOGLE_SHEETS_API}/${target.spreadsheetId}?fields=sheets(properties(sheetId,title))`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS)}),meta=await metaRes.json();if(!metaRes.ok)throw new HttpError('無法核對分頁，未寫入。',503,'SCAN_METADATA');
      const ids:Record<string,number>={};for(const title of ['資產','盤點紀錄','座位圖']){const match=meta.sheets?.filter(x=>x.properties.title===title);if(match?.length!==1)throw new HttpError('分頁不唯一，未寫入。',503,'SCAN_METADATA');ids[title]=match[0].properties.sheetId;}
      const batch=scanBatch(ids,plan),result=await trackedAttempt(custody,()=>fetch(`${GOOGLE_SHEETS_API}/${target.spreadsheetId}:batchUpdate`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(batch),signal:AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS)})),body=await result.json();
      if(!result.ok||body.spreadsheetId!==target.spreadsheetId||body.replies?.length!==batch.requests.length)throw new HttpError('盤點保存結果待查，不可重送。',502,'SCAN_UNVERIFIED');
      const after=await scanDatabase(),assets=after.assets.map((r,i)=>({r,i})).filter(x=>x.r[0]===plan.code),records=after.records.map((r,i)=>({r,i})).filter(x=>x.r[0]===payload.sessionId&&x.r[1]===plan.code),binding=plan.binding?after.seats.filter(r=>r[0]===plan.binding[0]):[];
      if(assets.length!==1||records.length!==1||plan.asset.some((v,i)=>String(assets[0].r[i]??'')!==String(v??''))||plan.record.some((v,i)=>String(records[0].r[i]??'')!==String(v??''))||plan.binding&&(binding.length!==1||plan.binding.some((v,i)=>String(binding[0][i]??'')!==String(v??''))))throw new HttpError('盤點未能完整核對，不可重送。',409,'SCAN_UNVERIFIED');
      return json({ok:true,asset:assets[0].r,assetRow:assets[0].i+2,record:records[0].r,recordRow:records[0].i+2,binding:binding[0]||null,exception:plan.exception,metadataIssue:plan.metadataIssue,assignedProject:plan.assignedProject,departmentMismatch:plan.departmentMismatch},200,origin);
    }
    if(action==='repair-stage'){
      const assets=await sheetsRead(token,target.spreadsheetId,'資產'),movements=await sheetsRead(token,target.spreadsheetId,'流轉紀錄');
      if(assets.header[0]!=='資產編號'||assets.header[8]!=='狀態'||assets.header[20]!=='最後異動時間'||movements.header.join('|')!==['事件鍵','日期','事件類型','資產編號','來自地點','至地點','數量','經手人','備註','出處'].join('|'))throw new HttpError('維修欄位尚未就緒，未寫入。',503,'SCHEMA_NOT_READY');
      if(assets.rows.length>=9999||movements.rows.length>=9999)throw new HttpError('維修讀取範圍不足，未寫入。',409,'REPAIR_LIMIT');
      const hits=assets.rows.map((r,i)=>({r,i})).filter(x=>x.r[0]===payload.code);if(hits.length!==1)throw new HttpError('設備編號不是唯一記錄，未寫入。',409,'REPAIR_CONFLICT');
      let plan;try{plan=repairPlan(hits[0].r,movements.rows,payload,user.id,new Date().toISOString())}catch(e){throw new HttpError(String(e.message),409,'REPAIR_CONFLICT')}
      const metaRes=await fetch(`${GOOGLE_SHEETS_API}/${target.spreadsheetId}?fields=sheets(properties(sheetId,title))`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS)});
      const meta=await metaRes.json();if(!metaRes.ok)throw new HttpError('無法核對分頁，未寫入。',503,'REPAIR_METADATA');
      const sheet=(title:string)=>{const match=meta.sheets?.filter(x=>x.properties.title===title);if(match?.length!==1)throw new HttpError('分頁不唯一，未寫入。',503,'REPAIR_METADATA');return match[0].properties.sheetId};
      const batch=repairBatch(sheet('資產'),sheet('流轉紀錄'),hits[0].i+1,plan);
      const result=await trackedAttempt(custody,()=>fetch(`${GOOGLE_SHEETS_API}/${target.spreadsheetId}:batchUpdate`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(batch),signal:AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS)}));
      const body=await result.json();if(!result.ok||body.spreadsheetId!==target.spreadsheetId||body.replies?.length!==batch.requests.length)throw new HttpError('維修保存結果待查，不可重送。',502,'REPAIR_UNVERIFIED');
      const after=await sheetsRead(token,target.spreadsheetId,'資產'),history=await sheetsRead(token,target.spreadsheetId,'流轉紀錄'),asset=after.rows[hits[0].i],events=history.rows.map((r,i)=>({r,i})).filter(x=>x.r[0]===plan.movement[0]);
      if(!asset||asset[0]!==payload.code||Object.entries(plan.changes).some(([c,v])=>String(asset[Number(c)]??'')!==String(v))||events.length!==1||plan.movement.some((v,i)=>String(events[0].r[i]??'')!==String(v)))throw new HttpError('維修資料未能完整核對，不可重送。',409,'REPAIR_UNVERIFIED');
      return json({ok:true,asset,assetRow:hits[0].i+2,movement:events[0].r,movementRow:events[0].i+2},200,origin);
    }
    if (tab === "座位圖") {
      if (action !== "seat-event") throw new HttpError("Seat map events are append-only.",400,"SEAT_APPEND_ONLY");
      const {row} = payload;
      if (!Array.isArray(row) || row.length !== 10 || row.some(v => typeof v === "object")) throw new HttpError("Seat event invalid.",400,"BAD_REQUEST");
      const schema = await sheetsRead(token,target.spreadsheetId,tab);
      const headers=["事件鍵","類型","圖版本","據點","區域","座位編號","資產編號","內容JSON","時間","經手人"];
      if (!headers.every((h,i)=>schema.header[i]===h)) throw new HttpError("Seat schema is not ready.",503,"SCHEMA_NOT_READY");
      if (!["part","map","occupant","binding","placement","check"].includes(row[1]) || !asText(row[0]) || !asText(row[2]) || !asText(row[3]) || !asText(row[4]) || String(row[7]).length>24000) throw new HttpError("Seat event invalid.",400,"BAD_REQUEST");
      let data;try{data=JSON.parse(row[7]);}catch{throw new HttpError("Seat payload invalid.",400,"BAD_REQUEST");}
      if(!data||typeof data!=="object"||Array.isArray(data))throw new HttpError("Seat payload must be an object.",400,"BAD_REQUEST");
      const previous=schema.rows.find(r=>r[0]===row[0]);
      if(previous) {if(previous.slice(1,8).some((v,i)=>String(v)!==String(row[i+1])))throw new HttpError("Seat event conflicts.",409,"SEAT_CONFLICT");if(!canonicalSeatEvents(schema.rows).has(asText(row[0])))throw new HttpError("Concurrent seat event won; reload before retry.",409,"SEAT_CONFLICT");return json({ok:true,row:previous,actor},200,origin);}
      if (["occupant","binding","placement","check"].includes(row[1]) && (!Number.isInteger(Number(row[5])) || Number(row[5])<1 || Number(row[5])>500))throw new HttpError("Seat number invalid.",400,"BAD_REQUEST");
      if(row[1]==="occupant" && (typeof data.previous!=="string"||typeof data.name!=="string"||data.name.length>120))throw new HttpError("Name invalid.",400,"BAD_REQUEST");
      if (["occupant","binding","placement","check"].includes(row[1])) {
        const commit=schema.rows.find(r=>r[1]==="map"&&r[2]===row[2]&&r[3]===row[3]&&r[4]===row[4]);
        if(!commit)throw new HttpError("Saved map not found.",400,"SEAT_MAP_MISSING");
        let map;try{const meta=JSON.parse(String(commit[7]));map=JSON.parse(meta.parts.map((id:string)=>{const part=schema.rows.find(r=>r[0]===id&&r[1]==="part"&&r[2]===row[2]);if(!part)throw Error();return JSON.parse(String(part[7])).text}).join(""));}catch{throw new HttpError("Saved map invalid.",400,"SEAT_MAP_INVALID");}
        if(!Array.isArray(map.seats)||!map.seats.some((x:{number:number})=>x.number===Number(row[5])))throw new HttpError("Seat not in saved map.",400,"SEAT_UNKNOWN");
        if(row[1]==="placement") {
          if(data.confirmed!==true||data.source!=="asset-editor"||typeof row[6]!=="string"||!row[6]||data.sessionId)throw new HttpError("Explicit manual placement required.",400,"PLACEMENT_REQUIRED");
          const assets=await sheetsRead(token,target.spreadsheetId,"資產"),hits=assets.rows.filter(r=>r[0]===row[6]);
          if(hits.length!==1||hits[0][4]!==row[3]||hits[0][5]!==row[4])throw new HttpError("設備據點／區域與座位圖不符，未指定座位。請先保存設備區域後再核對。",409,"PLACEMENT_MISMATCH");
        }
        if(row[1]==="binding"||row[1]==="check") {
          const sessions=await sheetsRead(token,target.spreadsheetId,"盤點場次");
          const session=sessions.rows.find(r=>r[0]===data.sessionId&&r[1]===row[3]&&r[10]==="進行中");
          if(!session)throw new HttpError("Active session not found for this site.",400,"SESSION_MISSING");
          if(row[1]==="check"&&data.confirmed!==true)throw new HttpError("Explicit seat check required.",400,"SEAT_CHECK_REQUIRED");
          if(row[1]==="binding") { const records=await sheetsRead(token,target.spreadsheetId,"盤點紀錄");
            if(!records.rows.some(r=>r[0]===data.sessionId&&r[1]===row[6]&&r[3]===row[3]&&r[4]===row[4]))throw new HttpError("Actual scan record missing.",400,"SCAN_MISSING");
          }
        }
      }
      if(row[1]==="binding"||row[1]==="placement"){
        const prior=[...schema.rows].reverse().find(r=>(r[1]==="binding"||r[1]==="placement")&&r[6]===row[6]);
        if(prior && (prior[2]!==row[2]||String(prior[5])!==String(row[5])))throw new HttpError("Equipment already has another seat; preserved original binding.",409,"SEAT_CONFLICT");
      }
      if(row[1]==="map") {
        if(schema.rows.some(r=>r[1]==="map"&&r[3]===row[3]&&r[4]===row[4]&&r[2]!==row[2]))throw new HttpError("Existing map preserved; replacement requires a migration.",409,"SEAT_CONFLICT");
        if(!Array.isArray(data.parts)||!data.parts.length||data.parts.length>60)throw new HttpError("Map manifest invalid.",400,"BAD_REQUEST");
        let map;try{map=JSON.parse(data.parts.map((id:string)=>{const part=schema.rows.find(r=>r[0]===id&&r[1]==="part"&&r[2]===row[2]&&r[3]===row[3]&&r[4]===row[4]);if(!part)throw Error();return JSON.parse(String(part[7])).text}).join(""));}catch{throw new HttpError("Map parts incomplete.",400,"SEAT_MAP_INCOMPLETE");}
        if(!Array.isArray(map.seats)||!map.seats.length||map.seats.length>500||new Set(map.seats.map((x:{number:number})=>x.number)).size!==map.seats.length||map.seats.some((x:{number:number})=>!Number.isInteger(x.number)||x.number<1||x.number>500))throw new HttpError("Map seat numbers invalid.",400,"SEAT_MAP_INVALID");
      }
      if(row[1]==="part" && (typeof data.text!=="string" || data.text.length>12000))throw new HttpError("Map part invalid.",400,"BAD_REQUEST");
      row[8]=new Date().toISOString();row[9]=actor;
      const appended=await sheetsAppend(token,target.spreadsheetId,tab,row,custody);
      if(!appended?.updates?.updatedRange)throw new HttpError("Seat write unverified.",502,"WRITE_VERIFY_FAILED");
      const readback=await sheetsRead(token,target.spreadsheetId,tab);
      const rangeMatch=String(appended.updates.updatedRange).match(/!A(\d+):J\d+$/);if(!rangeMatch||Number(rangeMatch[1])>readback.rows.length+1)throw new HttpError("Seat append prefix not read back.",502,"WRITE_VERIFY_FAILED");
      const saved=readback.rows.find(r=>r[0]===row[0]);if(!saved||saved.slice(0,8).some((v,i)=>String(v)!==String(row[i])))throw new HttpError("Seat readback failed.",502,"WRITE_VERIFY_FAILED");
      if(!canonicalSeatEvents(readback.rows).has(asText(row[0])))throw new HttpError("A concurrent edit or binding won. Reload seat data before retry; your write was not applied.",409,"SEAT_CONFLICT");
      return json({ok:true,row:saved,actor},200,origin);
    }
    if (action === "intake-import") {
      if(tab!=="進貨批次")throw new HttpError("進貨批次限定。",400,"BAD_REQUEST");
      const {id,groups}=payload;
      const keys=["po","vendor","brand","model","origin","type","mfgYear","note"];
      if(typeof id!=="string"||!/^xi-[a-f0-9-]{36}$/.test(id)||!Array.isArray(groups)||!groups.length||groups.length>100)throw new HttpError("匯入格式不符。",400,"BAD_REQUEST");
      const serials:string[]=[];
      for(const b of groups){if(!b||keys.some(k=>typeof b[k]!=="string"||b[k].length>2000)||!Array.isArray(b.serials)||!b.serials.length||b.serials.some((v:unknown)=>typeof v!=="string"||!v.trim()||v!==v.trim()||v.length>2000)||b.mfgYear&&!/^\d{4}$/.test(b.mfgYear))throw new HttpError("欄位或序號格式不符。",400,"BAD_REQUEST");serials.push(...b.serials);}
      if(serials.length>500||new Set(serials).size!==serials.length)throw new HttpError("最多500筆，序號不可重複。",400,"BAD_REQUEST");
      const before=await sheetsRead(token,target.spreadsheetId,tab);
      const headers=["行別","批次鍵","PO","廠商","品牌","型號","產地","類型","製造年份","備註","建立時間","狀態","序號","到貨時間","登記編號"];
      if(!headers.every((h,i)=>before.header[i]===h))throw new HttpError("進貨批次欄位不符，未寫入。",503,"SCHEMA_NOT_READY");
      const at=new Date().toISOString(),ids=groups.map((_:unknown,i:number)=>id+"-"+i),rows:unknown[][]=[];
      for(let i=0;i<groups.length;i++){const b=groups[i];rows.push(["批次",ids[i],b.po,b.vendor,b.brand,b.model,b.origin,b.type,b.mfgYear,b.note,at,"進行中","","",""]);for(const serial of b.serials)rows.push(["明細",ids[i],"","","","","","","","","","pending",serial,"",""]);}
      const own=(rs:unknown[][])=>rs.filter(r=>String(r[1]??"").startsWith(id+"-"));
      const equal=(stored:unknown[][])=>stored.length===rows.length&&stored.every((r,i)=>rows[i].every((v,c)=>c===10||String(r[c]??"")===String(v)));
      const prior=own(before.rows);
      if(prior.length){if(!equal(prior))throw new HttpError("此匯入已有不完整或不同內容，未重複追加。請保留畫面並核對批次。",409,"IMPORT_PARTIAL");return json({ok:true,rows:prior,ids,replayed:true},200,origin);}
      const assets=await sheetsRead(token,target.spreadsheetId,"資產");
      if(assets.rows.length>=9999)throw new HttpError("設備讀取範圍不足，未匯入。",409,"IMPORT_LIMIT");
      if(assets.header[3]!=="序號")throw new HttpError("設備序號欄位不符。",503,"SCHEMA_NOT_READY");
      const current=new Set(assets.rows.map(r=>String(r[3]??"").trim()).filter(Boolean));
      const closed=new Set(before.rows.filter(r=>r[0]==="批次"&&r[11]==="已結案").map(r=>r[1]));
      for(const r of before.rows)if(r[0]==="明細"&&!closed.has(r[1])&&r[12])current.add(String(r[12]).trim());
      if(serials.some(s=>current.has(s)))throw new HttpError("序號已存在設備或未結案批次，未匯入。請重新核對預覽。",409,"SERIAL_EXISTS");
      if(before.rows.length+rows.length>9500)throw new HttpError("批次資料量已達本次匯入上限，未寫入。",409,"IMPORT_LIMIT");
      const url=`${GOOGLE_SHEETS_API}/${target.spreadsheetId}/values/${encodeURIComponent(tab)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
      const res=await trackedAttempt(custody,()=>fetch(url,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({values:rows}),signal:AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS)}));
      if(!res.ok)throw new HttpError("匯入未確認，請保留畫面並用同一按鈕重試。",502,"IMPORT_UNVERIFIED");
      const saved=own((await sheetsRead(token,target.spreadsheetId,tab)).rows);
      if(!equal(saved))throw new HttpError("寫入後未完整讀回，請保留畫面並用同一按鈕重試。",409,"IMPORT_UNVERIFIED");
      return json({ok:true,rows:saved,ids},200,origin);
    }
    if (action === "asset-edit") {
      if(tab!=="資產")throw new HttpError("Asset tab required.",400,"BAD_REQUEST");
      const {code,patch,expected}=payload;
      const columns:Record<string,number>={name:1,model:2,serial:3,zone:5,owner:6,project:7,status:8,brand:9,origin:10,type:11,mfgYear:12,po:13,purchase:14,activate:15,warranty:16,department:21};
      if(typeof code!=="string"||!patch||!expected||Array.isArray(patch)||Array.isArray(expected)||typeof patch!=="object"||typeof expected!=="object"||Object.keys(patch).some(k=>columns[k]===undefined||typeof patch[k]!=="string"||typeof expected[k]!=="string"||patch[k].length>2000))throw new HttpError("Asset edit invalid.",400,"BAD_REQUEST");
      const before=await sheetsRead(token,target.spreadsheetId,tab);
      if(before.header[0]!=="資產編號"||before.header[21]!=="使用部門")throw new HttpError("Asset schema not ready.",503,"SCHEMA_NOT_READY");
      const hits=before.rows.map((r,i)=>({r,i})).filter(x=>x.r[0]===code);
      if(hits.length!==1)throw new HttpError("設備編號不是唯一記錄，未寫入。",409,"ASSET_CONFLICT");
      const {r,i}=hits[0];
      for(const k of Object.keys(patch))if(String(r[columns[k]]??"")!==expected[k]&&String(r[columns[k]]??"")!==patch[k])throw new HttpError("這些欄位已被其他操作修改。未覆蓋，請保留輸入並重新整理頁面後核對。",409,"ASSET_CONFLICT");
      const row=[...r];
      for(const k of Object.keys(patch)){while(row.length<=columns[k])row.push("");row[columns[k]]=patch[k];}
      if(patch.serial&&before.rows.some(other=>other[0]!==code&&String(other[3]||'').trim()===patch.serial.trim()))throw new HttpError('序號已由其他設備使用，未覆蓋。',409,'SERIAL_EXISTS');
      const changes:Record<string,unknown>={};for(const k of Object.keys(patch))if(String(r[columns[k]]??"")!==patch[k])changes[String(columns[k])]=patch[k];
      if(Object.keys(changes).length){changes["20"]=new Date().toISOString();await sheetsPatchCells(token,target.spreadsheetId,tab,i+2,changes,custody);}
      const after=await sheetsRead(token,target.spreadsheetId,tab),saved=after.rows[i];
      if(!saved||saved[0]!==code||(Object.keys(patch).some(k=>String(saved[columns[k]]??"")!==patch[k])||Object.entries(changes).some(([k,v])=>String(saved[Number(k)]??"")!==String(v))))throw new HttpError("儲存後資料未能一致讀回，請保留輸入並重新核對。",409,"WRITE_VERIFY_FAILED");
      return json({ok:true,row:saved,rowNum:i+2},200,origin);
    }
    if (action === "append") {
      const row=payload.row;if(!Array.isArray(row))throw new HttpError('row 必填。',400,'BAD_REQUEST');const prior=await sheetsRead(token,target.spreadsheetId,tab);
      const identity=(r:unknown[])=>tab==='資產'?String(r[0]):tab==='盤點紀錄'?JSON.stringify([r[0],r[1]]):tab==='盤點場次'||tab==='流轉紀錄'?String(r[0]):tab==='位置表'?JSON.stringify([r[0],r[1]]):null;
      if(identity(row)!==null&&prior.rows.some(r=>identity(r)===identity(row)))throw new HttpError('原始記錄已存在，沒有追加重複資料。請更新後核對。',409,'ROW_EXISTS');
      if (!Array.isArray(row)) throw new HttpError("row 必填。", 400, "BAD_REQUEST");
      const expected = ({ "資產": {21:"使用部門",22:"舊帳記錄鍵",23:"舊帳出處",24:"舊帳快照",25:"資料補入時間"}, "盤點場次": {12:"使用部門"}, "盤點紀錄": {8:"使用部門",9:"本次專案",10:"經手人"} } as Record<string, Record<string,string>>)[tab];
      if (expected) {
        const schema = await sheetsRead(token, target.spreadsheetId, tab);
        if (!Object.entries(expected).every(([i,h]) => schema.header[Number(i)] === h)) throw new HttpError("Ledger schema is not ready.", 503, "SCHEMA_NOT_READY");
      }
      const actorColumn = ({ "資產": 19, "盤點場次": 8, "盤點紀錄": 10, "流轉紀錄": 7, "釐清標示": 8 } as Record<string, number>)[tab];
      if (actorColumn != null) { while (row.length <= actorColumn) row.push(""); row[actorColumn] = actor; }
      const appended = await sheetsAppend(token, target.spreadsheetId, tab, row,custody);
      // 寫入後讀回驗證：以前端可見的失敗為準，不假裝成功
      const range = asText(appended?.updates?.updatedRange);
      if (!range) throw new HttpError("Write verification failed.", 502, "WRITE_VERIFY_FAILED");
      const stored=(await sheetsRead(token,target.spreadsheetId,tab)).rows[Number(/!A([0-9]+):/.exec(range)?.[1])-2];
      if(!stored||row.some((v,i)=>String(stored[i]??'')!==String(v??'')))throw new HttpError('寫入後未能完整讀回，結果待查，不可重送。',409,'WRITE_VERIFY_FAILED');
      return json({ ok: true, updatedRange: range, actor }, 200, origin);
    }
    if (action === "update") {
      const { range, row,expected } = payload as { range: string; row: unknown[];expected:unknown[] };
      const rng = asText(range);
      if (!rng || !Array.isArray(row)) throw new HttpError("range 與 row 必填。", 400, "BAD_REQUEST");
      // range 必須屬於本次 tab，防止跨分頁寫入
      if (!rng.startsWith(tab + "!")) throw new HttpError("Range 與分頁不符。", 400, "RANGE_TAB_MISMATCH");
      const rowIndex=Number(/^.+!A([0-9]+):/.exec(rng)?.[1])-2,current=(await sheetsRead(token,target.spreadsheetId,tab)).rows[rowIndex];
      if(!Array.isArray(expected)||!current||Math.max(current.length,expected.length)>0&&Array.from({length:Math.max(current.length,expected.length)},(_,i)=>i).some(i=>String(current[i]??'')!==String(expected[i]??'')))throw new HttpError('資料已被其他操作改變，未覆蓋。請更新後核對。',409,'ROW_CONFLICT');
      // Preserve original authorship, including historical blanks. Updates must not invent a creator.
      const actorColumn = ({ "資產": 19, "盤點場次": 8, "盤點紀錄": 10, "流轉紀錄": 7, "釐清標示": 8 } as Record<string, number>)[tab];
      if (actorColumn != null) {
        const rowMatch = new RegExp("^" + tab + "!A([2-9][0-9]*|1[0-9]+):[A-Z]+([0-9]+)$").exec(rng);
        if (!rowMatch || rowMatch[1] !== rowMatch[2]) throw new HttpError("Single data row required.", 400, "BAD_REQUEST");
        const prior = await sheetsRead(token, target.spreadsheetId, tab);
        const original = prior.rows[Number(rowMatch[1]) - 2];
        if (!original) throw new HttpError("Original row not found.", 400, "BAD_REQUEST");
        while (row.length <= actorColumn) row.push("");
        row[actorColumn] = original[actorColumn] || "";
      }
      const updated = await sheetsUpdate(token, target.spreadsheetId, rng, row,custody);
      const updatedRange = asText(updated?.updatedRange);
      if (!updatedRange) throw new HttpError("Write verification failed.", 502, "WRITE_VERIFY_FAILED");
      const verified=(await sheetsRead(token,target.spreadsheetId,tab)).rows[rowIndex];if(!verified||row.some((v,i)=>String(verified[i]??'')!==String(v??'')))throw new HttpError('寫入後未能完整讀回，結果待查，不可重送。',409,'WRITE_VERIFY_FAILED');
      return json({ ok: true, updatedRange }, 200, origin);
    }
    throw new HttpError("Unknown action.", 400, "ACTION_UNKNOWN");
  } catch (e) {
    if(custody&&beganWrite){try{await custody.quarantine()}catch{}}
    const busy=String(e?.message||'').includes('RECORD_BUSY');
    const err = e instanceof HttpError ? e : busy?new HttpError('這筆資料正由其他操作處理，尚未保存；輸入保留，可稍後再試。',409,'RECORD_BUSY'):new HttpError("Unexpected error.", 500, "INTERNAL");
    return json({ error: { code: err.code, message: err.message, details: err.details } }, err.status, origin);
  } finally {
    if(custody&&beganWrite){try{await custody.finish(retainKeys)}catch{ /* Durable WRITING remains quarantined; never guess unlock. */ }}
  }
});

function corsHeaders(origin: string) {
  return {
    "access-control-allow-origin": origin || DEFAULT_ORIGIN,
    "access-control-allow-headers": "authorization,content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS"
  };
}
function json(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", ...corsHeaders(origin) }
  });
}
