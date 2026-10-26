// No SDK dependency. Credentials stay server-side and never appear in errors.
import { sweep } from './cleanup-worker.mjs';
export function createGateway({ baseUrl, anonKey, serviceKey, cleanupEnabled = false, fetcher = fetch }) {
  const origin = new URL(baseUrl).origin;
  async function call(path, key, body, method = 'POST') {
    const response = await fetcher(origin + path, { method, headers: { apikey: anonKey, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('attachment operation unavailable');
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  const rpc = (name, key, body = {}) => call('/rest/v1/rpc/' + name, key, body);
  const encoder = new TextEncoder();
  const key = () => crypto.subtle.importKey('raw', encoder.encode(serviceKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const decode = text => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  async function capability(payload) {
    if (!serviceKey) throw new Error('gateway identity unavailable');
    const data = encode(encoder.encode(JSON.stringify(payload)));
    const signature = await crypto.subtle.sign('HMAC', await key(), encoder.encode('attachment-media-v1:' + data));
    return data + '.' + encode(new Uint8Array(signature));
  }
  async function redeem(request) {
    const cap = new URL(request.url).searchParams.get('cap') || '';
    if (cap.length > 4096 || !serviceKey) throw new Error('invalid capability');
    const [data, signature, extra] = cap.split('.');
    if (!data || !signature || extra || !await crypto.subtle.verify('HMAC', await key(), decode(signature), encoder.encode('attachment-media-v1:' + data))) throw new Error('invalid capability');
    const payload = JSON.parse(new TextDecoder().decode(decode(data)));
    if (!['preview', 'download'].includes(payload.intent) || !Number.isInteger(payload.exp) || payload.exp <= Date.now()/1000) throw new Error('expired capability');
    const access = await rpc('attachment_redeem', serviceKey, { p_module: payload.module, p_id: payload.id, p_user: payload.user, p_intent: payload.intent });
    if (!access?.enabled) throw new Error('attachment unavailable');
    const objectPath = access.bucket + '/' + access.key.split('/').map(encodeURIComponent).join('/');
    const upstream = await fetcher(origin + '/storage/v1/object/authenticated/' + objectPath, {
      headers: { apikey: anonKey, Authorization: 'Bearer ' + serviceKey, ...(request.headers.has('Range') ? { Range: request.headers.get('Range') } : {}) },
      redirect: 'error', signal: AbortSignal.timeout(90000)
    });
    if (![200,206].includes(upstream.status)) throw new Error('attachment unavailable');
    const disposition = payload.intent === 'download' ? 'attachment' : 'inline';
    const safeName = encodeURIComponent(access.filename).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16));
    const headers = new Headers({ 'Content-Type': upstream.headers.get('Content-Type') || 'application/octet-stream', 'Content-Disposition': disposition + "; filename*=UTF-8''" + safeName, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox allow-scripts", 'Referrer-Policy': 'no-referrer' });
    for (const name of ['Content-Length','Content-Range','Accept-Ranges']) if (upstream.headers.has(name)) headers.set(name,upstream.headers.get(name));
    return new Response(upstream.body, { status: upstream.status, headers });
  }
  async function remove(item) {
    if (!['taskflow-attachments', 'board-task-attachments'].includes(item.bucket) || !item.object_key || /(^|\/)\.\.(\/|$)/.test(item.object_key)) throw new Error('invalid storage claim');
    const args = { p_module: item.module, p_id: item.attachment_id, p_token: item.delete_token };
    try {
      await call('/storage/v1/object/' + item.bucket, serviceKey, { prefixes: [item.object_key] }, 'DELETE');
      const verify = await fetcher(origin + '/storage/v1/object/info/' + item.bucket + '/' + item.object_key.split('/').map(encodeURIComponent).join('/'), {
        headers: { apikey: anonKey, Authorization: 'Bearer ' + serviceKey }, redirect: 'error', signal: AbortSignal.timeout(10000)
      });
      if (verify.status !== 404) throw new Error('object deletion not verified');
      await rpc('attachment_finish_delete', serviceKey, args);
    } catch {
      await rpc('attachment_record_failure', serviceKey, args).catch(() => {});
      throw new Error('attachment deletion not confirmed');
    }
  }
  return async function handle(request) {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
    if (request.method === 'GET') { try { return await redeem(request); } catch { return reply({ error: '附件連結無效或已到期。' }, 404); } }
    if (request.method !== 'POST') return reply({ error: 'method not allowed' }, 405);
    const bearer = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!bearer) return reply({ error: 'authentication required' }, 401);
    try {
      const body = await request.json();
      if (body.action === 'sweep') {
        // Disabled by default. Only the server identity can invoke scheduling.
        if (!cleanupEnabled || bearer !== serviceKey) return reply({ error: 'cleanup disabled' }, 403);
        return reply(await sweep({ enabled: true, claim: () => rpc('attachment_claim_expired', serviceKey), remove, finish: async () => {}, limit: 25 }));
      }
      // Verify the JWT server-side before any privileged storage operation.
      const user = await call('/auth/v1/user', bearer, undefined, 'GET');
      if (body.action === 'status') return reply(await rpc('attachment_status', bearer, { p_module: body.module, p_id: body.id }));
      if (body.action === 'capacity') return reply(await rpc('attachment_capacity', bearer));
      if (body.action === 'delete') {
        const item = await rpc('attachment_request_delete', bearer, { p_module: body.module, p_id: body.id, p_confirm: body.confirm === true });
        if (item?.enabled === false) return reply({ enabled: false });
        await remove(item);
        return reply({ deleted: true });
      }
      const intent = body.intent || 'preview';
      if (!['preview', 'download', 'verify'].includes(intent)) return reply({ error: 'invalid intent' }, 400);
      const access = await rpc('attachment_access', bearer, { p_module: body.module, p_id: body.id, p_intent: intent });
      if (!access.enabled) return reply({ enabled: false });
      const objectPath = access.bucket + '/' + access.key.split('/').map(encodeURIComponent).join('/');
      if (intent === 'verify') {
        const info = await call('/storage/v1/object/info/' + objectPath, serviceKey, undefined, 'GET');
        return reply({ size: info.size });
      }
      const ttl = Math.min(60, access.ttl);
      const cap = await capability({ module: body.module, id: body.id, user: user.id, intent, exp: Math.floor(Date.now()/1000) + ttl });
      return reply({ enabled: true, url: origin + '/functions/v1/attachment-lifecycle?cap=' + cap, expires_in: ttl });
    } catch {
      // Uniform denial, never forward database/provider JSON, URLs or tokens.
      return reply({ error: '附件無法使用；預覽可能已到期，請嘗試下載或重新登入。' }, 404);
    }
  };
}
