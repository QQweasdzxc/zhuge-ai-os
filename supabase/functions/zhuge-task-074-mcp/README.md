# TASK-074 Remote MCP Server

This is a bounded Streamable HTTP MCP adapter. It supports the current
stateless MCP `2026-07-28` discovery/header flow and the legacy 2025-era
initialize flow for Inspector fallback. It does not replace the
engineering Actor Broker, `engineering-transition` v36, the canonical AI Board
RPCs, or the Co runtime.

## Contract

Public registration URL:

```text
https://<protected-mtls-proxy-host>/mcp
```

The proxy must validate the OpenAI-managed MCP client certificate and then
forward to the backend function:

```text
https://<supabase-project>.supabase.co/functions/v1/zhuge-task-074-mcp/mcp
```

The backend function accepts the request only when the proxy supplies
`x-zhuge-mcp-proxy-auth` with the server-side `MCP_TRUSTED_PROXY_SECRET`.
Do not register the raw Supabase function URL in ChatGPT; Supabase Edge does
not terminate the OpenAI mTLS client certificate for this contract.

## Tools

Only these bounded tools are exposed:

- `task074_gpt_claim`
- `task074_plan_handoff_co`
- `task074_gpt_review`
- `task074_inspect`
- `task074_renew_gpt_claim`
- `task074_release_gpt_claim`

There is deliberately no Co claim tool. Co remains the existing canonical Co
runtime and the MCP server never impersonates Co. Every write is sent through
the existing Broker -> short-lived GPT Actor Token -> `engineering-transition`
path. The Actor Token and Broker caller private key never appear in MCP output.

## Server-side configuration

Required secrets/configuration in the protected Edge runtime:

```text
MCP_TRUSTED_PROXY_SECRET
ENGINEERING_BROKER_CALLER_PRIVATE_JWK
ENGINEERING_BROKER_CALLER_KEY_ID=chatgpt-engineering-connector-1
SUPABASE_URL
```

Optional URLs default to the same Supabase project:

```text
ENGINEERING_ACTOR_BROKER_URL
ENGINEERING_TRANSITION_URL
```

`SUPABASE_SERVICE_ROLE_KEY` is not read by this function. It remains only in
the existing Broker / transition runtimes.

## Developer QA with MCP Inspector

Run the Inspector against an isolated local harness or a separately deployed
non-production endpoint with the proxy-auth header. Verify initialize, tools
list, every schema, invalid arguments, and the authorization failure path.
Do not treat localhost, the Inspector, or a CLI run as ChatGPT Runtime PASS.

The ChatGPT registration gate starts only after an HTTPS proxy endpoint with
OpenAI mTLS validation is available.
