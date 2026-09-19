# Fubon read-only Node adapter proof

This is an isolated TASK-043 / #22 proof surface. It is not a Product Runtime,
does not write Investment data, and has no order, modify, cancel, or streaming
entry point.

## Fixed dependency and runtime

- SDK: official `fubon-neo` `2.3.0`
- Distribution: official local `.tgz` in `vendor/fubon-neo-2.3.0.tgz`
- Node: `>=16` (the supported runtime documented by Fubon)
- Integrity: `SDK_MANIFEST.json` records the official archive and package SHA-256

The package exports the SDK and its REST client, but the official native SDK
constructor itself starts a control WebSocket transport. Because B1 explicitly
forbids establishing any WebSocket, this proof currently fails closed at
`sdk_instantiate` and does not read credentials or attempt login. It must not be
changed to bypass that guard without a PM architecture decision.

## Local developer checks

From this directory:

```sh
npm install --ignore-scripts
npm test
npm run proof:load-only
```

`proof:load-only` only imports the native SDK and verifies its constructor
export. It does not instantiate, read credentials, login, call Fubon, or create
a network connection.

## Credential boundary

The full proof reads these names only from the server-side process environment:

- `FUBON_API_PERSONAL_ID`
- `FUBON_API_KEY`
- `FUBON_CERT_PASSWORD`
- `FUBON_CERT_FILE_BASE64`

Values must be injected by the PM-controlled secret manager or one-shot Node
runtime. Do not put them in Source, Git, ZIP, browser storage, logs, task text,
or command history. The certificate value is base64 of the exported certificate
bytes; whitespace is ignored and the decoded file is written with mode `0600`
to a random OS temporary path, then removed in `finally` cleanup.

The full proof is currently blocked before this boundary because SDK
instantiation starts the forbidden transport. If PM later approves that
transport boundary, missing values will produce a sanitized
`CREDENTIALS_NOT_INJECTED` result and will not attempt login. The adapter never
prints the values, tokens, raw SDK responses, full account identifiers, or
certificate path.

## Read-only proof sequence

`SDK load -> SDK instantiate [currently blocked by no-WebSocket guard] ->
credential boundary -> API-key login -> account list -> inventories -> REST
latest quote (2330) -> sanitized result -> cleanup`.

The result exposes only SDK/version metadata, masked account evidence, inventory
row/symbol counts, normalized quote fields, and the explicit mutation/streaming
guards. It does not write Zhuge Product Data or call order APIs.

The successful login/account/inventory/quote proof still requires PM-controlled
credential injection. This repository does not contain those values.
