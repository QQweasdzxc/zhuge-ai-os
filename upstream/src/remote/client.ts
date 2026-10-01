import type { RemoteAppKind, RemoteControlRequest, RemoteControlResponse } from "./types";
import { readRemoteEndpoint } from "./endpoint";

export interface SendRemoteControlRequestOptions {
  dataDir: string;
  appKind?: RemoteAppKind;
}

export async function sendRemoteControlRequest(
  request: RemoteControlRequest,
  options: SendRemoteControlRequestOptions,
): Promise<RemoteControlResponse> {
  const endpoint = await readRemoteEndpoint(options.dataDir, options.appKind);
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/rpc`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${endpoint.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });
  const payload = await response.json() as RemoteControlResponse;
  if (!response.ok && payload.ok !== false) {
    return {
      ok: false,
      error: {
        code: "remote_http_error",
        message: `Remote control request failed with HTTP ${response.status}.`,
        details: payload,
      },
    };
  }
  return payload;
}
