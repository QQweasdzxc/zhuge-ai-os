# TASK-086｜Shared Task Attachment AI Reader

## Contract

`zhuge-attachment-ai-input-v1` is produced by the existing Shared Attachment
Context reader. It contains only bounded text or in-memory image data plus
source/freshness evidence. Storage paths, signed URLs, browser tokens, and
Task-write commands are never sent to the AI Reader.

`task-attachment-ai-read` is a read-only authenticated Edge adapter. It returns
`zhuge-task-attachment-ai-read-v1` with a bounded plain-language summary,
observations, uncertainties, and suggested questions. It never writes Product
Data or Task state.

## Server boundary

The only required secret is the existing protected `OPENAI_API_KEY` Edge
secret. It is not read by the browser and must not be placed in Source, Git,
ZIP, localStorage, or response payloads. The authenticated Shared Gateway
invokes the function and maintains the existing session refresh boundary.

## Evidence states

- `ready`: provider returned a validated structured result.
- `insufficient_evidence`: the attachment was empty, unsupported, or the
  provider returned no usable result.
- `unavailable`: the protected reader is not deployed/configured, timed out,
  or the provider failed. The original attachment evidence remains visible.

The UI deliberately does not turn an unavailable reader into a guessed answer.
Deployment and provider-secret setup remain separate Cloud/PM gates; source and
Developer QA can run without them.
