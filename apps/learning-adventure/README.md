# 學習群島｜Learning Archipelago（2026-11-07）

## 產品決策
- 孩子只認一位家庭冒險者；每位冒險者有一個 **hero UUID** 和一個可以選一次的職業。
- 四職業：warrior（勇士）、mage（法師）、ranger（弓箭手）、guardian（守護者）；目前只有外觀與稱號差異，不提供答題加成。
- 既有成語／英文單字網站繼續使用原有固定網址；各網站保留獨立的本地測驗者 ID、教材、遊戲流程和錯題報表。
- 「家庭冒險者 ID」透過 `learning_adventure_hero_links` 連到各島的玩家 ID，不再靠前端姓名比對。首次遷移在**單一確認家庭**內將同名人物合併，今後新增玩家的後端觸發器會在該家庭自動配對。未來新家庭必須另有綁定與防撞名機制。
- 一個共同職業、一個總 XP、一個**正式認證等級**；各島保留各自的練習 XP、關卡、徽章和成績。
- 轉換至正式 Lv. 必須完成 10 題「晉級試煉」，正確率達 80%（至少 8 題）。試題與正確答案儲存在伺服器，伺服器負責批改；不能只靠前端回報分數。
- 年齡只供未來建議，不用年齡直接限制關卡。成語島仍使用第 1–7 關漸進解鎖規則。

## 等級與經驗值
- 既有遊戲 XP：每答對 1 題 +10 XP；完成一回合 +20 XP；Game Over 的學習歷程仍有 +5 XP。由原始測驗資料表的觸發器核算，不由用戶端自行指定。
- 共用總 XP 是兩個島的有效紀錄加總；`learning_adventure_xp_ledger` 以 `(world,source_attempt_id)` 去重，避免重複發放。
- Lv. N 升 Lv. N+1 的**累計**門檻：`50 * N * (N+1)` XP（1→2：100；2→3：300；3→4：600；4→5：1000）。
- XP 達標只會開啟晉級試煉，不會自動更新正式等級。每次通過僅升 **一級**；如果總 XP 已足夠，可逐級挑戰。
- 失敗不扣 XP，可重新考。升級考試需通過，單科遊戲的「破關」和冒險者正式升級是不同進度。

## 後端
- Supabase project: `lenpbbhwxyyfwgvjcozf`
- Edge Function: `learning-adventure-cloud`；同一 API 接收不同島的家庭能力權杖（URL `#f=`），來源 `world=chengyu|vocab`。
- API actions: `load`, `chooseProfession`, `startExam`, `submitExam`。
- 嚴禁將家庭權杖、Supabase service role key 放進 GitHub 或公開 JavaScript。Edge Function 內驗證家庭權杖雜湊，再核對原島玩家 id 與共用 hero id。
- 共用後端檔案：`apps/learning-adventure/supabase/index.ts`（目前保存在成語 Render 分支）。前端：兩島各自的 `site/archipelago.js`，功能需保持一致。
- 共用資料表：`learning_adventure_families`, `learning_adventure_family_bindings`, `learning_adventure_heroes`, `learning_adventure_hero_links`, `learning_adventure_xp_ledger`, `learning_adventure_exam_bank`, `learning_adventure_promotion_exams`。所有表使用 RLS 並撤除 `anon`、`authenticated` 直接權限。
- 歷史紀錄完整保留；遷移核對時跨島 ID 連結數、舊 XP 總額與共用 XP 總額一致。

## 晉級試煉 V1
- 先檢查正式 Lv 與總 XP 是否達標，並要求已選職業。
- 試題為 10 題四選一。題目由伺服器生成，回答前不送出正解。
- 當兩島均有作答紀錄：成語 5 題＋英文 5 題；僅一島有作答紀錄：該島 10 題。
- 成語取自現有題庫（**自行編寫，尚未逐條核對教育部《成語典》**）；題型為意義、反向選成語、情境填空。英文取現有 Supabase 教材週次，題型為英翻中／中翻英。
- 通過後由服務端更新 `verified_level`。試煉、得分和時間留存資料表。未完成試煉可重新開啟。
- 升級考試目前不影響原本三顆愛心機制；未來可加入音效、寶箱與職業動畫。

## 未來群島總部 Roadmap
1. 獨立的「冒險者總部」固定網址、一個主入口；登入流程仍以家庭專用連結與個人選人卡片為主。
2. 連接成語島、英文島、數學島、自然島、歷史島，呈現多島地形和船隻航行；每島有自己的教材、難度和精通進度。
3. 職業角色動畫、破關寶箱、每日任務與任務簿，視需要加上職業服飾；**不以課外付費或抽卡換取學習優勢**。
4. 擴展考題來源核對、難度校準、跨島均衡測驗與家長總覽；未完成之前不要把內容標成教育部官方題庫。
5. 將兩個站點的同一份 `archipelago.js` 改為共用原始碼來源及 CI 發布，避免往後兩島維護分叉。
6. 多家庭使用時升級身分授權，避免任何跨家庭的同名合併；家長應可管理或解除孩子的連結。
7. 正式實機驗收：iPhone LINE 內建瀏覽器／Safari 操作：選玩家、首次選職業、同人跨島總 XP、XP 達標、10 題晉級與重新挑戰、重新開啟後進度維持、舊成績不遺失。

## 當前狀態
- 身分映射、XP 觸發器、合併歷史進度、題庫、共用 API、四職業與晉級試煉前端已部署到 Supabase／兩個 Render 網站。
- 已進行資料庫跨島新增／XP 核算 rollback 測試及兩個 Render Live 部署與前端靜態資產確認。
- **尚未完成手機上 10 題考試的完整真實互動驗收，請勿把此項標記為 PASS。**
