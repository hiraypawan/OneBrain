import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// Zero-dependency file database (no Docker, no server to run).
// Swap DATABASE_PATH for Postgres later; the route layer stays the same.
const DB_PATH = process.env.DATABASE_PATH || join(process.cwd(), 'data', 'onebrain.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const sqlite = new DatabaseSync(DB_PATH);
sqlite.exec('PRAGMA journal_mode = WAL;');

const schema = readFileSync(join(__dirname, 'db', 'schema.sql'), 'utf8');
sqlite.exec(schema);

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function row<T = any>(sql: string, ...params: any[]): T | undefined {
  return sqlite.prepare(sql).get(...params) as T | undefined;
}

export function all<T = any>(sql: string, ...params: any[]): T[] {
  return sqlite.prepare(sql).all(...params) as T[];
}

export function run(sql: string, ...params: any[]) {
  return sqlite.prepare(sql).run(...params);
}
