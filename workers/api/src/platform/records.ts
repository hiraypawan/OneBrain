import { fail, number, object, text, type PlatformEnv } from './core';
export const RECORD_KINDS = ['note','task','idea','person','company','project','decision','expense','payment','shopping','habit','mood','document','invoice'] as const;
export async function validateRecord(env: PlatformEnv, space: string, input: unknown, recordId?: string, memberIds?: ReadonlySet<string>) {
  const source = object(input);
  const kind = text(source.kind, 'Record type');
  if (!(RECORD_KINDS as readonly string[]).includes(kind)) fail(400, 'Unsupported record type.');
  const title = text(source.title, 'Title', 120);
  const data = object(source.data || {});
  const allowed = ['body','status','due','links','dependencies','assignee','amount','currency','category','budget','milestones','frequency','energy','mood','invoiceNumber','counterparty','paid','aliases'];
  if (Object.keys(data).some(k => !allowed.includes(k))) fail(400, 'Unsupported record field.');
  data.body = text(data.body, 'Notes', 6000, true);
  data.status = data.status || 'active';
  if (!['active','done','cancelled'].includes(data.status)) fail(400, 'Unsupported status.');
  if (data.due && !Number.isFinite(Date.parse(data.due))) fail(400, 'A valid due date is required.');
  for (const field of ['amount','budget','paid']) if (data[field] !== undefined) {
    number(data[field], field, 0, 1e12);
    if (Math.abs(Math.round(data[field] * 100) - data[field] * 100) > .001) fail(400, 'Money accepts at most two decimal places.');
    if (!['INR','USD','EUR','GBP','JPY'].includes(data.currency)) fail(400, 'Select a supported currency.');
  }
  for (const field of ['energy','mood']) if (data[field] !== undefined) number(data[field],field,1,5);
  for (const field of ['category','invoiceNumber','counterparty','frequency']) if (data[field] !== undefined) text(data[field],field,200);
  if (data.aliases !== undefined && (!Array.isArray(data.aliases) || data.aliases.length > 20 || data.aliases.some((a: any) => typeof a !== 'string' || a.length > 120))) fail(400,'Use at most 20 short aliases.');
  if (data.milestones !== undefined) {
    if (!Array.isArray(data.milestones) || data.milestones.length > 30) fail(400,'Use at most 30 milestones.');
    data.milestones = data.milestones.map((m: any) => ({ title: text(m.title,'Milestone',120), done: m.done === true }));
  }
  // Reject malformed/oversized relationships before any catalog/member lookup.
  for (const field of ['links','dependencies']) {
    const values = data[field] ?? [];
    if (!Array.isArray(values) || values.length > 50 || values.some((v: unknown) => typeof v !== 'string' || !v.length || v.length > 200 || v === recordId)) fail(400,'Relationships must reference other records in this workspace.');
    data[field] = [...new Set(values)];
  }
  if (data.assignee) {
    if (memberIds ? !memberIds.has(text(data.assignee,'Assignee')) : !await env.DB.prepare('SELECT 1 FROM space_members WHERE space_id=? AND user_id=?').bind(space,text(data.assignee,'Assignee')).first()) fail(400,'Assign only a current workspace member.');
  }
  const references = [...new Set<string>([...data.links,...data.dependencies])];
  // Reference IDs drive primary-key lookups. Do not read/parse every note body
  // in a 2,000-record workspace merely to attach one link.
  const rows = references.length ? await env.DB.prepare(
    "SELECT r.id,json_extract(r.data,'$.status') AS status FROM json_each(?) refs CROSS JOIN space_records r ON r.id=refs.value WHERE r.space_id=?"
  ).bind(JSON.stringify(references),space).all<{id:string;status:string}>() : {results:[]};
  const records = new Map(rows.results.map(r => [r.id,r]));
  if (references.some(ref => !records.has(ref))) fail(400,'Relationships must reference other records in this workspace.');
  if (data.status === 'done' && data.dependencies.some((dep: string) => records.get(dep)?.status !== 'done')) fail(409,'Complete the dependencies before completing this task.');
  if (recordId && data.dependencies.length) {
    // Follow only the reachable dependency graph; UNION deduplicates cycles.
    // Database triggers still enforce this inside the write transaction.
    const cycle = await env.DB.prepare(`WITH RECURSIVE reachable(id) AS (
      SELECT value FROM json_each(?)
      UNION
      SELECT d.value FROM reachable x
      JOIN space_records r ON r.id=x.id AND r.space_id=?
      JOIN json_each(r.data,'$.dependencies') d
    ) SELECT id FROM reachable WHERE id=? LIMIT 1`).bind(JSON.stringify(data.dependencies),space,recordId).first();
    if (cycle) fail(409,'Circular task dependencies are not allowed.');
  }
  return { kind, title, data };
}
