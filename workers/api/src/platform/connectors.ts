import { fail, object, text, unseal, seal, type PlatformEnv } from './core';
export const PROVIDERS = {
  'google-calendar': { label: 'Google Calendar', actions: ['calendar.create'], auth: 'oauth', scopes: 'https://www.googleapis.com/auth/calendar.events.owned' },
  'google-sheets': { label: 'Google Sheets', actions: ['sheets.append'], auth: 'oauth', scopes: 'https://www.googleapis.com/auth/spreadsheets' },
  gmail: { label: 'Gmail', actions: ['gmail.draft','gmail.send'], auth: 'oauth', scopes: 'https://www.googleapis.com/auth/gmail.compose' },
  telegram: { label: 'Telegram', actions: ['telegram.send'], auth: 'token' },
  todoist: { label: 'Todoist', actions: ['todoist.create'], auth: 'token' },
  notion: { label: 'Notion', actions: ['notion.create'], auth: 'token' },
  hubspot: { label: 'HubSpot', actions: ['hubspot.contact'], auth: 'token' },
  slack: { label: 'Slack', actions: ['slack.send'], auth: 'token' },
  'home-assistant': { label: 'Home Assistant', actions: ['home-assistant.service'], auth: 'token' },
  webhook: { label: 'Webhook / user-owned n8n / Teams workflow', actions: ['webhook.post'], auth: 'token' },
  mcp: { label: 'Trusted MCP (JSON HTTP transport)', actions: ['mcp.call'], auth: 'token' },
} as const;
export type Provider = keyof typeof PROVIDERS;
export type Evidence = { status: 'verified' | 'accepted'; destinationId: string; evidence: Record<string, unknown> };
export class DeliveryError extends Error {
  constructor(public outcome: 'failed' | 'unknown' | 'retry', message: string) { super(message); }
}
export function approvedUrl(raw: string, env: PlatformEnv): URL {
  let url: URL;
  try { url = new URL(raw); } catch { return fail(400,'Use a valid HTTPS endpoint.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || (url.port && url.port !== '443') || !/^[a-z0-9.-]+$/.test(host) || !host.includes('.') || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) || /^\d+\./.test(host)) fail(400,'Only public HTTPS hostnames without credentials, query strings or custom ports are allowed.');
  const allowed = (env.OUTBOUND_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(host)) fail(403,'This destination is not in the operator-managed outbound hostname allowlist.');
  return url;
}
/** Response bodies, redirects and wall-clock time are bounded. Provider errors never expose secrets. */
export async function jsonRequest(url: string, init: RequestInit = {}, write = false, requireJson = true): Promise<any> {
  try {
    const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if(response.status>=300&&response.status<400){await response.body?.cancel();throw new DeliveryError(write?'unknown':'failed','Provider redirect was blocked. No completion is claimed.');}
    if (response.status === 429) throw new DeliveryError('retry','Provider rate limit reached; bounded backoff scheduled.');
    if (!response.ok) throw new DeliveryError(write && response.status >= 500 ? 'unknown' : 'failed', `Provider returned HTTP ${response.status}. No completion is claimed.`);
    const reader = response.body?.getReader(); let total = 0; const chunks: Uint8Array[] = [];
    if (reader) while (true) { const part = await reader.read(); if (part.done) break; total += part.value.length; if (total > 262144) { await reader.cancel(); throw new DeliveryError(write ? 'unknown' : 'failed','Provider response exceeded the safety limit.'); } chunks.push(part.value); }
    const bytes = new Uint8Array(total); let at = 0; for (const chunk of chunks) { bytes.set(chunk,at); at += chunk.length; }
    const value = new TextDecoder().decode(bytes);
    return requireJson ? (value ? JSON.parse(value) : {}) : {httpStatus:response.status};
  } catch (error) {
    if (error instanceof DeliveryError) throw error;
    throw new DeliveryError(write ? 'unknown' : 'failed', write ? 'Delivery outcome is unknown. Inspect the destination before creating another action.' : 'Could not verify the connection.');
  }
}
const json = (body: unknown, token?: string): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
export function validatePayload(action: string, value: unknown) {
  const p = object(value); const out: Record<string, any> = {};
  const take = (key: string, max = 200, optional = false) => out[key] = text(p[key],key,max,optional);
  switch (action) {
    case 'local.notify': take('title',120); take('body',4000,true); break;
    case 'telegram.send': take('chatId'); take('text',4000); break;
    case 'slack.send': take('channel'); take('text',4000); break;
    case 'calendar.create':
      take('calendarId'); take('summary',120); take('description',4000,true); take('start'); take('end');
      if (!Number.isFinite(Date.parse(out.start)) || !Number.isFinite(Date.parse(out.end)) || Date.parse(out.end) <= Date.parse(out.start)) fail(400,'The event needs valid start/end dates with an end after the start.');
      out.start = new Date(out.start).toISOString(); out.end = new Date(out.end).toISOString(); break;
    case 'sheets.append':
      take('spreadsheetId'); take('range');
      if (!Array.isArray(p.rows) || !p.rows.length || p.rows.length > 50 || p.rows.some((r: any) => !Array.isArray(r) || r.length > 20 || r.some((v: any) => !['string','number','boolean'].includes(typeof v) || String(v).length > 1000))) fail(400,'Use 1–50 rows of bounded scalar values.');
      out.rows = p.rows; break;
    case 'gmail.draft': case 'gmail.send':
      take('to'); take('subject',200); take('body',6000);
      if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(out.to) || /[\r\n]/.test(out.subject)) fail(400,'Use one valid recipient and a single-line subject.'); break;
    case 'todoist.create': take('content',500); take('projectId',200,true); break;
    case 'notion.create': take('parentId'); take('title',120); take('body',1800,true); break;
    case 'hubspot.contact':
      take('email'); take('firstName',100,true); take('lastName',100,true);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) fail(400,'Use a valid contact email.'); break;
    case 'home-assistant.service':
      take('domain',60); take('service',60); take('entityId',120);
      if (![out.domain,out.service].every(v => /^[a-z_]+$/.test(v)) || !/^[a-z_]+\.[a-z0-9_]+$/.test(out.entityId)) fail(400,'Use a named Home Assistant domain, service and entity.');
      out.data = object(p.data || {}); break;
    case 'webhook.post': out.body = object(p.body); break;
    case 'mcp.call': take('name',120); out.arguments = object(p.arguments || {}); break;
    default: fail(400,'Unsupported action.');
  }
  if (JSON.stringify(out).length > 14000) fail(413,'Action payload is too large.');
  return out;
}
export async function validateConnection(env: PlatformEnv, provider: Provider, config: any, credentials: any) {
  if (!PROVIDERS[provider]) fail(400,'Unsupported provider.');
  if (PROVIDERS[provider].auth === 'oauth') fail(400,'Use the OAuth consent flow for this provider.');
  credentials = object(credentials); const clean: any = {};
  const token = provider === 'webhook' ? text(credentials.token,'Webhook shared secret',2048) : text(credentials.token,'Access token',2048);
  const secret: any = { token };
  if (['home-assistant','webhook','mcp'].includes(provider)) {
    const endpoint = approvedUrl(text(credentials.url,'Endpoint',2000),env);
    secret.url = endpoint.href.replace(/\/$/,''); clean.hostname = endpoint.hostname;
  }
  // OAuth credentials are obtained only by an authorization-code exchange. Manual tokens are user supplied.
  let proof: any;
  if (provider === 'telegram') {
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) fail(400,'Invalid Telegram bot token format.');
    proof = await jsonRequest(`https://api.telegram.org/bot${token}/getMe`);
    if (!proof.ok) fail(400,'Telegram did not verify this bot.');
  } else if (provider === 'slack') { proof = await jsonRequest('https://slack.com/api/auth.test',json({},token)); if (!proof.ok) fail(400,'Slack did not verify this token.'); }
  else if (provider === 'todoist') await jsonRequest('https://api.todoist.com/api/v1/projects',bearer(token));
  else if (provider === 'notion') await jsonRequest('https://api.notion.com/v1/users/me',{ headers:{Authorization:`Bearer ${token}`,'Notion-Version':'2022-06-28'} });
  else if (provider === 'hubspot') await jsonRequest('https://api.hubapi.com/crm/v3/objects/contacts?limit=1',bearer(token));
  else if (provider === 'home-assistant') await jsonRequest(`${secret.url}/api/`,bearer(token));
  else if (provider === 'mcp') {
    const rpc = await mcpSession(secret);
    const tools = await rpc.call('tools/list',{});
    if (!Array.isArray(tools?.result?.tools)) fail(400,'MCP endpoint did not return a JSON tool list.');
    clean.tools = tools.result.tools.slice(0,100).map((t: any) => text(t.name,'Tool name',120));
  }
  // A webhook is saved, not probed with a potentially side-effecting POST. Its first execution needs approval.
  clean.verification = provider === 'webhook' ? 'Not probed; endpoint allowlisted' : 'Credential probe succeeded';
  return { config: clean, secret };
}
async function mcpSession(credentials: any) {
  const headers = { Authorization:`Bearer ${credentials.token}`, 'Content-Type':'application/json', Accept:'application/json, text/event-stream', 'MCP-Protocol-Version':'2025-03-26' };
  // This adapter intentionally supports stateless JSON HTTP MCP endpoints. SSE/sessionful transports are not claimed.
  const call = (method: string, params: any, write = false) => jsonRequest(credentials.url,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:crypto.randomUUID(),method,params})},write);
  const init = await call('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'OneBrain',version:'1.0'}});
  if (!init.result || init.error) fail(400,'Only compatible stateless JSON MCP endpoints are supported.');
  await jsonRequest(credentials.url,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});
  return { call };
}
async function credential(env: PlatformEnv, row: any) {
  const value = await unseal(env,`${row.space_id}:${row.id}`,row.secret);
  if (PROVIDERS[row.provider as Provider].auth === 'oauth' && value.expiresAt < Date.now()+60000) {
    if (!value.refreshToken) throw new DeliveryError('failed','Connection expired. Reconnect before approving another action.');
    const token = await jsonRequest('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:value.refreshToken,client_id:env.GOOGLE_CLIENT_ID || '',client_secret:env.GOOGLE_CLIENT_SECRET || ''})});
    if (!token.access_token) throw new DeliveryError('failed','Google authorization expired. Reconnect.');
    value.token=token.access_token; value.expiresAt=Date.now()+Number(token.expires_in || 3600)*1000;
    await env.DB.prepare('UPDATE connections SET secret=?,updated_at=? WHERE id=? AND status=?').bind(await seal(env,`${row.space_id}:${row.id}`,value),Date.now(),row.id,'connected').run();
  }
  return value;
}
function rawMail(p: any) {
  const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  return b64(`To: ${p.to}\r\nSubject: =?UTF-8?B?${b64(p.subject)}?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(p.body)}`).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export async function executeConnector(env: PlatformEnv, row: any, action: string, p: any, executionId: string): Promise<Evidence> {
  if (!(PROVIDERS[row.provider as Provider]?.actions as readonly string[])?.includes(action)) throw new DeliveryError('failed','Action is not permitted by this connection.');
  const secret = await credential(env,row), token = secret.token;
  if (secret.url) approvedUrl(secret.url,env); // Re-evaluate the operator allowlist at execution time.
  if(!await env.DB.prepare("SELECT id FROM connections WHERE id=? AND space_id=? AND status='connected'").bind(row.id,row.space_id).first())throw new DeliveryError('failed','Connection was revoked before dispatch.');
  let result: any;
  if (action === 'telegram.send') {
    result = await jsonRequest(`https://api.telegram.org/bot${token}/sendMessage`,json({chat_id:p.chatId,text:p.text}),true);
    if (!result.ok || !result.result?.message_id) throw new DeliveryError('failed','Telegram rejected the message.');
    return {status:'accepted',destinationId:`${p.chatId}/${result.result.message_id}`,evidence:{provider:'telegram',acknowledged:true,delivery:'Not independently confirmed'}};
  }
  if (action === 'calendar.create') {
    // Google accepts a deterministic client-generated event ID: repeated delivery cannot duplicate the event.
    const eventId = executionId.replace(/[^a-v0-9]/g,'').slice(0,64);
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(p.calendarId)}/events`;
    result = await jsonRequest(base,json({id:eventId,summary:p.summary,description:p.description,start:{dateTime:p.start},end:{dateTime:p.end}},token),true);
    let confirmed:any;
    try{confirmed=await jsonRequest(`${base}/${encodeURIComponent(result.id)}`,bearer(token));}catch{throw new DeliveryError('unknown','Calendar accepted the request, but read-back could not be verified. Inspect the destination.');}
    if (confirmed.id !== result.id || confirmed.summary !== p.summary || (confirmed.description||'')!==p.description || Date.parse(confirmed.start?.dateTime)!==Date.parse(p.start) || Date.parse(confirmed.end?.dateTime)!==Date.parse(p.end)) throw new DeliveryError('unknown','Calendar read-back did not match the approved event.');
    return {status:'verified',destinationId:result.id,evidence:{provider:'google-calendar',readBack:true,url:confirmed.htmlLink}};
  }
  if (action === 'sheets.append') {
    const base=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(p.spreadsheetId)}/values/`;
    result=await jsonRequest(`${base}${encodeURIComponent(p.range)}:append?valueInputOption=RAW`,json({values:p.rows},token),true);
    if (!result.updates?.updatedRange) throw new DeliveryError('unknown','Sheets did not return an affected range.');
    return {status:'accepted',destinationId:result.updates.updatedRange,evidence:{provider:'google-sheets',updatedRows:result.updates.updatedRows,interpretation:'RAW; no formula execution requested'}};
  }
  if (action === 'gmail.draft' || action === 'gmail.send') {
    const raw=rawMail(p);
    result=await jsonRequest(`https://gmail.googleapis.com/gmail/v1/users/me/${action==='gmail.draft'?'drafts':'messages/send'}`,json(action==='gmail.draft'?{message:{raw}}:{raw},token),true);
    if (!result.id) throw new DeliveryError('unknown','Gmail did not return a destination ID.');
    return {status:'accepted',destinationId:result.id,evidence:{provider:'gmail',operation:action,delivery:'API acknowledgement only; not recipient delivery'}};
  }
  if (action === 'slack.send') {
    result=await jsonRequest('https://slack.com/api/chat.postMessage',json({channel:p.channel,text:p.text,client_msg_id:executionId},token),true);
    if (!result.ok || !result.ts) throw new DeliveryError('failed','Slack rejected the message.');
    return {status:'accepted',destinationId:`${result.channel}/${result.ts}`,evidence:{provider:'slack',acknowledged:true}};
  }
  if (action === 'todoist.create') {
    const init=json({content:p.content,...(p.projectId?{project_id:p.projectId}:{})},token);
    result=await jsonRequest('https://api.todoist.com/api/v1/tasks',{...init,headers:{...init.headers,'X-Request-Id':executionId}},true);
  } else if (action === 'notion.create') {
    result=await jsonRequest('https://api.notion.com/v1/pages',{...json({parent:{page_id:p.parentId},properties:{title:{type:'title',title:[{type:'text',text:{content:p.title}}]}},children:p.body?[{object:'block',type:'paragraph',paragraph:{rich_text:[{type:'text',text:{content:p.body}}]}}]:[]},token),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Notion-Version':'2022-06-28'}},true);
  } else if (action === 'hubspot.contact') {
    result=await jsonRequest('https://api.hubapi.com/crm/v3/objects/contacts',json({properties:{email:p.email,firstname:p.firstName,lastname:p.lastName}},token),true);
  } else if (action === 'home-assistant.service') {
    await jsonRequest(`${secret.url}/api/services/${p.domain}/${p.service}`,json({...p.data,entity_id:p.entityId},token),true);
    return {status:'accepted',destinationId:p.entityId,evidence:{provider:'home-assistant',service:`${p.domain}.${p.service}`,physicalState:'Not verified'}};
  } else if (action === 'webhook.post') {
    const timestamp=String(Date.now()); const body=JSON.stringify({id:executionId,at:timestamp,payload:p.body});
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(token),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const signature=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}.${body}`)))].map(x=>x.toString(16).padStart(2,'0')).join('');
    await jsonRequest(secret.url,{method:'POST',headers:{'Content-Type':'application/json','X-OneBrain-Id':executionId,'X-OneBrain-Timestamp':timestamp,'X-OneBrain-Signature':signature,'Idempotency-Key':executionId},body},true,false);
    return {status:'accepted',destinationId:executionId,evidence:{provider:'webhook',acknowledged:true,downstreamResult:'Not verified'}};
  } else if (action === 'mcp.call') {
    if (!(JSON.parse(row.config).tools || []).includes(p.name)) throw new DeliveryError('failed','Tool was not in the approved connection tool list. Reconnect to review new tools.');
    const rpc=await mcpSession(secret); result=await rpc.call('tools/call',{name:p.name,arguments:p.arguments},true);
    if (result.error || result.result?.isError) throw new DeliveryError('failed','MCP tool reported an error.');
    return {status:'accepted',destinationId:executionId,evidence:{provider:'mcp',tool:p.name,downstreamResult:'Tool acknowledgement, not independent verification'}};
  }
  if (!result?.id) throw new DeliveryError('unknown','Provider did not return a destination ID.');
  return {status:'accepted',destinationId:String(result.id),evidence:{provider:row.provider,acknowledged:true}};
}
