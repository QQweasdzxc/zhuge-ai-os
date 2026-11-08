# Live SQL 對照（2026-11-09，唯讀 pg_get_functiondef）

完整原文與簽章：`tests/fixtures/zg71-live-function-definitions.json`。只有函式定義，沒有使用者資料。


| 函式 | repo 替換前 vs live（body） | 新 migration |
|---|---|---|
| `app_access_review_paused()` | 不同，見下方 diff | 不替換，保留 live |
| `is_app_access_approved()` | 相同 | 明確替換，非純 additive |
| `list_app_access_applications()` | 相同 | 明確替換，非純 additive |
| `resolve_app_access()` | 相同 | 明確替換，非純 additive |
| `review_app_access_application(uuid,text,text,text)` | 相同 | 不替換，保留 live |
| `set_app_access_review_paused(boolean)` | 不同，見下方 diff | 不替換，保留 live |
| `submit_app_access_request(text,text,text)` | 相同 | 不替換，保留 live |

## app_access_review_paused 的 baseline 差異
```diff
--- live
+++ repo baseline
@@ -1 +1 @@
-select coalesce((select (s.value #>> '{}')::boolean from private.app_access_settings s where s.key = 'review_paused'), false);
+select coalesce((select (s.value #>> '{}')::boolean from private.app_access_settings s where s.key='review_paused'),false);
```


## set_app_access_review_paused 的 baseline 差異
```diff
--- live
+++ repo baseline
@@ -1,9 +1,8 @@
 begin
-  if not coalesce((public.resolve_creator_capability()->>'is_creator')::boolean, false) then
-    raise exception using errcode = '42501', message = 'Creator or owner approval is required.';
-  end if;
-  insert into private.app_access_settings (key, value)
-  values ('review_paused', to_jsonb(coalesce(paused, false)))
-  on conflict (key) do update set value = excluded.value, updated_at = now();
-  return jsonb_build_object('review_paused', coalesce(paused, false), 'updated_at', now());
+ if auth.uid() is null or not coalesce((public.resolve_creator_capability()->>'is_creator')::boolean,false) then
+  raise exception using errcode='42501',message='Creator or owner approval is required.';
+ end if;
+ insert into private.app_access_settings(key,value) values('review_paused',to_jsonb(coalesce(paused,false)))
+ on conflict(key) do update set value=excluded.value,updated_at=now();
+ return jsonb_build_object('review_paused',coalesce(paused,false),'updated_at',now());
 end;
```


## 新 migration 對 live 的語意差異

- is_app_access_approved：改為呼叫唯一 private.app_access_effective_allowed(auth.uid())；cutoff 未設時僅明確 Off 優先，舊事件結果相同。
- resolve_app_access：使用同一 helper 決定 status，新增 effective_allowed/enabled/access_disabled/access_model_active，保留 original_status/history 與舊欄位。啟用 cutoff 是另一個 main-only 操作。
- list_app_access_applications：由每次 application 一列改為每人一列，加 App 身分來源與自己的首次進入記錄；只在 creator + 使用權檢查後讀取；enabled 是 effective_allowed 的相容別名。
- review/submit：不替換 live body；新的 insert trigger 阻止重送與舊申請覆蓋明確 Off。approved/decided 的 40001 與冪等行為保留，已有本地測試。
- pause getter/setter：ZG71 不替換。歷史 baseline getter body 只是格式差異；setter 額外拒絕空 uid（creator resolver 在匿名時本就 false），旗標初始化改成 DO NOTHING 不重設既有值。
- 因 list 重組及明確禁止、新政策啟用屬語意變更，本 PR 不再使用籠統 additive 宣稱。只有 resolver 舊欄位未刪除、舊事件在 cutoff 未設時結果不變。

## 影響彙總（正式庫唯讀；無原始名單）

| 情況 | 有效允許 | 不允許 | 有 App 證據 | 缺口 | 祖父 | 新進待決 |
|---|---:|---:|---:|---:|---:|---:|
| 現行（暫停 true） | 6 | 0 | 5 | 1 | — | — |
| migration 單獨部署／不採 A／cutoff 未設 | 6 | 0 | 5 | 1 | 0 | 0 |
| main 確認當下有效允許人數後採凍結快照（未執行） | 6 | 0 | 5 | 1 | 6 | 0 |
| 新進者日後自行進入（仍無祖父，需 creator On） | — | — | — | — | 6 | — |

現有事件：approved_bootstrap 4、application_approved 1；PENDING 0、REJECTED 0、disabled 0、NEW 1。以上新政策列是投影，並未對正式庫執行。

不把缺口帳號判定為非 App 使用者，也不替它補建 membership／名片。補充 7 的 164 個 App/TF/private 欄位來源均為 0 活動，但有 1–7 天前 Google 登入與 3 個未撤銷 refresh token，不能稱為停用／測試帳號。啟用時凍結當下有效允許者，使用 owner-only `activate_app_access_model(6)`；人數漂移則拒絕。結果 6→6 允許。細節見 gap-account-review.md。

舊 profile 的 created_at 不作授權判斷；啟用當刻在內部 private 表凍結當下有效允許的身分集合，cutoff 後修改／回填 profile 不會更新。migration 不執行 activation、不建立凍結資料、不批量修改使用者狀態。
