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
      const applied = await tx.query(
        "SELECT version FROM schema_migrations WHERE version = 1",
      );
      if (!applied.length) {
        const migration = await readFile(
          new URL("../migrations/001-core.sql", import.meta.url),
          "utf8",
        );
        for (const statement of migration.split(";").filter((x) => x.trim()))
          await tx.query(statement);
        await tx.query("INSERT INTO schema_migrations(version) VALUES (1)");
      }
    });
    return db;
  } catch (e) {
    await db.close();
    throw e;
  }
}
