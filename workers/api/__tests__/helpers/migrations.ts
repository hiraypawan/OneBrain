import { readFileSync, readdirSync } from 'node:fs';

/**
 * Single source of truth for test migrations.
 *
 * Every suite used to hardcode its own filename list, so a new migration was
 * silently missing from three of them (the schema under test then differed from
 * production). The list is now read from the migrations directory in order.
 */
export const MIGRATION_FILES: string[] = readdirSync(new URL('../../migrations/', import.meta.url))
  .filter((file) => file.endsWith('.sql'))
  .sort();

export async function applyMigrations(DB: any): Promise<string[]> {
  for (const file of MIGRATION_FILES) {
    // Comments are stripped because the harness splits on ';'.
    const sql = readFileSync(new URL('../../migrations/' + file, import.meta.url), 'utf8').replace(/--[^\n]*/g, '');
    // Keep complete trigger bodies intact; split everything else.
    const triggers = [...sql.matchAll(/CREATE TRIGGER[\s\S]*?\nEND;/g)].map((m) => m[0]);
    const ordinary = sql
      .replace(/CREATE TRIGGER[\s\S]*?\nEND;/g, '')
      .split(';')
      .filter((statement) => statement.trim());
    await DB.batch([...ordinary, ...triggers].map((statement: string) => DB.prepare(statement)));
  }
  return MIGRATION_FILES;
}
