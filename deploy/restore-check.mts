// Opens only a restored stand copy, without starting an HTTP listener or mail worker.
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const restored = await realpath(process.argv[2] ?? '');
if (!/^\/var\/backups\/endurozone\/restore-check-[^/]+\/\.data\/postgres$/.test(restored)) {
  throw new Error('Expected an isolated restored database under /var/backups/endurozone');
}
const appRoot = '/opt/endurozone/app';
const { openDatabase } = await import(pathToFileURL(join(appRoot, 'apps/api/src/database.ts')).href);
const { buildApp } = await import(pathToFileURL(join(appRoot, 'apps/api/src/app.ts')).href);
const db = await openDatabase({ dataDir: restored });
let app;
try {
  const counts: Record<string, number> = {};
  for (const table of ['users', 'bikes', 'posts', 'photos', 'tracks', 'rides', 'ride_members', 'ride_messages']) {
    const rows = await db.query(`SELECT count(*)::int AS count FROM ${table}`);
    counts[table] = rows[0].count;
  }
  app = await buildApp({ db, origin: 'http://localhost:3299', logger: false });
  const health = await app.inject({ method: 'GET', url: '/api/health' });
  const me = await app.inject({ method: 'GET', url: '/api/me' });
  if (health.statusCode !== 200 || !health.json().ok || me.statusCode !== 200) {
    throw new Error('Restored API probe failed');
  }
  console.log(JSON.stringify({ result: 'RESTORE_OPEN_OK', version: health.json().version, counts, guest_me_status: me.statusCode, network_listener: false, mail_worker: false }));
} finally {
  if (app) await app.close();
  await db.close();
}
