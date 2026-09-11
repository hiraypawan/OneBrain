import {fail} from './core';
/** Opaque keyset, not a snapshot. Never authorizes a workspace or a job. */
export function readPage(size: string | undefined, cursor: string | undefined, defaultSize = 25) {
  const limit = size === undefined ? defaultSize : Number(size);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail(400,'Page size must be 1–100.');
  let after: [number,string] | undefined;
  if (cursor !== undefined) {
    try {
      if (!cursor.length || cursor.length > 300) throw new Error();
      const v=JSON.parse(atob(cursor));
      if(!Array.isArray(v)||v.length!==2||!Number.isSafeInteger(v[0])||v[0]<0||typeof v[1]!=='string'||!v[1].length||v[1].length>100)throw new Error();
      after=[v[0],v[1]];
    } catch {fail(400,'Invalid history cursor.');}
  }
  return {limit,after};
}
export function pageResult<T extends {id:string}>(rows:T[],limit:number,time:(row:T)=>number) {
  const items=rows.slice(0,limit),last=items.at(-1);
  return {items,nextCursor:rows.length>limit&&last?btoa(JSON.stringify([time(last),last.id])):null};
}
