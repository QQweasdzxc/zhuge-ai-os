/**
 * Streaming capability calls from a renderer that does not own the capability.
 *
 * `CapabilityInvoker` covers the request/response half: ask, get an answer.
 * A capability that emits as it works (a model writing a token at a time, a
 * sign-in reporting a device code) needs the other half, and on the desktop
 * that crosses a process boundary: panes render in the view, while the
 * capability runs in the Bun process with the credentials and the sockets.
 *
 * The renderer installs the client at startup, the same way it installs the
 * broker remote client. Elsewhere there is nothing to install: the terminal
 * runs both halves in one process, and the hosted web app has no Bun process
 * at all, so a plugin that finds no client here reports its service as
 * unavailable rather than pretending.
 */

export interface CapabilityStreamSubscription {
  capabilityId: string;
  operationId: string;
  payload: unknown;
  onEvent: (event: unknown) => void;
  onError?: (error: unknown) => void;
}

export interface CapabilityStreamClient {
  invoke<T = unknown>(capabilityId: string, operationId: string, payload: unknown): Promise<T>;
  /** Returns the unsubscribe function; calling it ends the stream on the host side too. */
  subscribe(subscription: CapabilityStreamSubscription): () => void;
}

let capabilityStreamClient: CapabilityStreamClient | null = null;

export function setCapabilityStreamClient(client: CapabilityStreamClient | null): void {
  capabilityStreamClient = client;
}

export function getCapabilityStreamClient(): CapabilityStreamClient | null {
  return capabilityStreamClient;
}
