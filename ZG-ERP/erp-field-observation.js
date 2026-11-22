(function(t) {
    "use strict";
    const e = t => String(t ?? "").replace(/[&<>"']/g, t => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[t]));
    function a({store: a, context: s, drafts: r, account: n, render: o, recover: i, recoverShared: joinShared}) {
        let l = null, c = false, d = "", u = [], f = n();
        const p = () => {
            if (f !== n()) {
                f = n();
                l = null;
                d = "";
                u = [];
            }
        };
        function epochAt(target,zone){if(!target)return '';const states=t.ErpPositionInputCore?.reduceInputs(a.seatRows||[]).current,site=target.site||t.ErpSeatCore?.reduce(a.seatRows||[]).maps.find(m=>m.id===target.map&&m.zone===zone)?.site;return states?[...states.values()].find(v=>v.start[2]===target.map&&(!site||v.start[3]===site)&&v.start[4]===zone&&Number(v.start[5])===Number(target.seat))?.epoch||'':'';}
        const allDrafts=()=>r?r.list(n(),"field-observation"):[];
        const b = () => allDrafts().filter(entry=>{const v=entry.payload.values;return (v.inputEpoch||'')===epochAt(v.seatTarget,v.zone)});
        const visibleRows=()=>u.filter(row=>(row[15]||'')===epochAt({map:row[4],seat:Number(row[5])},row[3]));
        const g = () => {
            if (!l || !r) return false;
            if (l.autoCapture === true) return true;
            const t = r.put(n(), "field-observation", l.observationId, {
                values: {
                    ...l
                },
                base: {}
            });
            return !!t.saved;
        };
        function m() {
            p();
            if (c) return;
            if (l && !g()) {
                d = "無法保留目前這台草稿，先不要新增。";
                o();
                return;
            }
            try {
                const t = s();
                if (!t?.sessionId || !t.seatTarget) throw Error("請先開始場次並選座位。");
                if(t.seatTarget.inventoryReview)throw Error("正在核對差異，請先返回繼續掃描，沒有送出。");
                if(t.seatTarget.inventoryClosed)throw Error("此座位已定案，請先明確開新一輪，沒有送出。");
                if(t.seatTarget.inventoryRequired)throw Error("請先開始此座位盤點或接續既有未定案紀錄。");
                l = {
                    observationId: crypto.randomUUID(),
                    inputEpoch:t.seatTarget.inputEpoch||"",
                    sessionId: t.sessionId,
                    zone: t.zone,
                    seatTarget: JSON.parse(JSON.stringify(t.seatTarget)),
                    labelStatus: "沒有QR",
                    scanRaw: "",
                    serial: "",
                    model: "",
                    note: "",
                    capturedAt: (new Date).toISOString(),
                    state: "draft",
                    localAccount: n()
                };
                if (!g()) throw Error("這台裝置無法保留觀察草稿，尚未送出。");
                d = "";
            } catch (t) {
                d = t.message;
            }
            o();
        }
        async function h() {
            p();
            if (!l || c || l.autoCapture === true || l.state === "uncertain") return;
            c = true;
            d = "";
            const t = JSON.parse(JSON.stringify(l));
            const e = n();
            let r = false;
            l.state = "sending";
            if (!g()) {
                l.state = "draft";
                c = false;
                d = "無法保留草稿，沒有送出。";
                o();
                return;
            }
            o();
            try {
                const o = s();
                if (o?.sessionId !== t.sessionId) throw Error("目前場次與原觀察不同，未送出，原草稿保留。");
                await o.sessionWrite;
                if (n() !== e) throw Error("帳號已切換，沒有送出。");
                if (o.sessionUnsynced?.()) throw Error("場次尚未確認保存，未送出。");
                r = true;
                const i = await a._fetchAuth(a._url("field-observation", "現場觀察"), {
                    method: "POST",
                    headers: a._authHeaders({
                        "content-type": "application/json"
                    }),
                    body: JSON.stringify(t)
                });
                const l = await i.json();
                if (!i.ok || l.ok !== true) throw Object.assign(Error(l.error?.message || "觀察保存尚未確認。"), {
                    legacyRejected: i.status === 409 && l.error?.code === "JOIN_CURRENT_SHARED_ROUND"
                });
                if (n() !== e) throw Error("帳號已切換，請回原帳號查保存結果。");
                if (l.duplicate) acceptDuplicate(l.row, t); else y(l.row, t, l.warnings);
            } catch (t) {
                if (n() !== e) return;
                if (l) {
                    l.state = t.legacyRejected ? "draft" : r ? "uncertain" : "draft";
                    if (t.legacyRejected) l.rejectedLegacy = true;
                    g();
                }
                d = (r ? "尚未確認保存，原座位與觀察鍵已保留。請查保存結果，不要重新新增同一台。 " : "尚未送出，可修正後再保存；原座位與觀察鍵已保留。 ") + t.message;
            } finally {
                c = false;
                o();
            }
        }
        function y(t, e, a) {
            if ((t?.[15]||'')!==(e.inputEpoch||'') || !Array.isArray(t) || t.length < 15 || t[11] !== e.capturedAt || !Number.isFinite(Date.parse(t[12])) || !t[13] || t[14] !== "待核實" || t[0] !== e.observationId || t[1] !== e.sessionId || t[3] !== e.zone || t[4] !== e.seatTarget.map || Number(t[5]) !== e.seatTarget.seat || t[6] !== e.labelStatus || t[7] !== e.scanRaw || [ 8, 9, 10 ].some(a => String(t[a] ?? "") !== String(e[[ "serial", "model", "note" ][a - 8]] || "").trim())) throw Error("保存回讀內容與原觀察不同，保留原草稿。");
            r.discard(n(), "field-observation", e.observationId);
            u = u.filter(e => e[0] !== t[0]);
            u.unshift(t);
            if (l?.observationId === e.observationId) l = null;
            d = "已保存原座位的現場觀察，待核實，不算舊帳已盤。" + (a?.length ? " " + a.join(" ") : "");
        }
        function acceptDuplicate(row, input) {
            if ((row?.[15]||'')!==(input.inputEpoch||'') || !Array.isArray(row) || row.length < 15 || !row[0] || (row[1] !== input.sessionId && !(input.inputEpoch&&a.seatRows?.some(r=>r[0]===input.inputEpoch&&r[1]==='inventory-open'))) || row[6] !== "有QR" || row[7] !== input.scanRaw || !Number.isFinite(Date.parse(row[12])) || !row[13] || row[14] !== "待核實") throw Error("重複觀察回讀不符，保留原草稿");
            r.discard(n(), "field-observation", input.observationId);
            u = u.filter(x => x[0] !== row[0]);
            u.unshift(row);
            if (l?.observationId === input.observationId) l = null;
            d = "這台已在本次場次記錄於 " + row[3] + " " + row[5] + "號，不新增、不加台數，也不改原位置。";
            o();
        }
        async function w(t) {
            p();
            if (c) return;
            const e = b().find(e => e.entity === t);
            if (!e || e.payload.values.autoCapture && e.payload.values.localAccount !== n()) return;
            const s = n();
            c = true;
            o();
            try {
                const r = e.payload.values;
                const o = a._url("observation-status", "現場觀察") + "&observationId=" + encodeURIComponent(t) + "&inputEpoch="+encodeURIComponent(r.inputEpoch||'')+"&sessionId=" + encodeURIComponent(r.sessionId) + "&scanRaw=" + encodeURIComponent(r.labelStatus === "有QR" ? r.scanRaw : "");
                const i = await a._fetchAuth(o, {
                    method: "GET",
                    headers: a._authHeaders()
                });
                const l = await i.json();
                if (!i.ok || l.ok !== true) throw Error(l.error?.message || "尚未查到保存結果。");
                if (n() !== s) return;
                if (l.found) {
                    if (l.duplicate) acceptDuplicate(l.row, r); else y(l.row, r, []);
                } else d = "目前尚未查到這筆觀察；草稿與原座位保留，不代表可以盲目重送。";
            } catch (t) {
                if (n() === s) d = t.message;
            } finally {
                c = false;
                o();
            }
        }
        function v(t) {
            p();
            if (c) return;
            const e = b().find(e => e.entity === t);
            if (!e) return;
            if (l && !g()) {
                d = "目前草稿無法保留。";
                o();
                return;
            }
            try {
                const t = JSON.parse(JSON.stringify(e.payload.values));
                if (t.autoCapture === true) {
                    if (i) i(copy(t));
                    if(t.state==="blocked"){d=t.lastError;o();return}
                    l = null;
                    d = "這筆掃描已接回原場次與位置，由保存佇列接續；結果未知時只查不重送，可以繼續其他設備。";
                    scheduleQueue();
                    o();
                    return;
                }
                if (i) i(t);
                l = t;
            } catch (t) {
                d = t.message;
                o();
                return;
            }
            if (l.state === "sending") l.state = "uncertain";
            d = "已還原原座位草稿，不會自動送出。";
            o();
        }
        async function migrateRejected(id) {
            p();
            if (c || !joinShared) return;
            const entry = b().find(x => x.entity === id), old = entry?.payload?.values;
            if (!old || old.state !== "draft" || old.rejectedLegacy !== true) return;
            if (l && l.observationId !== id && !g()) {
                d = "目前草稿無法保留，未轉輪";
                o();
                return;
            }
            c = true;
            const who = n();
            o();
            try {
                const response = await a._fetchAuth(a._url("observation-status", "現場觀察") + "&observationId=" + encodeURIComponent(id), {
                    method: "GET",
                    headers: a._authHeaders()
                }), body = await response.json();
                if (!response.ok || body.ok !== true || body.found !== false) throw Error("原觀察可能已保存，請先查保存結果，不轉移");
                if (n() !== who) throw Error("帳號已切換，保留原稿");
                const current = await joinShared(JSON.parse(JSON.stringify(old)));
                if (n() !== who || !current?.sessionId || current.zone !== old.zone || current.seatTarget?.map !== old.seatTarget.map || current.seatTarget?.seat !== old.seatTarget.seat) throw Error("原位置核對不符，保留原稿");
                const next = {
                    ...old,
                    originalSessionId: old.originalSessionId || old.sessionId,
                    sessionId: current.sessionId,
                    state: "draft",
                    autoCapture: false,
                    rejectedLegacy: false
                };
                if (!r.put(who, "field-observation", id, {
                    values: next,
                    base: {}
                }).saved) throw Error("新輪草稿無法保留，原稿保留");
                l = next;
                d = "已接到目前共同盤點，原位置與內容不變；尚未送出，請核對後保存。";
            } catch (error) {
                d = error.message;
            } finally {
                c = false;
                o();
            }
        }
        function canContinueDraft(v){let ctx;try{ctx=s()}catch{}return !!(v.inputEpoch&&ctx?.seatTarget?.inputEpoch===v.inputEpoch&&ctx.sessionId&&ctx.sessionId!==v.sessionId&&ctx.zone===v.zone&&ctx.seatTarget.map===v.seatTarget?.map&&ctx.seatTarget.seat===v.seatTarget?.seat&&(["queued","draft"].includes(v.state)||v.state==="blocked"&&v.precheckUnsent===true));}
        async function continueDraft(id){
            p();if(c)return;const old=b().find(x=>x.entity===id)?.payload.values;if(!old||!canContinueDraft(old))return;
            c=true;const who=n();o();try{
                const sessions=await a._readFull("盤點場次"),before=s(),original=sessions.rows.filter(x=>x[0]===old.sessionId),active=sessions.rows.filter(x=>x[0]===before.sessionId);
                if(original.length!==1||original[0][10]!=="已結束"||active.length!==1||active[0][10]!=="進行中"||active[0][13]!=="erp-shared-round-v1"||original[0][1]!==active[0][1])throw Error("原共同盤點尚未確認結束，原草稿保留，不跨輪送出。");
                const response=await a._fetchAuth(a._url("observation-status","現場觀察")+"&observationId="+encodeURIComponent(id)+"&inputEpoch="+encodeURIComponent(old.inputEpoch)+"&sessionId="+encodeURIComponent(old.sessionId),{method:"GET",headers:a._authHeaders()}),body=await response.json();
                if(n()!==who||!canContinueDraft(old)||s().sessionId!==before.sessionId)throw Error("帳號或位置已切換，保留原稿。");
                if(!response.ok||body.ok!==true||body.found!==false)throw Error("原觀察可能已保存，請先查保存結果，未接續草稿。");
                const latest=b().find(x=>x.entity===id)?.payload.values;
                if(!latest||JSON.stringify(latest)!==JSON.stringify(old))throw Error("原草稿已在其他頁面變更，保留最新內容，不覆寫。");
                const next={...copy(old),originalSessionId:old.originalSessionId||old.sessionId,sessionId:before.sessionId,state:"draft",autoCapture:false,rejectedLegacy:false};
                if(!r.put(who,"field-observation",id,{values:next,base:{}}).saved)throw Error("本機保存失敗，原稿保留。");
                l=next;d="已將確定未送出的原稿接到目前共同盤點，原位置與觀察鍵不變；尚未送出，請核對後保存。";
            }catch(error){if(n()===who)d=error.message}finally{c=false;o()}
        }
        function I(t, e) {
            p();
            if (!l || c || l.autoCapture === true || l.state === "uncertain" || ![ "serial", "model", "note" ].includes(t)) return;
            l[t] = String(e);
            if (!g()) d = "本機草稿保留失敗，請勿離開頁面。";
        }
        function pendingRow(entry){
            const v=entry.payload.values,blocked=v.state==="blocked"&&v.precheckUnsent===true;
            const label=v.state==="blocked"&&!blocked?"結果待查，勿重送":{queued:"已留本機，等待自動保存",draft:"未送出草稿",blocked:"確定未送出，需處理",sending:"送出中，待查",uncertain:"結果待查，勿重送"}[v.state]||"待查，勿重送";
            return '<div class="small" style="margin:10px 0"><p style="margin:0 0 6px;overflow-wrap:anywhere">座位 '+e(v.seatTarget?.seat)+' · '+e(v.scanRaw||"沒有QR")+' · 場次 '+e(v.sessionId)+' · '+e(blocked?v.lastError||label:label)+'</p><div style="display:flex;flex-wrap:wrap;gap:6px">'+(!blocked?'<button class="pill sm" data-observation-action="status" data-observation-id="'+e(entry.entity)+'"'+(c?' disabled':'')+'>查保存結果</button>':'')+'<button class="pill sm" data-observation-action="resume" data-observation-id="'+e(entry.entity)+'"'+(c?' disabled':'')+'>開啟原草稿</button>'+(blocked&&v.precheckUnsent?'<button class="pill sm" data-observation-action="retry-precheck" data-observation-id="'+e(entry.entity)+'">修復讀取後接續這筆</button>':'')+(canContinueDraft(v)?'<button class="pill sm" data-observation-action="continue-round" data-observation-id="'+e(entry.entity)+'">接續原未送草稿到目前共同盤點（不送出）</button>':'')+(v.rejectedLegacy===true&&v.state==="draft"?'<button class="pill sm" data-observation-action="migrate" data-observation-id="'+e(entry.entity)+'">以原位置接到目前共同盤點（不送出）</button>':'')+'</div></div>';
        }
        function S(t = false) {
            p();
            const a = b();
            if (t && !a.length) return "";
            return '<section class="card field-observation">' + (t ? '<b>現場觀察草稿接續</b><p class="small">先開啟原草稿，接回原場次與座位；不自動送出。也可直接查保存結果。</p>' : '<button class="pill" data-observation-action="new"' + (c ? " disabled" : "") + '>沒有QR，記錄這台設備</button><p class="small">只記目前座位有一台設備，不用先配舊帳。每按一次新增代表另一台設備。</p>') + (d && !a.some(entry=>entry.payload.values.state==="blocked"&&entry.payload.values.precheckUnsent===true&&entry.payload.values.lastError===d) ? '<p class="warn" role="status">' + e(d) + "</p>" : "") + (l ? "<div><b>原座位 " + e(l.seatTarget.seat) + "號 · " + e(l.labelStatus) + (l.scanRaw ? " · " + e(l.scanRaw) : "") + '</b><p class="small">本筆位置固定，換座位不會移動這筆。序號、型號、備註都可留白。</p>' + [ "serial", "model", "note" ].map((t, a) => '<label class="lbl" style="display:block;margin:10px 0">' + [ "序號（選填）", "型號（選填）", "備註（選填）" ][a] + '<input class="inp" style="display:block;box-sizing:border-box;width:100%;margin-top:4px" data-observation-field="' + t + '" maxlength="' + (t === "note" ? 2e3 : 200) + '" value="' + e(l[t]) + '"' + (c || l.state === "uncertain" ? " disabled" : "") + "></label>").join("") + '<button class="pill em" data-observation-action="save"' + (c || l.state === "uncertain" ? " disabled" : "") + ">" + (c ? "正在保存" : "保存這台設備觀察") + "</button></div>" : "") + (a.length ? "<details open><summary>現場觀察待確認 " + a.length + "筆</summary>" + a.map(pendingRow).join("") + "</details>" : "") + (u.length ? '<p class="small">已核實讀回 ' + u.length + "筆現場觀察。</p>" : "") + "</section>";
        }
        let T = false, E = "", R = "";
        async function O() {
            scheduleQueue();
            p();
            if (T || !n() || typeof a._readFull !== "function") return;
            const t = n();
            T = true;
            try {
                const e = await a._readFull("現場觀察");
                if (n() !== t) return;
                if (!Array.isArray(e.rows) || e.rows.some(t => !Array.isArray(t) || t.length < 15)) throw Error("現場觀察讀取內容不完整");
                const s = new Map(e.rows.map(t => [ t[0], t ]));
                for (const t of visibleRows()) if (!s.has(t[0])) s.set(t[0], t);
                u = [ ...s.values() ];
                R = t;
                E = "";
            } catch (e) {
                if (n() === t) E = e.message;
            } finally {
                T = false;
                o();
            }
        }
        function A(t) {
            return visibleRows().filter(e => (t?.seatTarget?.inputEpoch ? e[15] === t.seatTarget.inputEpoch : e[1] === t?.sessionId) && e[4] === t?.seatTarget?.map && Number(e[5]) === t?.seatTarget?.seat);
        }
        function N(t = false) {
            p();
            if (!queueRunning && queueTimer === null && b().some(entry => entry.payload.values.autoCapture === true && !entry.payload.values.rejectedLegacy && entry.payload.values.state !== "blocked")) scheduleQueue();
            let a;
            try {
                a = s();
            } catch {}
            const r = t ? visibleRows().filter(t => t[1] === a?.sessionId) : A(a), n = b();
            const archived=allDrafts().filter(entry=>!b().some(active=>active.entity===entry.entity));const archiveHtml=archived.length?'<details class="card"><summary>先前輪次本機保留 '+archived.length+' 筆（不計入本輪、不重送）</summary>'+archived.map(entry=>{const v=entry.payload.values;return '<p class="small">'+e(v.seatTarget?.seat)+'號 · '+e(v.scanRaw||'沒有QR')+' · '+e(v.state==='queued'||v.state==='draft'?'尚未送出，已留原稿':'保存結果待查，保留原鍵')+'</p>'}).join('')+'</details>':'';return archiveHtml+'<section class="card"><b>' + (t ? "本次場次現場記錄 " : "原座位現場記錄 ") + r.length + '台</b><p class="small">掃碼先記在掃描當下的座位，舊帳核對留待後續。只有伺服器回讀一致才列為已保存。</p><button class="pill sm" data-observation-action="refresh"' + (T ? " disabled" : "") + ">" + (T ? "正在讀取" : "重新讀取現場記錄") + "</button>" + (E ? '<p class="warn">' + e(E) + "</p>" : "") + r.map(t => '<div class="small" style="overflow-wrap:anywhere">已保存 · ' + e(t[5]) + "號 · " + e(t[7] || "沒有QR") + " · " + e(t[14]) + "</div>").join("") + n.filter(t => t.payload.values.labelStatus === "有QR" && (t.payload.values.state !== "blocked"||t.payload.values.precheckUnsent!==true)).map(t => {
                const a = t.payload.values;
                return '<p class="warn" style="overflow-wrap:anywhere">' + e(a.scanRaw) + " · 原座位 " + e(a.seatTarget?.seat) + "號 · " + e(a.state === "queued" ? "已留本機，等待自動保存；可繼續掃下一台" : a.state === "draft" ? "本機保留，尚未送出" : a.state === "sending" ? "正在保存，尚未確認" : a.state === "blocked" && a.precheckUnsent === true ? a.lastError : "保存結果待查，原觀察鍵保留，不重送") + (a.state === "queued" && a.lastError ? " · " + e(a.lastError) : "") + "</p>";
            }).join("") + "</section>";
        }
        function j(t) {
            p();
            const a = visibleRows().filter(e => e[4] === t.map && Number(e[5]) === t.seat);
            return '<section class="card"><b>此位置已保存的現場觀察 ' + a.length + '筆</b><p class="small">與既有設備分開列出，待後續核實，不自動搬動既有設備。</p>' + a.map(t => '<div class="small" style="overflow-wrap:anywhere">' + e(t[7] || "沒有QR") + " · " + e(t[9] || "型號待核實") + " · " + e(t[14]) + "</div>").join("") + "</section>";
        }
        let queueTimer = null, queueRunning = false;
        const copy = value => JSON.parse(JSON.stringify(value));
        const persistCapture = (who, value) => !!r?.put(who, "field-observation", value.observationId, {values:copy(value),base:{}})?.saved;
        function scheduleQueue(delay = 0) {
            if (queueTimer !== null) clearTimeout(queueTimer);
            queueTimer = setTimeout(() => { queueTimer = null; void drainQueue(); }, delay);
        }
        async function lookupCapture(value, who) {
            const url = a._url("observation-status", "現場觀察") + "&observationId=" + encodeURIComponent(value.observationId) + "&inputEpoch="+encodeURIComponent(value.inputEpoch||'')+"&sessionId=" + encodeURIComponent(value.sessionId) + "&scanRaw=" + encodeURIComponent(value.scanRaw);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(),15000);
            let response, body;
            try {
                response = await a._fetchAuth(url, {method:"GET",headers:a._authHeaders(),signal:controller.signal}, () => n() === who);
                body = await response.json();
            } finally { clearTimeout(timeout); }
            if (!response.ok || body.ok !== true) throw Error(body.error?.message || "保存結果待查");
            if (n() !== who) return false;
            if (body.found) {
                if (body.duplicate) acceptDuplicate(body.row, value); else y(body.row, value, []);
                return true;
            }
            return false;
        }
        function restoreAutomaticContext(who) {
            let current;
            try { current = s(); } catch {}
            if (current?.sessionId) return true;
            const pending = b().map(entry => entry.payload.values).filter(value => value.autoCapture === true && ["queued","sending","uncertain"].includes(value.state) && !value.rejectedLegacy);
            if (!pending.length) return true;
            if (pending.some(value => value.localAccount !== who)) { d = "原觀察帳號不符，已保留原內容，沒有自動送出或切換位置。"; return false; }
            const contexts = new Set(pending.map(value => JSON.stringify([value.sessionId,value.zone,value.seatTarget?.map,value.seatTarget?.seat])));
            if (contexts.size !== 1 || typeof i !== "function") { d = "原觀察有多個場次或位置，無法唯一確認自動接續；原內容保留，不重掃、不清除、不盲目重送。"; return false; }
            try {
                i(copy(pending[0]));
                const restored = s();
                if (n() !== who || restored?.sessionId !== pending[0].sessionId || restored.zone !== pending[0].zone || restored.seatTarget?.map !== pending[0].seatTarget.map || restored.seatTarget?.seat !== pending[0].seatTarget.seat) throw Error("原場次或位置無法一致核對");
                d = "已自動接回原場次與位置，未送出筆接續保存，結果未知筆只查不重送；可繼續其他設備。";
                o();
                return true;
            } catch (error) { d = "無法自動接續：" + error.message + " 原觀察保留，沒有重送。"; return false; }
        }
        async function drainQueue() {
            if (queueRunning) return;
            const who = n();
            if (!who) return;
            if (!restoreAutomaticContext(who)) { o(); return; }
            if (typeof t.navigator?.locks?.request !== "function") {
                d = "這個瀏覽器無法安全協調保存，掃描已留本機但沒有送出；仍可繼續記錄。";
                o();
                return;
            }
            queueRunning = true;
            try {
                await t.navigator.locks.request("erp-field-capture:" + who, {mode:"exclusive",ifAvailable:true}, async lock => {
                    if (!lock) { scheduleQueue(1000); return; }
                    if (n() === who) await drainOwnedQueue();
                });
            } finally { queueRunning = false; }
        }
        async function drainOwnedQueue() {
            let again = false;
            try {
                p();
                const who = n();
                if (!who) return;
                const entries = b().filter(entry => entry.payload.values.autoCapture === true)
                    .sort((left,right) => Number(right.payload.values.state === "queued") - Number(left.payload.values.state === "queued"));
                for (const entry of entries) {
                    if (n() !== who) break;
                    const value = copy(entry.payload.values);
                    if (value.localAccount !== who || value.rejectedLegacy || value.state === "blocked") continue;
                    let ctx;
                    try { ctx = s(); } catch {}
                    if (!ctx?.sessionId || ctx.sessionId !== value.sessionId) { d = "目前場次與原觀察不同，沒有切換或跨場次送出；原內容保留，結果未知筆不重送。"; again = true; continue; }
                    if ((value.nextAttemptAt || 0) > Date.now()) { again = true; continue; }
                    // A reload of a POST in flight is unknown, never a fresh send.
                    if (value.state === "sending" || value.state === "uncertain") {
                        value.state = "uncertain";
                        if (!persistCapture(who,value)) { d = "本機保存失敗，沒有重送；請保留此頁。"; continue; }
                        try { if (await lookupCapture(value,who)) continue; }
                        catch (error) { if (n() === who) d = error.message; }
                        if (n() === who) {
                            value.nextAttemptAt = Date.now() + 30000;
                            persistCapture(who,value);
                            o();
                            again = true;
                        }
                        continue;
                    }
                    if (value.state !== "queued") continue;
                    let attempted = false;
                    try {
                        await ctx.sessionWrite;
                        if (n() !== who) break;
                        let current;
                        try { current = s(); } catch {}
                        if (!current || current.sessionId !== value.sessionId) { again = true; continue; }
                        const latest = b().find(item => item.entity === value.observationId)?.payload?.values;
                        if (!latest || latest.state !== "queued" || latest.localAccount !== who) continue;
                        if (ctx.sessionUnsynced?.() || current.sessionUnsynced?.()) { again = true; continue; }
                        value.state = "sending";
                        delete value.precheckUnsent;
                        if (!persistCapture(who,value)) { d = "本機無法保留，沒有送出；可繼續其他筆。"; continue; }
                        o();
                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(),30000);
                        let response, body;
                        try {
                            attempted = true;
                            response = await a._fetchAuth(a._url("field-observation","現場觀察"), {method:"POST",headers:a._authHeaders({"content-type":"application/json"}),signal:controller.signal,body:JSON.stringify(value)}, () => n() === who);
                            body = await response.json();
                        } finally { clearTimeout(timeout); }
                        if (n() !== who) break;
                        if (response.ok && body.ok === true) {
                            if (body.duplicate) acceptDuplicate(body.row,value); else y(body.row,value,body.warnings);
                            continue;
                        }
                        if (((response.status === 409 && body.error?.code === "RECORD_BUSY") || (response.status === 503 && body.error?.code === "OBSERVATION_PRECHECK_UNAVAILABLE")) && body.error?.details?.observationWriteState === "not-started") {
                            const precheck = body.error.code === "OBSERVATION_PRECHECK_UNAVAILABLE";
                            if(precheck && (value.precheckAttempts = (value.precheckAttempts || 0) + 1) >= 5){
                                value.state="blocked";value.precheckUnsent=true;
                                value.lastError="保存前讀取連續失敗5次，確定未送出；原鍵與位置保留，暫停自動重試。";
                                persistCapture(who,value);d=value.lastError;continue;
                            }
                            value.state = "queued";
                            value.queueAttempts = Math.min((value.queueAttempts || 0) + 1, 6);
                            value.nextAttemptAt = Date.now() + (precheck?[5000,15000,30000,60000][value.precheckAttempts-1]:Math.min(30000,1000 * 2 ** (value.queueAttempts - 1)));
                            value.lastError = body.error.code === "OBSERVATION_PRECHECK_UNAVAILABLE" ? "保存前讀取暫時失敗，這筆確定未送出；原觀察與座位保留，稍後自動接續，不用重掃。" : "本輪保存受前筆佔用影響，可能仍有前筆待查；這筆已留本機但尚未保存，不用重掃，也不要清除或重送。";
                            d = value.lastError;
                            persistCapture(who,value);
                            again = true;
                            continue;
                        }
                        if (response.status === 503 && body.error?.code === "OBSERVATION_PRECHECK_BLOCKED" && body.error?.details?.observationWriteState === "not-started") {
                            value.state = "blocked";
                            value.precheckUnsent = true;
                            value.lastError = "確定未送出，請先修復讀取條件；原鍵與位置保留，不自動重試。";
                            persistCapture(who,value);
                            d = value.lastError;
                            continue;
                        }
                        if (response.status === 409 && body.error?.code === "JOIN_CURRENT_SHARED_ROUND") {
                            value.state = "draft";
                            value.rejectedLegacy = true;
                            value.lastError = "原輪已結束，這筆未保存，原位置保留";
                            persistCapture(who,value);
                            continue;
                        }
                        throw Error(body.error?.message || "保存結果尚未確認");
                    } catch (error) {
                        if (n() !== who) break;
                        value.state = attempted ? "uncertain" : "queued";
                        value.lastError = error.message;
                        value.nextAttemptAt = Date.now() + 30000;
                        persistCapture(who,value);
                        d = error.message + "。原觀察與座位保留，可以繼續掃其他設備。";
                        again = true;
                    } finally { if (n() === who) o(); }
                }
            } finally {
                if (again || b().some(entry => entry.payload.values.autoCapture === true && ["queued","sending","uncertain"].includes(entry.payload.values.state))) scheduleQueue(1000);
            }
        }
        function duplicateAt(raw,override){let ctx;try{ctx=s()}catch{}const sessionId=override?.sessionId||ctx?.sessionId,target=override?.seatTarget||ctx?.seatTarget,epoch=target?.inputEpoch||'';return b().some(({payload:{values:v}})=>v.sessionId===sessionId&&v.seatTarget?.map===target?.map&&v.seatTarget?.seat===target?.seat&&(v.inputEpoch||'')===epoch&&v.labelStatus==='有QR'&&v.scanRaw===raw)||visibleRows().some(row=>(epoch?row[15]===epoch:row[1]===sessionId)&&row[4]===target?.map&&Number(row[5])===target?.seat&&(row[15]||'')===epoch&&row[6]==='有QR'&&row[7]===raw);}
        function _(raw, override) {
            p();
            const ctx = s(), who = n();
            const sessionId = override?.sessionId || ctx.sessionId;
            const target = override?.seatTarget || ctx.seatTarget;
            if (!sessionId || !target?.map || !Number.isInteger(target.seat)) throw Error("請先選擇原場次與已保存座位，沒有送出。");
            if(ctx.seatTarget?.inventoryReview||target.inventoryReview)throw Error("正在核對差異，請先返回繼續掃描，沒有送出。");
            if(ctx.seatTarget?.inventoryClosed||target.inventoryClosed)throw Error("此座位已定案，請先明確開新一輪，沒有送出。");
            if(ctx.seatTarget?.inventoryRequired||target.inventoryRequired)throw Error("請先開始此座位盤點或接續既有未定案紀錄，沒有送出。");
            if (!who) throw Error("登入身份尚未確認，未送出。");
            const saved=visibleRows().find(row=>(target.inputEpoch?row[15]===target.inputEpoch:row[1]===sessionId)&&row[4]===target.map&&Number(row[5])===target.seat&&(row[15]||'')===(target.inputEpoch||'')&&row[6]==='有QR'&&row[7]===String(raw));if(saved){d='這台已掃過，不重複新增。保存狀態另外顯示。';o();return saved[0];}
            const value = {observationId:crypto.randomUUID(),inputEpoch:target.inputEpoch||"",sessionId,zone:override?.zone || ctx.zone,seatTarget:copy(target),labelStatus:"有QR",scanRaw:String(raw),serial:"",model:"",note:"",capturedAt:new Date().toISOString(),state:"queued",localAccount:who,autoCapture:true};
            const prior = b().find(entry => {const v=entry.payload.values;return v.labelStatus === "有QR" && (v.inputEpoch||'')===(value.inputEpoch||'') && v.seatTarget?.map===target.map && v.seatTarget?.seat===target.seat && v.sessionId === sessionId && v.scanRaw === value.scanRaw;});
            if (prior) {
                d = "這筆原觀察已在本機保留，不重複新增；可以繼續掃其他設備。";
                scheduleQueue(); o(); return prior.entity;
            }
            if (!persistCapture(who,value)) throw Error("本機無法保留原座位與觀察鍵，沒有送出；請保留此頁。");
            d = "已辨識並留在本機，正在接續保存；可繼續掃下一台。";
            scheduleQueue();
            o();
            return value.observationId;
        }
        const repairInFlight=new Set();
        async function retryPrecheck(id){
            const key=n()+":"+id;
            if(repairInFlight.has(key))return;
            if(typeof t.navigator?.locks?.request!=="function"){d="此瀏覽器不支援安全接續。原稿未送，請更新目前瀏覽器後在同一裝置重開原頁，勿換瀏覽器、清資料或另建一筆。";o();return}
            repairInFlight.add(key);
            try{await t.navigator.locks.request("erp-field-repair:"+key,{mode:"exclusive",ifAvailable:true},async lock=>{if(lock)await retryPrecheckOwned(id);else{d="另一分頁正在接續，請回該頁查看；本頁未重送。";o()}})}finally{repairInFlight.delete(key)}
        }
        async function retryPrecheckOwned(id) {
            p();const who=n(),value=b().find(entry=>entry.entity===id)?.payload.values;
            if(!value||value.state!=="blocked"||value.precheckUnsent!==true||value.localAccount!==who)return;
            const matches=()=>{let current;try{current=s()}catch{}return n()===who&&current?.sessionId===value.sessionId&&current.zone===value.zone&&current.seatTarget?.map===value.seatTarget.map&&current.seatTarget?.seat===value.seatTarget.seat};
            try{
                if(!matches())throw Error("原帳號、場次或位置未接回，沒有送出。");
                if((value.precheckResumeAfter||0)>Date.now())throw Error("接續查核請間隔30秒，沒有送出。");
                value.precheckResumeAfter=Date.now()+30000;
                if(!persistCapture(who,value))throw Error("無法保留接續時間，沒有送出。");
                const [sessions,seats]=await Promise.all([a._readFull("盤點場次"),a._readFull("座位圖")]);
                const active=sessions.rows.filter(row=>row[0]===value.sessionId&&row[10]==="進行中"&&row[13]==="erp-shared-round-v1");
                const maps=t.ErpSeatCore.reduce(seats.rows).maps;
                if(active.length!==1||!maps.some(map=>map.id===value.seatTarget.map&&map.site===active[0][1]&&map.zone===value.zone&&map.seats.some(seat=>seat.number===value.seatTarget.seat)))throw Error("原場次已結束或原座位無法核實，沒有送出。");
                const latest=b().find(entry=>entry.entity===id)?.payload.values;
                if(!matches()||latest?.state!=="blocked"||latest.precheckUnsent!==true)return;
                value.state="queued";value.nextAttemptAt=0;value.precheckAttempts=0;
                if(persistCapture(who,value)){scheduleQueue();o()}
            }catch(error){if(n()===who){d=error.message+" 原鍵與草稿保留。";o()}}
        }
        const observationHeader = [ "觀察鍵", "場次鍵", "據點", "區域", "圖版本", "座位編號", "標籤狀態", "掃碼原文", "設備序號", "型號", "備註", "掃描時間", "保存時間", "經手人", "核對狀態" ];
        async function stageObservations() {
            p();
            const who = n();
            if (!who || c || T || l || b().length) throw Error("現場觀察尚有本機操作，資料更新已延後");
            const result = await a._readFull("現場觀察");
            if (!Array.isArray(result.header) || observationHeader.some((h, i) => result.header[i] !== h) || !Array.isArray(result.rows) || result.rows.some(row => !Array.isArray(row) || row.length < 15 || !row[0]) || new Set(result.rows.map(row => row[0])).size !== result.rows.length) throw Error("現場觀察資料不完整，保留原畫面");
            return {
                owner: observationOwner,
                who: who,
                rows: result.rows.map(row => row.slice())
            };
        }
        const observationOwner = {};
        function canCommitObservations(snapshot) {
            return snapshot?.owner === observationOwner && snapshot.who === n() && !c && !T && !l && !b().length;
        }
        function commitObservations(snapshot) {
            if (!canCommitObservations(snapshot)) throw Error("現場觀察更新期間有本機操作，保留原畫面");
            u = snapshot.rows;
            R = snapshot.who;
            E = "";
        }
        return {
            savedStamp:target=>visibleRows().filter(r=>r[4]===target.map&&Number(r[5])===Number(target.seat)).map(r=>r[0]).sort().join('|'),
            positionReset:()=>{l=null;d="";},
            html: S,
            field: I,
            capture: _,
            isDuplicate:duplicateAt,
            scanHtml: N,
            locationHtml: j,
            load: O,
            hasPending: () => c || b().length > 0,
            needsReadback: () => c || b().some(({payload:{values:v}})=>!["draft","queued"].includes(v.state)&&!(v.state==="blocked"&&v.precheckUnsent===true)),
            recent: () => {p();let t;try{t=s()}catch{}return [...A(t).map(r=>({raw:r[7]||'沒有QR',at:r[11],state:'已讀回保存'})),...b().flatMap(({payload:{values:v}})=>v.sessionId===t?.sessionId&&v.seatTarget?.map===t?.seatTarget?.map&&v.seatTarget?.seat===t?.seatTarget?.seat?[{raw:v.scanRaw||'沒有QR',at:v.capturedAt,state:v.state==='blocked'&&v.precheckUnsent!==true?'結果待查，勿重送':{queued:'本機等待保存',sending:'保存中',uncertain:'結果待查，勿重送',draft:'未送出',blocked:'確定未送出，需修復讀取'}[v.state]||'待查'}]:[])].sort((a,b)=>String(b.at).localeCompare(String(a.at)))[0]},
            progress: () => {p();let t;try{t=s()}catch{}const values=b().map(entry=>entry.payload.values),blocked=values.filter(v=>v.state==="blocked"&&v.precheckUnsent===true).length,queued=values.filter(v=>v.state==="queued"||v.state==="draft").length,unknown=values.length-blocked-queued;return "本位已讀回 " + A(t).length + "台 · 本機待確認 " + values.length + "筆（非整場結清）"+(values.length?"；確定未送需處理 "+blocked+"筆、未送等待保存 "+queued+"筆、送出／待查 "+unknown+"筆":"")},
            stageObservations: stageObservations,
            canCommitObservations: canCommitObservations,
            commitObservations: commitObservations,
            action: (t, e) => t === "refresh" ? O() : t === "new" ? m() : t === "save" ? h() : t === "status" ? w(e) : t === "resume" ? v(e) : t === "continue-round" ? continueDraft(e) : t === "migrate" ? migrateRejected(e) : t === "retry-precheck" ? retryPrecheck(e) : null
        };
    }
    t.ErpFieldObservation = Object.freeze({
        create: a
    });
})(globalThis);
