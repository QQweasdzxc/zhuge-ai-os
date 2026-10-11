#!/usr/bin/env python3
"""Fail-closed tests for TaskFlow overlays against the immutable vendor snapshot."""

from __future__ import annotations

import importlib.util
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(os.environ.get(
    "TASKFLOW_STABILITY_PATCH_SCRIPT",
    Path(__file__).resolve().parents[1] / "patches" / "apply-taskflow-stability.py",
)).resolve()
SPEC = importlib.util.spec_from_file_location("taskflow_stability_overlay", SCRIPT)
assert SPEC and SPEC.loader
OVERLAY = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = OVERLAY
SPEC.loader.exec_module(OVERLAY)

DEFAULT_REPO_ROOT = Path(__file__).resolve().parents[3]
SOURCE_ROOT = Path(os.environ.get("TASKFLOW_VENDOR_SOURCE_ROOT", DEFAULT_REPO_ROOT / "third_party/multica")).resolve()
OVERLAY_ROOT = Path(os.environ.get("TASKFLOW_STABILITY_OVERLAY_ROOT", Path(__file__).resolve().parents[1] / "overrides")).resolve()


def copy_pinned_sources(source_root: Path, target_root: Path) -> None:
    for relative in OVERLAY.EXPECTED_SHA256:
        source = source_root / relative
        target = target_root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)


class StabilityOverlayTests(unittest.TestCase):
    def test_all_pinned_vendor_source_hashes_match(self) -> None:
        for relative, expected in OVERLAY.EXPECTED_SHA256.items():
            with self.subTest(path=relative):
                self.assertEqual(OVERLAY.hashlib.sha256((SOURCE_ROOT / relative).read_bytes()).hexdigest(), expected)

    def test_both_overlays_apply_to_temporary_copy_without_mutating_vendor(self) -> None:
        with tempfile.TemporaryDirectory(prefix="taskflow-stability-patch-test-") as temporary:
            target_root = Path(temporary) / "source"
            copy_pinned_sources(SOURCE_ROOT, target_root)
            OVERLAY.patch_backend(target_root, OVERLAY_ROOT)
            OVERLAY.patch_web(target_root, OVERLAY_ROOT)
            self.assertTrue((target_root / "server/cmd/server/taskflow_pool_budget_test.go").is_file())
            self.assertTrue((target_root / "packages/core/issues/taskflow-row-query.test.ts").is_file())
            self.assertTrue((target_root / "packages/views/issues/surface/taskflow-pagination-recovery.test.tsx").is_file())
            self.assertIn(
                "expect.objectContaining({ signal: expect.any(AbortSignal) })",
                (target_root / "packages/views/issues/surface/use-issue-status-branches.test.tsx").read_text(),
            )
            self.assertIn("validateTaskFlowPoolBudget(cfg, sizing)", (target_root / "server/cmd/server/dbstats.go").read_text())
            self.assertIn("signal: options.signal", (target_root / "packages/core/api/client.ts").read_text())

    def test_missing_upstream_markers_fail_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "expected one upstream marker, found 0"):
            OVERLAY.patch_db_stats("func newPool() { return nil }\n")
        with self.assertRaisesRegex(ValueError, "marker missing or ambiguous"):
            OVERLAY.patch_webhook_worker("func unrelated() {}\n")

    def test_pool_budget_fails_before_connection_creation_and_is_rollback_compatible(self) -> None:
        original = (SOURCE_ROOT / "server/cmd/server/dbstats.go").read_text()
        budget_keys = (
            "TASKFLOW_DB_SESSION_BUDGET",
            "TASKFLOW_DB_PRIMARY_SESSION_BUDGET",
            "TASKFLOW_DB_REPLICA_SESSION_BUDGET",
            "TASKFLOW_DB_EXTERNAL_SESSION_RESERVE",
            "TASKFLOW_API_REPLICA_COUNT",
        )

        # The pinned .9.31-era pool source does not read the new non-secret
        # ledger keys, so staging them does not alter rollback behavior.
        for key in budget_keys:
            with self.subTest(key=key):
                self.assertNotIn(key, original)

        patched = OVERLAY.patch_db_stats(original)
        validate_index = patched.index("validateTaskFlowPoolBudget(cfg, sizing)")
        pool_create_index = patched.index("return pgxpool.NewWithConfig(ctx, cfg)")
        self.assertLess(validate_index, pool_create_index)

    def test_webhook_backoff_does_not_rewrite_durable_delivery_semantics(self) -> None:
        source = (SOURCE_ROOT / "server/internal/handler/webhook_delivery_worker.go").read_text()
        patched = OVERLAY.patch_webhook_worker(source)
        delivery_marker = "func (w *WebhookDeliveryWorker) ProcessNext(ctx context.Context) (bool, error) {"
        self.assertEqual(source[source.index(delivery_marker):], patched[patched.index(delivery_marker):])
        self.assertIn("w.h.Queries.ClaimQueuedWebhookDelivery(ctx)", patched)
        self.assertIn("w.retryOrFail(ctx, delivery", patched)
        self.assertIn("w.complete(ctx, delivery", patched)

    def test_changed_pinned_source_hash_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory(prefix="taskflow-stability-hash-test-") as temporary:
            target_root = Path(temporary)
            relative = "server/cmd/server/dbstats.go"
            target = target_root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(SOURCE_ROOT / relative, target)
            target.write_text(target.read_text() + "\n// unexpected marker drift\n")
            with self.assertRaisesRegex(ValueError, "frozen-source SHA mismatch"):
                OVERLAY.verify_and_patch(target_root, relative, OVERLAY.patch_db_stats)


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]])
