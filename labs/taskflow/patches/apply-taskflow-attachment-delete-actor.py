#!/usr/bin/env python3
"""Attachment deletions publish the resolved actor, not a hard-coded member.

Frozen-vendor overlay: DeleteAttachment broadcast both its issue-bound
(EventIssueAttachmentsChanged) and comment-bound (EventCommentUpdated)
change events as ("member", X-User-ID). For SAT and mat_ credentials
X-User-ID is the credential's human creator, so an agent's attachment
deletion was credited to a person. The handler now publishes
h.resolveActor(...) exactly like the comment handlers do (comment.go),
with NO change to authorization, uploader/admin checks, or deletion
semantics. Whole-operator-identity repair; known defect pinned by
TestServiceAgentTokenAttachmentDeleteScope.
"""

from __future__ import annotations

import argparse
from pathlib import Path

FILE = 'server/internal/handler/file.go'

RESOLUTION_ANCHOR = (
    '\tvar deleted db.DeleteAttachmentRow\n'
    '\tdeleteParams := db.DeleteAttachmentParams{ID: att.ID, WorkspaceID: att.WorkspaceID}\n'
)
RESOLUTION_REPLACEMENT = (
    '\t// Publish under the resolved actor (SAT/mat_ agent or human member),\n'
    '\t// never a hard-coded member identity: for agent credentials X-User-ID\n'
    '\t// is the credential creator, not the actor.\n'
    '\tactorType, actorID := h.resolveActor(r, userID, workspaceID)\n'
    + RESOLUTION_ANCHOR
)
ISSUE_ANCHOR = '\t\th.publish(protocol.EventIssueAttachmentsChanged, workspaceID, "member", userID, map[string]any{\n'
ISSUE_REPLACEMENT = '\t\th.publish(protocol.EventIssueAttachmentsChanged, workspaceID, actorType, actorID, map[string]any{\n'
COMMENT_ANCHOR = '\t\t\th.publish(protocol.EventCommentUpdated, workspaceID, "member", userID, map[string]any{\n'
COMMENT_REPLACEMENT = '\t\t\th.publish(protocol.EventCommentUpdated, workspaceID, actorType, actorID, map[string]any{\n'
PATCHED_MARKER = 'EventIssueAttachmentsChanged, workspaceID, actorType, actorID'


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one upstream marker, found {count}')
    return source.replace(old, new, 1)


def apply(root: Path) -> None:
    path = Path(root) / FILE
    source = path.read_text()
    if PATCHED_MARKER in source:
        raise SystemExit('attachment delete actor: already patched')
    # Validate every anchor before any write.
    for label, anchor in (('resolution', RESOLUTION_ANCHOR), ('issue event', ISSUE_ANCHOR), ('comment event', COMMENT_ANCHOR)):
        if source.count(anchor) != 1:
            raise SystemExit(f'attachment delete actor: {label} marker changed upstream')
    source = replace_once(source, RESOLUTION_ANCHOR, RESOLUTION_REPLACEMENT, 'resolution')
    source = replace_once(source, ISSUE_ANCHOR, ISSUE_REPLACEMENT, 'issue event')
    source = replace_once(source, COMMENT_ANCHOR, COMMENT_REPLACEMENT, 'comment event')
    path.write_text(source)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    args = parser.parse_args()
    apply(Path(args.root))


if __name__ == '__main__':
    main()
