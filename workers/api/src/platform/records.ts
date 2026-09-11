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
  if (data.assignee) {
    if (memberIds ? !memberIds.has(text(data.assignee,'Assignee')) : !await env.DB.prepare('SELECT 1 FROM space_members WHERE space_id=? AND user_id=?').bind(space,text(data.assignee,'Assignee')).first()) fail(400,'Assign only a current workspace member.');
  }
  const rows = (data.links?.length || data.dependencies?.length) ? await env.DB.prepare('SELECT id,data FROM space_records WHERE space_id=?').bind(space).all<{id:string;data:string}>() : {results:[]};
  const records = new Map(rows.results.map(r => [r.id,JSON.parse(r.data)]));
  for (const field of ['links','dependencies']) {
    const values = data[field] || [];
    if (!Array.isArray(values) || values.length > 50 || values.some((v: any) => typeof v !== 'string' || v === recordId || !records.has(v))) fail(400,'Relationships must reference other records in this workspace.');
    data[field] = [...new Set(values)];
  }
  if (data.status === 'done' && data.dependencies.some((dep: string) => records.get(dep)?.status !== 'done')) fail(409,'Complete the dependencies before completing this task.');
  if (recordId) {
    const seen = new Set<string>();
    const visit = (target: string): boolean => {
      if (target === recordId) return true;
      if (seen.has(target)) return false;
      seen.add(target);
      return (records.get(target)?.dependencies || []).some(visit);
    };
    if (data.dependencies.some(visit)) fail(409,'Circular task dependencies are not allowed.');
  }
  return { kind, title, data };
}
