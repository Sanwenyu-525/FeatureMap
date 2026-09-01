/**
 * Database bootstrap. Stores are local SQLite files under the
 * `.featuremap/` runtime directory (docs/MVP_SPEC.md §6).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type FeatureMapDatabase = BetterSQLite3Database<typeof schema>;

export { schema };

/** Directory containing generated drizzle-kit SQL migrations. */
function findMigrationsFolder(): string {
  // Works both from compiled dist output and from TS sources (vitest).
  const candidates = ['../../migrations', '../migrations'].map((p) =>
    fileURLToPath(new URL(p, import.meta.url)),
  );
  const found = candidates.find((c) => existsSync(join(c, 'meta', '_journal.json')));
  if (!found) {
    throw new Error(`Migrations folder not found (tried: ${candidates.join(', ')})`);
  }
  return found;
}

function applyMigrations(db: FeatureMapDatabase): void {
  migrate(db, { migrationsFolder: findMigrationsFolder() });
}

/** Default location of the local store inside a repository. */
export function defaultDatabasePath(repoRoot: string): string {
  return join(repoRoot, '.featuremap', 'featuremap.db');
}

/**
 * Open (and create if needed) the local FeatureMap store.
 * WAL mode is enabled for safer concurrent reads during `featuremap dev`.
 */
export function openDatabase(dbPath: string): { db: FeatureMapDatabase; sqlite: Database.Database } {
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  applyMigrations(db);
  return { db, sqlite };
}

/** Open an in-memory store; used by tests and short-lived commands. */
export function openMemoryDatabase(): { db: FeatureMapDatabase; sqlite: Database.Database } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  applyMigrations(db);
  return { db, sqlite };
}
