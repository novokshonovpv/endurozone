import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { readFile } from "node:fs/promises";

export type Row = Record<string, any>;
export interface Queryable {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}
export interface Database extends Queryable {
  transaction<T>(work: (db: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function openDatabase(
  options: { url?: string; dataDir?: string } = {},
): Promise<Database> {
  let db: Database;
  if (options.url) {
    const pool = new pg.Pool({ connectionString: options.url, max: 5 });
    db = {
      async query(sql, params) {
        return (await pool.query(sql, params)).rows;
      },
      async transaction(work) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await work({
            async query(sql, params) {
              return (await client.query(sql, params)).rows;
            },
          });
          await client.query("COMMIT");
          return result;
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      },
      async close() {
        await pool.end();
      },
    };
  } else {
    const embedded = new PGlite(options.dataDir);
    await embedded.waitReady;
    db = {
      async query<T extends Row>(sql: string, params?: unknown[]) {
        return (await embedded.query<T>(sql, params)).rows;
      },
      async transaction(work) {
        return embedded.transaction(async (tx) =>
          work({
            async query<T extends Row>(sql: string, params?: unknown[]) {
              return (await tx.query<T>(sql, params)).rows;
            },
          }),
        );
      },
      async close() {
        await embedded.close();
      },
    };
  }
  try {
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz DEFAULT now())",
    );
    await db.transaction(async (tx) => {
      // One migration runner at a time, for both embedded and server PostgreSQL.
      await tx.query("LOCK TABLE schema_migrations IN EXCLUSIVE MODE");
      for (const [index, name] of [
        "001-core.sql",
        "002-locations.sql",
        "003-tracks-rides.sql",
        "004-pilot.sql",
        "005-account-rights.sql",
        "006-garage-service.sql",
        "007-learning.sql",
        "008-mechanic.sql",
        "009-photos.sql",
        "010-follows-favorites.sql",
        "011-nearby.sql",
        "012-ride-chat.sql",
        "013-feedback.sql",
        "014-onboarding.sql",
        "015-blocks.sql",
        "016-bike-catalog.sql",
        "017-part-fits.sql",
        "018-map-kinds-news.sql",
        "019-announcements-seed.sql",
      ].entries()) {
        const version = index + 1;
        const applied = await tx.query(
          "SELECT version FROM schema_migrations WHERE version=$1",
          [version],
        );
        if (applied.length) continue;
        const migration = await readFile(
          new URL(`../migrations/${name}`, import.meta.url),
          "utf8",
        );
        for (const statement of migration.split(";").filter((x) => x.trim()))
          await tx.query(statement);
        await tx.query("INSERT INTO schema_migrations(version) VALUES ($1)", [
          version,
        ]);
      }
    });
    return db;
  } catch (e) {
    await db.close();
    throw e;
  }
}
