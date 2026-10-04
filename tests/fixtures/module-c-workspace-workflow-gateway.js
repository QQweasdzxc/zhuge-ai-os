// In-memory Developer QA gateway only. Never connects to Supabase.
function createWorkspaceWorkflowGateway(options = {}) {
  const boardId = "board-fixture";
  const scope = options.scope || "ai_board";
  const keys = ["task-custom-50ae893517654d71baac8d457061a46b", "task-custom-12c1399e29c9438e9abc28ce1cf115f9", "task-custom-e78c0b609fba42bb81a846c60103ebe6"];
  const workspaces = [
    ...["todo", "co", "gpt", "qjc", "completed"].map((key, index) => ({
      id: `ws-${key}`, workspace_key: key, name: key, sort_order: (index + 1) * 10, active: true, board_instance_id: boardId
    })),
    ...["資源分享與參考", "暫緩", "TASK-081-E2E-20260922"].map((name, index) => ({
      id: `ws-custom-${index}`, workspace_key: keys[index], name, sort_order: (index + 6) * 10, active: true, board_instance_id: boardId
    }))
  ];
  const initial = {
    id: "published-1", board_instance_id: boardId, name: "Fixture Workflow", description: "Preserve this contract", status: "published",
    steps: workspaces.slice(0, 5).map((workspace, index) => ({
      id: `step-${index}`, step_key: workspace.workspace_key, name: workspace.name, sort_order: index * 10,
      workspace_id: workspace.id, role_key: index === 4 ? "pm" : "co", status_key: index === 4 ? "done" : "ready",
      is_initial: index === 0, is_completion: index === 4
    })),
    transitions: options.emptyEdges ? [] : [{ transition_key: "to_done", from_step_id: "step-0", to_step_id: "step-4", allowed_roles: ["pm", "qjc"], requires_gate: true }],
    gates: [{ id: "gate-done", step_id: "step-4", gate_key: "completion", name: "Completion gate", required: true, human_action_required: true, completion_role: "pm", failure_policy: "stay", sort_order: 9 }],
    evidence_requirements: [{ id: "evidence-done", gate_id: "gate-done", evidence_key: "runtime", label: "Runtime acceptance", required: true, source_kind: "pm_action_context", sort_order: 7 }]
  };
  if (options.persisted?.workspaces) workspaces.splice(0, workspaces.length, ...structuredClone(options.persisted.workspaces));
  if (options.persisted?.initial) Object.assign(initial, structuredClone(options.persisted.initial));
  const state = {
    calls: [], reads: [], workspaces, initial,
    published: options.persisted ? structuredClone(options.persisted.published) : options.optional ? null : structuredClone(initial),
    draft: options.persisted ? structuredClone(options.persisted.draft) : options.draft ? { id: "other-draft" } : null,
    cards: options.persisted ? structuredClone(options.persisted.cards || []) : [{ id: "existing-card", workspace_id: "ws-todo", workflow_version_id: "published-1", current_workflow_step_id: "step-0" }],
    failAt: options.failAt || "", readsAfterPublish: 0, getCount: 0, createdCount: Number(options.persisted?.createdCount || 0), lifecycle: [], reconcileCount: 0
  };
  const board = { id: boardId, active: true, template_key: "c", legacy_application_scope: scope, task_code_prefix: scope === "ai_board" ? "TASK" : "WLTK" };
  function reconcile() {
    if (state.failAt === "board_c_workflow_save_draft" || state.failAt === "board_c_workflow_validate_draft" || options.invalidDraft) throw new Error("Atomic lifecycle validation failure");
    if (options.publishConflict) throw new Error("Published version changed");
    const active=state.workspaces.filter(w=>w.active!==false && w.archived_at==null);
    if (state.published && state.published.steps.length===active.length && active.every(w=>state.published.steps.filter(s=>s.workspace_id===w.id).length===1)) return;
    const base=state.published || {...initial,name:'System baseline',steps:[],transitions:[],gates:[],evidence_requirements:[]};
    const steps=active.map((w,i)=>base.steps.find(s=>s.workspace_id===w.id)||{id:'system-step-'+w.id,workspace_id:w.id,step_key:'workspace-'+w.workspace_key,name:w.name,sort_order:i*10,role_key:'co',status_key:'ready',is_initial:true,is_completion:true});
    const ids=new Set(steps.map(s=>s.id));
    state.published={...structuredClone(base),id:++state.reconcileCount===1?'draft-fixture':'system-fixture-'+state.reconcileCount,status:'published',steps,transitions:base.transitions.filter(e=>ids.has(e.from_step_id)&&ids.has(e.to_step_id))};
    state.lifecycle.push('save','validate','publish','readback');
    if(state.draft){
      state.draft={...state.draft,status:'draft',based_on_workflow_version_id:state.published.id};
      const previous=state.draft.steps||[];
      state.draft.steps=active.map(w=>previous.find(s=>s.workspace_id===w.id)||structuredClone(steps.find(s=>s.workspace_id===w.id)));
      const draftIds=new Set(state.draft.steps.map(s=>s.id));
      state.draft.transitions=(state.draft.transitions||[]).filter(e=>draftIds.has(e.from_step_id)&&draftIds.has(e.to_step_id));
    }
  }
  const gateway = {
    async select(table, query) {
      state.reads.push({ table, query });
      if (table === "board_instances") return [board];
      if (table === "board_workspaces") {
        const id = /(?:\?|&)id=eq\.([^&]+)/.exec(query)?.[1];
        const key = /(?:\?|&)workspace_key=eq\.([^&]+)/.exec(query)?.[1];
        return state.workspaces.filter(row => (!id || row.id === decodeURIComponent(id)) && (!key || row.workspace_key === decodeURIComponent(key)));
      }
      return [];
    },
    async rpc(name, args) {
      state.calls.push({ name, args: structuredClone(args) });
      if (state.failAt === name) throw new Error(`Fixture failure: ${name}`);
      if (name === "board_resolve_template_instance") return board;
      if (name === "board_c_workflow_get") {
        state.getCount++;
        if (options.changeOnGet === state.getCount) state.published = { ...state.published, id: "concurrent-published" };
        if (options.draftOnGet === state.getCount) state.draft = { id: "concurrent-draft" };
        if (options.editDraftOnGet === state.getCount && state.draft) state.draft.description = "Another session edited this draft";
        const snapshot = { board_instance_id: boardId, state: { published_workflow_version_id: state.published?.id, draft_workflow_version_id: state.draft?.id }, published: structuredClone(state.published), draft: structuredClone(state.draft) };
        if (state.published?.id === "draft-fixture" && options.badReadBack) {
          snapshot.published.steps = snapshot.published.steps.filter(step => !step.step_key.startsWith("workspace-"));
        }
        return snapshot;
      }
      if (name === "board_instance_create_workspace") {
        const before={workspaces:structuredClone(state.workspaces),published:structuredClone(state.published),draft:structuredClone(state.draft),createdCount:state.createdCount,reconcileCount:state.reconcileCount};
        let workspace=state.workspaces.find(w=>w.workspace_key===args.p_workspace_key);
        try {
          if(!workspace){workspace={id:`ws-created-${++state.createdCount}`,board_instance_id:boardId,workspace_key:args.p_workspace_key,name:args.p_name,sort_order:100,active:true};state.workspaces.push(workspace);}
          if(workspace.active===false||workspace.name!==args.p_name)throw new Error('Workspace request key mismatch');
          reconcile();
        } catch(error){Object.assign(state,before);throw error;}
        if (options.createResponseLost && !state.responseLost) {state.responseLost=true;throw new Error("Workspace committed but response was lost");}
        return workspace;
      }
      if (name === "board_c_workflow_save_draft") {
        const steps = args.p_steps.map((step, index) => ({ ...step, id: `draft-step-${index}` }));
        const stepByKey = new Map(steps.map(step => [step.step_key, step.id]));
        const gates = args.p_gates.map((gate, index) => ({ ...gate, id: `draft-gate-${index}`, step_id: stepByKey.get(gate.step_key) }));
        const gateByKey = new Map(gates.map(gate => [gate.gate_key, gate.id]));
        state.draft = {
          id: "draft-fixture", board_instance_id: boardId, based_on_workflow_version_id: state.published.id,
          name: args.p_name, description: args.p_description, status: "draft", steps,
          transitions: args.p_transitions.map(item => ({ ...item, from_step_id: stepByKey.get(item.from_step_key), to_step_id: stepByKey.get(item.to_step_key) })),
          gates, evidence_requirements: args.p_evidence_requirements.map(item => ({ ...item, gate_id: gateByKey.get(item.gate_key) }))
        };
        return { workflow: structuredClone(state.draft), validation: { valid: true } };
      }
      if (name === "board_c_workflow_validate_draft") return { validation: { valid: !options.invalidDraft, errors: options.invalidDraft ? ["fixture validation failure"] : [] } };
      if (name === "board_c_workflow_publish") {
        if (options.publishConflict) throw new Error("Published version changed");
        state.published = { ...state.draft, status: "published" };
        state.draft = null;
        return { workflow: structuredClone(state.published) };
      }
      if (name === "board_instance_create_task") {
        reconcile();
        const bindings = state.published?.steps.filter(step => step.workspace_id === args.p_workspace_id) || [];
        if (state.published && args.p_workflow_mode === "published" && bindings.length !== 1) throw new Error("Module C workspace does not have exactly one Workflow Step binding");
        const task = { id: "new-card", board_instance_id: boardId, workspace_id: args.p_workspace_id, title: args.p_title, status: bindings[0]?.status_key || args.p_status, workflow_version_id: state.published?.id || null, current_workflow_step_id: bindings[0]?.id || null };
        state.cards.push(task);
        return task;
      }
      throw new Error(`Unexpected fixture RPC: ${name}`);
    }
  };
  return { gateway, state, boardId };
}

module.exports = { createWorkspaceWorkflowGateway };
