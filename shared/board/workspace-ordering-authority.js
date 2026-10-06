/*
 * Module C Workspace Ordering Authority.
 *
 * This module owns the client-side ordering contract only: it calculates a
 * complete board-instance order, resolves before/after placement, delegates
 * persistence to the already-authorized Board service, and verifies the
 * post-write read-back.  It does not write storage, invent an audit entry, or
 * change workspace protection rules.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeModuleCWorkspaceOrderingAuthority = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SORT_STEP = 10;

  function workspaceId(workspace) {
    return String(workspace?.id ?? workspace?.workspaceId ?? "");
  }

  function sortValue(workspace) {
    const value = Number(workspace?.sortOrder ?? workspace?.sort_order);
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  }

  function createdValue(workspace) {
    return String(workspace?.createdAt ?? workspace?.created_at ?? "");
  }

  function fail(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    throw error;
  }

  function activeWorkspaces(workspaces) {
    return (Array.isArray(workspaces) ? workspaces : [])
      .filter(workspace => workspace && workspace.active !== false);
  }

  function sortWorkspaces(workspaces) {
    return activeWorkspaces(workspaces).slice().sort((left, right) => {
      const orderDifference = sortValue(left) - sortValue(right);
      if (orderDifference) return orderDifference;
      const createdDifference = createdValue(left).localeCompare(createdValue(right));
      if (createdDifference) return createdDifference;
      return workspaceId(left).localeCompare(workspaceId(right));
    });
  }

  function normalizeOrder(workspaces) {
    return activeWorkspaces(workspaces).map((workspace, index) => ({
      ...workspace,
      sortOrder: (index + 1) * SORT_STEP,
      sort_order: (index + 1) * SORT_STEP
    }));
  }

  function normalizedIds(workspaceIds) {
    return (Array.isArray(workspaceIds) ? workspaceIds : []).map(value => String(value ?? ""));
  }

  function validateFullOrder(workspaces, workspaceIds) {
    const expected = sortWorkspaces(workspaces).map(workspaceId);
    const actual = normalizedIds(workspaceIds);
    const distinct = new Set(actual);
    if (!actual.length) {
      fail("WORKSPACE_ORDER_REQUIRED", "Workspace order must contain every active workspace.");
    }
    if (actual.some(id => !id) || distinct.size !== actual.length) {
      fail("WORKSPACE_ORDER_DUPLICATE", "Workspace order must contain each workspace exactly once.", { workspaceIds: actual });
    }
    if (actual.length !== expected.length || expected.some(id => !distinct.has(id))) {
      fail("WORKSPACE_ORDER_INCOMPLETE", "Workspace order must include every active workspace exactly once.", {
        expected,
        actual
      });
    }
    return actual;
  }

  function placementValue(placement) {
    return String(placement || "before").toLowerCase() === "after" ? "after" : "before";
  }

  function resolveDropPlacement(event, column) {
    const rect = column?.getBoundingClientRect?.();
    const clientX = Number(event?.clientX);
    if (rect && Number.isFinite(clientX) && Number.isFinite(rect.left) && Number.isFinite(rect.width) && rect.width > 0) {
      return clientX >= rect.left + (rect.width / 2) ? "after" : "before";
    }
    return placementValue(event?.dropPlacement || event?.placement);
  }

  function buildReorderedOrder(workspaces, draggedId, targetId, placement = "before", options = {}) {
    const ordered = sortWorkspaces(workspaces);
    const isVisible = typeof options.isVisible === "function" ? options.isVisible : () => true;
    const visible = ordered.filter(isVisible);
    const source = String(draggedId ?? "");
    const target = String(targetId ?? "");
    const sourceIndex = visible.findIndex(workspace => workspaceId(workspace) === source);
    const targetIndex = visible.findIndex(workspace => workspaceId(workspace) === target);
    if (sourceIndex < 0 || targetIndex < 0) {
      fail("WORKSPACE_DROP_TARGET_INVALID", "Workspace drag source and target must be visible active workspaces.", {
        draggedId: source,
        targetId: target
      });
    }
    if (source === target) {
      fail("WORKSPACE_DROP_SELF", "Workspace cannot be dropped onto itself.", { draggedId: source });
    }

    const nextVisible = visible.slice();
    nextVisible.splice(sourceIndex, 1);
    const nextTargetIndex = nextVisible.findIndex(workspace => workspaceId(workspace) === target);
    const insertionIndex = nextTargetIndex + (placementValue(placement) === "after" ? 1 : 0);
    nextVisible.splice(insertionIndex, 0, visible[sourceIndex]);

    let visibleIndex = 0;
    const nextFullOrder = ordered.map(workspace => isVisible(workspace) ? nextVisible[visibleIndex++] : workspace);
    const normalized = normalizeOrder(nextFullOrder);
    const ids = validateFullOrder(ordered, normalized.map(workspaceId));
    return Object.freeze({
      placement: placementValue(placement),
      noOp: ids.every((id, index) => id === workspaceId(ordered[index])),
      workspaceIds: Object.freeze(ids.slice()),
      orderedWorkspaces: Object.freeze(normalized),
      visibleWorkspaces: Object.freeze(nextVisible.slice())
    });
  }

  function readbackWorkspaces(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.workspaces)) return value.workspaces;
    return null;
  }

  async function reorder(options = {}) {
    const plan = buildReorderedOrder(
      options.workspaces,
      options.draggedId,
      options.targetId,
      options.placement,
      { isVisible: options.isVisible }
    );
    if (plan.noOp) return plan;
    if (typeof options.persist !== "function") {
      fail("WORKSPACE_ORDER_PERSIST_UNAVAILABLE", "Workspace ordering persistence authority is unavailable.");
    }
    if (typeof options.reload !== "function") {
      fail("WORKSPACE_ORDER_READBACK_UNAVAILABLE", "Workspace ordering reload/read-back authority is unavailable.");
    }
    const response = await options.persist(plan.workspaceIds.slice());
    const reloaded = readbackWorkspaces(await options.reload());
    if (!reloaded) {
      fail("WORKSPACE_ORDER_READBACK_UNAVAILABLE", "Workspace ordering was written but canonical read-back was unavailable.");
    }
    const readbackIds = validateFullOrder(reloaded, sortWorkspaces(reloaded).map(workspaceId));
    if (readbackIds.join("|") !== plan.workspaceIds.join("|")) {
      fail("WORKSPACE_REORDER_READBACK_MISMATCH", "Workspace ordering read-back does not match the submitted canonical order.", {
        submitted: plan.workspaceIds,
        readback: readbackIds
      });
    }
    return Object.freeze({ ...plan, response, readback: Object.freeze(reloaded.slice()) });
  }

  return Object.freeze({
    SORT_STEP,
    activeWorkspaces,
    sortWorkspaces,
    normalizeOrder,
    validateFullOrder,
    resolveDropPlacement,
    buildReorderedOrder,
    reorder
  });
});
