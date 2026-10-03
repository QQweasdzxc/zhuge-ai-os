
<!-- BACKLOG.MD GUIDELINES START -->
<!-- backlog.md-instructions-version: 1.49.3 -->
<CRITICAL_INSTRUCTION>

## Backlog.md Workflow

This project uses Backlog.md for task and project management.

**For every user request in this project, run `backlog instructions overview` before answering or taking action.**

Use the overview for read/search guidance. Zhuge AI OS TASK identity takes
precedence over the generic CLI recommendation to create a local task:
- Only a TASK ID already present in the formal Board/DB and visible to PM may
  be used as `TASK-xxx`. Backlog is a local tracking mirror, not an ID authority.
- Never run task creation to allocate a formal TASK number locally. Without a
  verified formal ID, use a descriptive scope and existing QA/documentation.
- Apply lifecycle guides only to an existing, verified formal TASK mirror.
- PM-authorized removal of an invalid local TASK record is identity correction,
  not completion or creation of a replacement numbered task.

Before task lifecycle actions, read the matching detailed guide:
- `backlog instructions task-creation` before creating or splitting tasks
- `backlog instructions task-execution` before planning, changing status or assignee, adding a plan or implementation notes, or implementing task work
- `backlog instructions task-finalization` before checking acceptance criteria, writing final summaries, or moving tasks to terminal statuses

Use `backlog <command> --help` before running unfamiliar commands. Help shows options, fields, and examples.

Do not edit Backlog task, draft, document, decision, or milestone markdown files directly. Use the `backlog` CLI so metadata, relationships, and history stay consistent.

</CRITICAL_INSTRUCTION>
<!-- BACKLOG.MD GUIDELINES END -->

## Release / artifact mandatory gate

Follow the MATERIAL SOURCE CHANGE RULE in docs/10_GOVERNANCE/RELEASE.md and
tools/release-governance.js. Any completed material Source change for delivery,
backup, review acceptance, Candidate or PM handoff must enter a new Formal Build
Cycle: new BUILD_ID → synchronized Source identity → QA → new FullSource ZIP.
Reuse an old Build only for unchanged-source artifact-only rename/relocate/
re-verification. Review/QA Backup are not exceptions. BUILD_IDENTITY_STALE is
HARD STOP; never bypass the existing gate, replace origin/main with a local
work commit or add a second baseline/Build registry.
