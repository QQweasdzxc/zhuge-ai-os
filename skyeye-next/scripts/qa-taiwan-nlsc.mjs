import { probeNlscTile } from '../server/providers/taiwan/nlsc.js';

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10_000);
try {
  const result = await probeNlscTile({
    layer: process.env.NLSC_LAYER || 'emap',
    z: 7,
    x: 106,
    y: 53,
    signal: controller.signal,
  });
  // Keep the probe safe to paste into an evidence record: URL, status and
  // content type only; never print response bodies or request headers.
  console.log(
    JSON.stringify(
      {
        providerId: 'taiwan.nlsc.wmts',
        endpointHost: new URL(result.url).host,
        endpointPath: new URL(result.url).pathname,
        httpStatus: result.status,
        contentType: result.contentType,
        available: result.ok,
        credentialUsed: false,
        rawResponseReturned: false,
      },
      null,
      2,
    ),
  );
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  console.log(
    JSON.stringify(
      {
        providerId: 'taiwan.nlsc.wmts',
        available: false,
        status:
          error?.name === 'AbortError' ? 'timeout' : 'provider_unavailable',
        errorCategory: error?.name === 'AbortError' ? 'timeout' : 'network',
        credentialUsed: false,
        rawResponseReturned: false,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
