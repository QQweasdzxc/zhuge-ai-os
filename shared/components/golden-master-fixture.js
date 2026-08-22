/*
 * Zhuge AI OS Golden Master Template-only Fixture.
 *
 * This is presentation QA data only. It is deliberately independent from
 * AI Board, WorkTodo, DataService, Supabase, browser storage, and any write
 * path. Consumers render it through the shared Golden Master Preview surface.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ZhugeGoldenMasterFixture = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const FIXTURE_ID = "ai-board-golden-master-fixture-v1";

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach(key => deepFreeze(value[key]));
    return value;
  }

  const fixture = deepFreeze({
    id: FIXTURE_ID,
    mode: "template-only",
    readOnly: true,
    boardKey: "ai-board-golden-master-preview",
    label: "AI Board Golden Master Fixture",
    header: {
      title: "🤖 AI Board",
      description: "工程協作工作平台｜Shared Golden Master Preview",
      identityHint: "Template-only Fixture · 不連線 Cloud"
    },
    toolbar: {
      searchPlaceholder: "搜尋目前工作中的 TASK、使用情境或工作區",
      filters: ["全部來源", "所有優先度", "所有工作區"],
      headerActions: ["＋ 卡片", "＋ 工作區", "📦 封存"],
      actions: ["檢查資料健康度"]
    },
    columns: [
      {
        id: "fixture-todo",
        key: "todo",
        name: "待辦",
        icon: "🧭",
        fixtureOnly: true,
        cards: [
          {
            id: "gm-fixture-task",
            code: "GM-FIX-001",
            title: "Golden Master Fixture Task",
            summary: "展示 Shared Card、Drawer、Properties 與完整互動表面。"
          }
        ]
      },
      {
        id: "fixture-co",
        key: "co",
        name: "Co區",
        icon: "🧠",
        fixtureOnly: true,
        cards: [
          {
            id: "gm-fixture-co",
            code: "GM-FIX-002",
            title: "Adapter boundary review",
            summary: "AI Board 與 WorkTodo 只替換 Domain mapping。"
          }
        ]
      },
      {
        id: "fixture-qjc",
        key: "qjc",
        name: "QJC驗證",
        icon: "🔍",
        fixtureOnly: true,
        cards: [
          {
            id: "gm-fixture-qjc",
            code: "GM-FIX-003",
            title: "Shared conformance QA",
            summary: "確認 Checklist、Timeline、Attachment 與 Responsive。"
          }
        ]
      },
      {
        id: "fixture-completed",
        key: "completed",
        name: "已完成",
        icon: "✅",
        fixtureOnly: true,
        cards: [
          {
            id: "gm-fixture-completed",
            code: "GM-FIX-004",
            title: "Template-only safety gate",
            summary: "不連 Cloud、不污染 AI Board／WorkTodo Domain Data。"
          }
        ]
      }
    ],
    selectedTaskId: "gm-fixture-task",
    task: {
      id: "gm-fixture-task",
      code: "GM-FIX-001",
      title: "Golden Master Fixture Task",
      subtitle: "AI Board · Shared Golden Master Fixture",
      workspace: "待辦",
      status: "QJC驗證",
      progress: "68%",
      priority: "P1 · 重要",
      mode: "Template-only · Read-only",
      properties: [
        { key: "workspace", icon: "📍", label: "工作區", value: "待辦" },
        { key: "status", icon: "◉", label: "目前狀態", value: "QJC驗證" },
        { key: "progress", icon: "◒", label: "進度", value: "68%" },
        { key: "priority", icon: "⚑", label: "優先度", value: "P1 · 重要" },
        { key: "mode", icon: "🧩", label: "資料模式", value: "Template-only Fixture" },
        { key: "cloud", icon: "☁️", label: "Cloud", value: "不連線" }
      ],
      sections: [
        {
          id: "work-content",
          title: "工作內容",
          hint: "Shared Work Body",
          content: "這是一筆只供 Golden Master Presentation／Interaction QA 使用的 Fixture。它示範正式 Task Drawer 會承載的工作內容，不代表任何 AI Board 或 WorkTodo 正式資料。"
        },
        {
          id: "usage-scenario",
          title: "使用情境",
          hint: "Adapter 提供 Domain mapping",
          content: "PM 從系統模板進入後，可以檢查 Card → Drawer → Checklist → Progress Timeline → GPT Analysis 的完整 UX 連續性。"
        }
      ],
      checklist: [
        { id: "gm-check-1", label: "Shared Task Card 可在 Board 中辨識", completed: true, note: "Shared component" },
        { id: "gm-check-2", label: "Shared Task Drawer 顯示 Properties 與 Sections", completed: true, note: "Read-only preview" },
        { id: "gm-check-3", label: "Responsive layout 可在窄螢幕閱讀", completed: false, note: "待 QA 點選確認" }
      ],
      attachments: [
        { id: "gm-attachment-1", icon: "📄", filename: "golden-master-fixture-spec.md", meta: "Template-only Fixture · 只讀示意" },
        { id: "gm-attachment-2", icon: "🖼️", filename: "ai-board-layout-reference.png", meta: "Board Visual Reference · 不上傳 Cloud" }
      ],
      timeline: [
        { kind: "human", type: "progress", title: "工作進度", content: "已完成 Shared Board、Card、Drawer 的 Golden Master preview 接線。", meta: "Template-only Fixture · 只讀示意" },
        { kind: "system", type: "workspace", title: "Workspace Activity", content: "此列只示範 Workspace／Column interaction 的視覺狀態，不會寫入任何 Workspace Data。", meta: "Shared contract" },
        { kind: "system", type: "acceptance", title: "PM Acceptance", content: "Preview 只展示驗收表面；正式接受動作仍由 Consumer／受控 Cloud path 負責。", meta: "No Cloud write" }
      ],
      analysis: [
        { key: "understanding", title: "需求理解", content: "Golden Master 是共用 UX surface，不是 AI Board 或 WorkTodo 的 Domain Data。" },
        { key: "judgement", title: "分析與判斷", content: "Template-only Fixture 可展示完整狀態，但不得進入正式資料來源。" },
        { key: "proposal", title: "建議做法", content: "由 Shared Preview Renderer 消費同一套 Board、Card、Drawer；Consumer 只提供 Adapter mapping。" },
        { key: "principles", title: "執行原則／Acceptance Criteria", content: "不建立第三套 UI、不新增 Migration Store、不新增 Cloud write path。" },
        { key: "handoff", title: "交付 Co 的執行摘要", content: "後續若修改 Shared Template，Consumer 透過同一 presentation contract 取得新版 UX。" }
      ]
    }
  });

  function get(id = FIXTURE_ID) {
    return id === FIXTURE_ID ? fixture : null;
  }

  function list() {
    return [fixture];
  }

  return Object.freeze({ FIXTURE_ID, get, list });
});
