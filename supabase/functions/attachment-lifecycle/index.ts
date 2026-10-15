import { createGateway } from '../../../labs/attachments/gateway.mjs';
const baseUrl = Deno.env.get('SUPABASE_URL') || '';
const handler = createGateway({
  baseUrl,
  anonKey: Deno.env.get('SUPABASE_ANON_KEY') || '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  cleanupEnabled: Deno.env.get('ATTACHMENT_CLEANUP_ENABLED') === 'true',
});
Deno.serve(async request => {
  const allowed = (Deno.env.get('ATTACHMENT_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin');
  if (origin && !allowed.includes(origin)) return new Response(null, { status: 403 });
  const cors = origin ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } : {};
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const response = await handler(request);
  for (const [key,value] of Object.entries(cors)) response.headers.set(key,value);
  return response;
});
