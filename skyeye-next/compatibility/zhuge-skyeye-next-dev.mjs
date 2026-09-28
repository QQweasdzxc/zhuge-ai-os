#!/usr/bin/env node

/**
 * Isolated candidate mount for the frozen God's Eye View snapshot.
 *
 * The upstream application still runs at its own origin/root. This small
 * compatibility server only gives it a Zhuge-visible `/skyeye-next/` entry
 * point and proxies the upstream same-origin API/static requests. It does not
 * rewrite the upstream UI, layer catalog, provider adapters, or data model.
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const candidateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mountPath = '/skyeye-next';
const publicHost = process.env.ZHUGE_SKYEYE_NEXT_HOST || process.env.HOST || '127.0.0.1';
const publicPort = Number(process.env.ZHUGE_SKYEYE_NEXT_PORT || process.env.PORT || 4174);
const internalPort = publicPort + 1;

if (!Number.isInteger(publicPort) || publicPort < 1 || publicPort > 65534) {
  throw new Error(`Invalid candidate port: ${publicPort}`);
}

function sendHealth(res) {
  const payload = JSON.stringify({
    candidate: 'skyeye-next',
    route: `${mountPath}/`,
    upstream: 'gods-eye-view',
    upstream_commit: 'b210ab0fe4d71c7faa0268134e0aa5f3c53fc7fe',
    runtime_boundary: 'isolated-upstream-application',
    product_data: 'unchanged',
    provider_behavior: 'upstream-native',
  });
  res.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function proxyToUpstream(req, res, targetPath) {
  const headers = { ...req.headers };
  headers.host = `127.0.0.1:${internalPort}`;
  headers['x-forwarded-host'] = req.headers.host || `${publicHost}:${publicPort}`;
  headers['x-forwarded-prefix'] = mountPath;

  const upstreamRequest = http.request(
    {
      host: '127.0.0.1',
      port: internalPort,
      method: req.method,
      path: targetPath,
      headers,
    },
    (upstreamResponse) => {
      res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(res);
    },
  );

  upstreamRequest.on('error', (error) => {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`SkyEye Next upstream unavailable: ${error.message}`);
  });

  req.on('aborted', () => upstreamRequest.destroy());
  req.pipe(upstreamRequest);
}

const previousPort = process.env.PORT;
process.env.PORT = String(internalPort);

const upstream = await createServer({
  root: candidateRoot,
  configFile: path.join(candidateRoot, 'vite.config.js'),
  server: {
    host: '127.0.0.1',
    port: internalPort,
    strictPort: true,
    hmr: false,
  },
});

if (previousPort === undefined) delete process.env.PORT;
else process.env.PORT = previousPort;

await upstream.listen();

const gateway = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `${publicHost}:${publicPort}`}`);

  if (requestUrl.pathname === '/__zhuge_skyeye_next/health') {
    sendHealth(res);
    return;
  }

  if (requestUrl.pathname === mountPath) {
    res.writeHead(302, { location: `${mountPath}/` });
    res.end();
    return;
  }

  if (requestUrl.pathname === '/' || requestUrl.pathname === '') {
    res.writeHead(302, { location: `${mountPath}/` });
    res.end();
    return;
  }

  // The upstream application intentionally uses root-relative `/api`, asset,
  // and Vite module URLs. The isolated gateway is its own origin, so proxying
  // those requests unchanged preserves upstream behavior without touching the
  // existing Zhuge SkyEye runtime.
  proxyToUpstream(req, res, `${requestUrl.pathname}${requestUrl.search}`);
});

const close = async (signal) => {
  gateway.close();
  await upstream.close();
  process.exit(signal ? 0 : 1);
};

process.once('SIGINT', () => void close('SIGINT'));
process.once('SIGTERM', () => void close('SIGTERM'));

gateway.listen(publicPort, publicHost, () => {
  console.log(`SkyEye Next candidate: http://${publicHost}:${publicPort}${mountPath}/`);
  console.log(`SkyEye Next health: http://${publicHost}:${publicPort}/__zhuge_skyeye_next/health`);
  console.log(`Upstream snapshot: b210ab0fe4d71c7faa0268134e0aa5f3c53fc7fe`);
});
