# TASK-074 Remote MCP Server

This is a bounded Streamable HTTP MCP adapter. It supports the current
stateless MCP `2026-07-28` discovery/header flow and the legacy 2025-era
initialize flow for Inspector fallback. It does not replace the
engineering Actor Broker, `engineering-transition` v36, the canonical AI Board
RPCs, or the Co runtime.

## Contract

Preferred private connection: OpenAI Secure MCP Tunnel. ChatGPT Developer
Mode selects the tunnel by `tunnel_id`; the tunnel client forwards Streamable
HTTP requests to the backend function from the protected runtime. No public
mTLS proxy is required for this path.

Backend MCP URL for the tunnel client:

```text
https://<supabase-project>.supabase.co/functions/v1/zhuge-task-074-mcp/mcp
```

The backend function accepts the request only when the protected transport
supplies `x-zhuge-mcp-proxy-auth` with the server-side
`MCP_TRUSTED_PROXY_SECRET`. With Secure MCP Tunnel, configure that existing
header through `tunnel-client` static MCP headers; do not add a second auth
scheme.

RFC 9728 Protected Resource Metadata is available without the proxy secret at:

```text
GET https://<supabase-project>.supabase.co/functions/v1/zhuge-task-074-mcp/.well-known/oauth-protected-resource/mcp
```

The response identifies the exact MCP resource URL and advertises an empty
OAuth bearer-method list because this server uses the existing protected
proxy-secret header rather than an OAuth authorization server. No
`authorization_servers` value is advertised because this surface does not
issue or delegate OAuth tokens.

Example profile fragment (secret value is never written here):

```yaml
mcp:
  server_urls:
    - channel: main
      url: https://<supabase-project>.supabase.co/functions/v1/zhuge-task-074-mcp/mcp
  extra_headers:
    X-Zhuge-Mcp-Proxy-Auth: env:MCP_TRUSTED_PROXY_SECRET
```

`MCP_TRUSTED_PROXY_SECRET` must be injected separately into the protected
Edge runtime and the tunnel-client runtime. It is only an ingress secret;
the Broker caller private key and GPT Actor Token remain inside the Edge
runtime. Do not place any secret in this repository, ChatGPT tool arguments,
or MCP responses.

The tunnel client must be able to reach the configured HTTP URL and OpenAI
over outbound HTTPS. Keep the tunnel client running and healthy before
creating the ChatGPT Developer Mode app.

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
MCP_RESOURCE_URL=https://<supabase-project>.supabase.co/functions/v1/zhuge-task-074-mcp/mcp
```

`MCP_RESOURCE_URL` is non-secret. If omitted, the function derives the
canonical resource from `SUPABASE_URL` and the function slug.

`SUPABASE_SERVICE_ROLE_KEY` is not read by this function. It remains only in
the existing Broker / transition runtimes.

## Developer QA with MCP Inspector

Run the Inspector against an isolated local harness or a separately deployed
non-production endpoint with the proxy-auth header. Verify initialize, tools
list, every schema, invalid arguments, and the authorization failure path.
Do not treat localhost, the Inspector, or a CLI run as ChatGPT Runtime PASS.

The ChatGPT registration gate starts after the tunnel exists, is associated
with the target ChatGPT workspace, and the tunnel client reports ready. The
OpenAI tunnel documentation requires a `tunnel_id`, a tunnel runtime API key,
and a reachable MCP server URL; ChatGPT Developer Mode then selects the
tunnel rather than receiving a public `server_url`.

## User runtime action: Secure MCP Tunnel

This repository does not create the tunnel or handle the tunnel API key.

1. In OpenAI Platform tunnel settings, create or select one tunnel and record
   its `tunnel_id`.
2. Associate it with the target ChatGPT workspace and grant the operator
   Tunnels Read + Use (Manage is needed only to create/edit the tunnel).
3. Run the current official `tunnel-client` in the protected runtime with:
   `CONTROL_PLANE_TUNNEL_ID`, `CONTROL_PLANE_API_KEY`, and the MCP HTTP URL
   above.
4. Configure the static header shown above using an environment-backed value;
   never put the secret in argv, YAML, Git, or ChatGPT.
5. Run `tunnel-client doctor --profile <profile> --explain` and confirm the
   client is healthy/ready.
6. In ChatGPT Developer Mode, create an app, choose **Tunnel**, select or
   enter the `tunnel_id`, scan the tools, and invoke `task074_inspect`.

Until these user-side steps are completed, the source and Inspector checks
are PASS but the ChatGPT Tool Surface / E2E gate remains unverified.
