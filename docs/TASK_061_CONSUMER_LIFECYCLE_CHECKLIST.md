# TASK-061｜Canonical C Consumer Lifecycle Checklist

Status: NOT VERIFIED — working checklist only; no item is PASS without the
corresponding evidence. Cloud migration/RPC application and PM QA remain
separate gates.

## Scope

This checklist covers the reusable lifecycle for any C Consumer. It does not
create a GAS-specific or Investment-specific Board implementation, and it does
not authorize Cloud mutation, formal Investment writes, deployment, or a
Candidate artifact.

## Checklist

| State | Requirement | Evidence required |
| --- | --- | --- |
| NOT VERIFIED | Consumer creation accepts formal ownership/route | Authenticated RPC read-back |
| NOT VERIFIED | Creation atomically provisions one C Consumer, default workspaces, and adoption | RPC transaction/read-back |
| NOT VERIFIED | Creation automatically composes Module A | Module A source identity + runtime evidence |
| NOT VERIFIED | Consumer uses the unique Module C | Module C source identity + runtime evidence |
| NOT VERIFIED | Consumer runtime hides C Operational Motherboard / Publish Pipeline / C management data | Consumer runtime inspection |
| NOT VERIFIED | Those management surfaces remain C Mother Template-only | C Mother Template runtime inspection |
| NOT VERIFIED | Board rename works through a controlled path | RPC read-back + audit |
| NOT VERIFIED | Board ownership/route move works through a controlled path | Before/after route read-back + audit |
| NOT VERIFIED | Board archive is safe and reversible or explicitly bounded | RPC read-back + child preservation evidence |
| NOT VERIFIED | Board delete is safe and only permits an empty, archived Consumer | Rejection and success-path evidence |
| NOT VERIFIED | Move/rename preserve Board Instance ID | Before/after identity comparison |
| NOT VERIFIED | Move/rename preserve Card identity and data | Before/after card/source comparison |
| NOT VERIFIED | PM-created GAS Consumer remains the same Board Instance | Exact UUID read-back |
| NOT VERIFIED | GAS belongs to WorkLog → 庶務行政 | Route/read-back evidence |
| NOT VERIFIED | GAS composition is A + C + GAS Data | Source identity + runtime evidence |
| NOT VERIFIED | GAS prefix is GAS-xxx without renumbering existing identity | Registry/card read-back |
| NOT VERIFIED | Investment composition is A + C + Investment Data | Source identity + runtime evidence |
| NOT VERIFIED | Investment prefix remains IVTK-xxx | Registry/card read-back |
| NOT VERIFIED | Investment legacy projection/stable linkage is preserved | Cloud read-only evidence |
| NOT VERIFIED | Investment has no bespoke Portfolio/Board runtime | Source/runtime inspection |
| NOT VERIFIED | Investment old Watchlist route converges to the C workspace | Route/runtime evidence |
| NOT VERIFIED | Module A source identity is shared by all Consumers | Machine/source identity evidence |
| NOT VERIFIED | Module C source identity is shared by all Consumers | Machine/source identity evidence |
| NOT VERIFIED | Removed C capabilities do not reappear in WorkTodo | Root-cause test + runtime evidence |
| NOT VERIFIED | Desktop runtime QA passes | Signed runtime evidence |
| NOT VERIFIED | Mobile runtime QA passes | Signed narrow-viewport evidence |
| NOT VERIFIED | Reload and Cloud read-back preserve identity/data | Reload + read-back evidence |
| NOT VERIFIED | Relevant regression passes | Test output |
| NOT VERIFIED | Release Identity Alignment passes | Version/build/commit/time comparison |
| NOT VERIFIED | Product Completion is approved | Completion review evidence |
| NOT VERIFIED | Current Candidate ZIP and SHA-256 are generated once after completion | Artifact manifest/checksum |

## Current review gate

The repository currently contains a local draft of the required lifecycle
contract, but it has not been applied to Cloud. The next gate is PM approval of
the minimal migration/RPC contract after Code Review, Migration Review,
Contract Review, and targeted tests.

## Evidence rule

Automated source tests are not Cloud or PM acceptance evidence. Until the
corresponding runtime/read-back evidence exists, every item above remains
`NOT VERIFIED`.
