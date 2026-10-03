# Naming Standard

## Product names

- Product: `Zhuge AI OS`
- AI assistant: `Mr. KM`
- Module names: `WorkLog`, `Investment`, `Travel`, `HR`, `Knowledge`
- Repository: `zhuge-ai-os`

## UI language

User-facing UI uses Traditional Chinese (`zh-TW`). English is reserved for
brand names, API identifiers, code, and reviewer-facing legal text where
required.

## Folder names

Use lowercase module directories: `modules/worklog/` and
`modules/investment/`. Do not create new `*-workspace` repositories or module
folders. Existing internal compatibility identifiers are not renamed during a
runtime-preserving migration.

## Work identity and artifacts

TASK IDs are allocated only by the formal Board/DB authority and must be visible
to PM; local Backlog cannot create formal TASK numbers. Without verified formal
identity use a descriptive Scope. FullSource naming is mandatory:
`YYYYMMDD-HHMM_Zhuge_AI_OS-v<Version>-<Scope>-FullSource-<Candidate|Review|QA-Backup>.zip`.
Candidate prefix is Candidate Build; Review/QA Backup prefix is Artifact Created
At (Asia/Taipei). Complete rules and the existing tool authority are in
[RELEASE.md](../10_GOVERNANCE/RELEASE.md); do not duplicate a release registry.
