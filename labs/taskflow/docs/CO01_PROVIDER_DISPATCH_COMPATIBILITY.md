# CO-01 / CO-02 Agent Reporting Correlation Matrix

This is a review fixture for PR #114 against the current CO-01 PR #116 provider seam. It is not an end-to-end provider claim.

| Correlation | CO-02 Agent Reporting | CO-01 Provider Dispatch (#116 current seam) | Trust rule |
|---|---|---|---|
| TaskFlow Issue | `issue_id` / `taskflow_issue_id` | `ProviderDispatchRequest.IssueID` | Server-resolved native Issue scope |
| Workspace | `workspace_id` | `ProviderDispatchRequest.WorkspaceID` | Server Auth and Workspace ACL |
| Executor | `executor_id` / `current_executor` | `ProviderDispatchRequest.ExecutorID` | Server-selected assignee |
| Dispatch | `dispatch_id` | No field in current request/result | BLOCKED until durable dispatch correlation is supplied |
| Provider | `provider` | `ProviderDispatchRequest.Provider` | Official adapter allowlist |
| Task | Native TaskFlow task identity | `ProviderDispatchRequest.TaskID` | Native TaskFlow source only |
| Provider Run | `provider_run_id` | `ProviderDispatchResult.ProviderRunID` | Only official provider response; never Task ID |
| Session | `session_id` | No field in current request/result | ACK/session reporting remains UNVERIFIED |
| ACK | `ack_event_id` plus server attestation | `ProviderDispatchResult.AckVerified` | Boolean alone is insufficient for event correlation |
| Lease/Fencing | `lease_id`, `fencing_epoch` | No field in current provider seam | Native durable lease/fence must be supplied before writer handoff |
| Event | `event_id`, sequence | No field in current provider seam | Server atomic event claim required |
| Stop/Handoff | `stop_handoff_evidence` | No field in current provider seam | Server runtime readback required |

The current CO-01 seam can be consumed for Issue, Workspace, Executor, Provider, Task and (after an official verified response) Provider Run. It cannot establish CO-02 ACK event, Session, Dispatch, Lease/Fencing or Stop/Handoff evidence. Those fields remain `ACK_UNVERIFIED`, `PROVIDER_BLOCKED` or `NATIVE_WRITE_UNWIRED` until the authoritative source supplies them.
