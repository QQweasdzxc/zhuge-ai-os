import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { readRemoteEndpoint, remoteEndpointPath } from "./endpoint";
import { sendRemoteControlRequest } from "./client";
import { startRemoteControlServer, type RemoteControlServer } from "./server";

describe("remote control server", () => {
  const tempDirs: string[] = [];
  const servers: RemoteControlServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close().catch(() => {})));
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test("writes an endpoint and serves authenticated RPC requests", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gloom-remote-"));
    tempDirs.push(dataDir);
    const server = await startRemoteControlServer({
      dataDir,
      appKind: "tui",
      handle: async (request) => ({ ok: true, data: { type: request.type } }),
    });
    servers.push(server);

    const defaultEndpoint = await readRemoteEndpoint(dataDir);
    const tuiEndpoint = await readRemoteEndpoint(dataDir, "tui");
    expect(defaultEndpoint.port).toBe(server.endpoint.port);
    expect(tuiEndpoint.token).toBe(server.endpoint.token);

    const response = await sendRemoteControlRequest({ type: "schema" }, { dataDir, appKind: "tui" });
    expect(response).toEqual({ ok: true, data: { type: "schema" } });
  });

  test("removes endpoint files on close", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gloom-remote-"));
    tempDirs.push(dataDir);
    const server = await startRemoteControlServer({
      dataDir,
      appKind: "desktop",
      handle: async () => ({ ok: true, data: null }),
    });
    await server.close();

    expect(await Bun.file(remoteEndpointPath(dataDir)).exists()).toBe(false);
    expect(await Bun.file(remoteEndpointPath(dataDir, "desktop")).exists()).toBe(false);
  });
});
