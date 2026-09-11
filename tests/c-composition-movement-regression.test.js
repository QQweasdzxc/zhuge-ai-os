const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const Policy = require("../shared/services/template-adoption-policy.js");
const ManagementCenter = require("../shared/components/template-management-center.js");
const BoardReadService = require("../shared/board/board-read-service.js");

const C_PAGES = [
  { id: "template-c", file: "app/Board/template-preview/index.html", boardId: "c-mother-board" },
  { id: "ai-board", file: "app/Board/ai/index.html", boardId: "ai-board" },
  { id: "tasks-new", file: "app/Board/worktodo/index.html", boardId: "worktodo-board" },
  { id: "procurement", file: "app/Board/procurement/index.html", boardId: "gas-board" },
  { id: "investment", file: "app/Board/investment/index.html", boardId: "investment-board", readOnly: true }
];

test("all C surfaces compose the canonical A+C runtime", () => {
  for (const page of C_PAGES) {
    const source = read(page.file);
    assert.match(source, /shared\/components\/zhuge-navigation\.js/);
    assert.match(source, /shared\/components\/task-board\.js/);
    assert.match(source, /shared\/components\/golden-master-runtime\.js/);
    assert.match(source, /data-golden-master-surface/);
    assert.doesNotMatch(source, /c-mtdk-store\.js/);
    assert.doesNotMatch(source, /(?:^|["/])board-runtime\.js/);
  }

  assert.equal(Policy.PAGE_REGISTRY["template-c"].isMother, true);
  assert.deepEqual(Policy.PAGE_REGISTRY["template-c"].requiredTemplates, ["navigation", "board"]);
  assert.match(read("app/Board/template-preview/index.html"), /data-template-page-id="template-c"/);

  const models = ManagementCenter.buildTemplateModel({
    service: Policy.createService({ dataGateway: { rpc: async () => ({}) } }),
    templates: Policy.TEMPLATES,
    pages: Policy.PAGE_REGISTRY,
    status: "resolved",
    isCreator: true,
    userId: "creator"
  });
  assert.equal(models.find(model => model.template.id === "board").consumers.some(page => page.id === "template-c"), false);
  assert.match(read("shared/components/template-management-center.js"), /page\?\.isMother !== true/);
});

test("the formal procurement runtime cannot fall back to the legacy GAS movement service", () => {
  const runtime = read("shared/components/golden-master-runtime.js");
  assert.match(runtime, /const cInstanceRuntime = state\.applicationScope === "c" \|\| state\.applicationScope === "procurement"/);
  assert.doesNotMatch(runtime, /GasBoardService/);
});

test("all C consumers use the same v2 adoption and movement authority", async () => {
  const runtime = read("shared/components/golden-master-runtime.js");
  const adoptionStart = runtime.indexOf("function canAdoptExistingCWorkflowCard");
  const adoptionEnd = runtime.indexOf("async function adoptExistingCWorkflowCard", adoptionStart);
  assert.ok(adoptionStart >= 0 && adoptionEnd > adoptionStart);
  assert.doesNotMatch(runtime.slice(adoptionStart, adoptionEnd), /state\.applicationScope === "ai_board"/);
  assert.match(runtime, /allowExistingCardAdoption: cWorkflowRuntime/);
  assert.match(runtime, /allowWorkspaceMovement: cWorkflowRuntime/);

  for (const page of C_PAGES) {
    const calls = [];
    const gateway = {
      async select() {
        return [{ id: page.boardId, name: page.id, template_key: "c", active: true }];
      },
      async rpc(name, args) {
        calls.push({ name, args });
        if (name === "board_c_workflow_get") {
          return {
            contract: "module-c-lifecycle-acceptance-v2",
            board_instance_id: page.boardId,
            state: { published_workflow_version_id: "workflow-1" },
            published: { id: "workflow-1", board_instance_id: page.boardId, steps: [] },
            draft: null
          };
        }
        if (name === "board_c_workflow_resolve_task") return { state: "resolved" };
        return { contract: "module-c-lifecycle-acceptance-v2", action: name, state: "ok" };
      }
    };
    const workflow = BoardReadService.createWorkflowCapability({
      gateway,
      boardInstanceId: page.boardId,
      readOnly: page.readOnly === true,
      allowExistingCardAdoption: true,
      allowWorkspaceMovement: true
    });

    assert.equal(workflow.contract.source, "module-c-mother");
    assert.equal(workflow.contract.owner, "board-instance");
    assert.equal(workflow.capabilities.workspaceDecision, true);
    assert.equal(workflow.capabilities.existingCardAdoption, true);
    if (page.readOnly) {
      assert.equal(workflow.readOnly, true);
      assert.equal(workflow.capabilities.adoption, false);
    }

    await workflow.adoptUnboundCard({ taskId: `${page.id}-task`, idempotencyKey: `${page.id}-adopt` });
    await workflow.reconcileWorkspaceDecision({
      taskId: `${page.id}-task`,
      targetWorkspaceId: `${page.id}-target`,
      idempotencyKey: `${page.id}-move`
    });

    assert.deepEqual(calls.map(call => call.name), [
      "board_c_workflow_adopt_unbound_card_v2",
      "board_c_workflow_get",
      "board_c_workflow_resolve_task",
      "board_c_reconcile_workspace_decision_v2"
    ]);
    assert.equal(calls[0].args.p_idempotency_key, `${page.id}-adopt`);
    assert.equal(calls[3].args.p_idempotency_key, `${page.id}-move`);
    assert.equal(calls.filter(call => call.name !== "board_c_workflow_get" && call.name !== "board_c_workflow_resolve_task")
      .every(call => call.args.p_task_id === `${page.id}-task`), true);
  }
});

test("all C consumers keep the same owner-scoped movement path when no workflow is published", async () => {
  for (const page of C_PAGES) {
    const calls = [];
    let workspaceId = `${page.id}-workspace-1`;
    const gateway = {
      async select() {
        return [{ id: page.boardId, name: page.id, template_key: "c", active: true }];
      },
      async rpc(name, args) {
        calls.push({ name, args });
        if (name === "board_c_workflow_get") {
          return {
            contract: "module-c-lifecycle-acceptance-v2",
            board_instance_id: page.boardId,
            state: null,
            published: null,
            draft: null
          };
        }
        if (name === "board_c_workflow_resolve_task") return { state: "workflow_not_configured" };
        if (name === "board_instance_move_task_workspace") {
          workspaceId = args.p_workspace_id;
          return {
            id: `${page.id}-task`,
            board_instance_id: page.boardId,
            workspace_id: workspaceId,
            status: "ready",
            assignee: null
          };
        }
        throw new Error(`unexpected RPC ${name}`);
      }
    };

    const firstSession = BoardReadService.createWorkflowCapability({
      gateway,
      boardInstanceId: page.boardId,
      readOnly: page.readOnly === true,
      allowWorkspaceMovement: true
    });
    const firstResult = await firstSession.moveWorkspaceDecision({
      taskId: `${page.id}-task`,
      targetWorkspaceId: `${page.id}-workspace-2`,
      decisionNote: "PM selected workspace"
    });
    assert.equal(firstResult.state, "workspace_moved");
    assert.equal(firstResult.workflow_bound, false);
    assert.equal(firstResult.card_identity_preserved, true);
    assert.equal(workspaceId, `${page.id}-workspace-2`);

    // A fresh capability instance represents Reload/New Session. It must use
    // the same Cloud-backed movement authority and must not introduce a
    // consumer-specific fallback or local workflow state.
    const secondSession = BoardReadService.createWorkflowCapability({
      gateway,
      boardInstanceId: page.boardId,
      readOnly: page.readOnly === true,
      allowWorkspaceMovement: true
    });
    await secondSession.moveWorkspaceDecision({
      taskId: `${page.id}-task`,
      targetWorkspaceId: `${page.id}-workspace-3`
    });
    assert.equal(workspaceId, `${page.id}-workspace-3`);
    assert.deepEqual(calls.map(call => call.name), [
      "board_c_workflow_get",
      "board_c_workflow_resolve_task",
      "board_instance_move_task_workspace",
      "board_c_workflow_get",
      "board_c_workflow_resolve_task",
      "board_instance_move_task_workspace"
    ]);
    assert.equal(calls.filter(call => call.name === "board_instance_move_task_workspace")
      .every(call => call.args.p_task_id === `${page.id}-task`), true);
  }
});

test("read-only Investment keeps settings protected while its C movement path remains shared", async () => {
  const calls = [];
  const service = BoardReadService.createInstanceService({
    gateway: {
      async select() { return [{ id: "investment-board", name: "Investment", template_key: "c", active: true }]; },
      async rpc(name, args) {
        calls.push({ name, args });
        if (name === "board_c_workflow_get") {
          return {
            contract: "module-c-lifecycle-acceptance-v2",
            board_instance_id: "investment-board",
            state: { published_workflow_version_id: "workflow-1" },
            published: { id: "workflow-1", board_instance_id: "investment-board", steps: [] },
            draft: null
          };
        }
        if (name === "board_c_workflow_resolve_task") return { state: "resolved" };
        return { contract: "module-c-lifecycle-acceptance-v2", action: name };
      }
    },
    boardInstanceId: "investment-board",
    workflowReadOnly: true,
    allowExistingCardAdoption: true,
    allowWorkspaceMovement: true
  });

  assert.equal(service.workflow.readOnly, true);
  assert.equal(service.workflow.capabilities.workspaceDecision, true);
  assert.equal(service.workflow.capabilities.existingCardAdoption, true);
  assert.equal(service.workflow.capabilities.adoption, false);
  await service.reconcileWorkspaceDecision({ taskId: "investment-task", targetWorkspaceId: "investment-target" });
  assert.equal(calls.at(-1).name, "board_c_reconcile_workspace_decision_v2");
});
