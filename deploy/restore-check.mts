// Opens only a restored stand copy, without starting an HTTP listener or mail worker.
import { realpath, readFile } from 'node:fs/promises';
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
  if (health.statusCode !== 200 || !health.json().ok || me.statusCode !== 401) {
    throw new Error('Restored API probe failed');
  }
  let pilotChecks;
  if (process.argv[3] === '--pilot') {
    const manifest = JSON.parse(await readFile('/opt/endurozone/ops/pilot-fixtures.json', 'utf8'));
    if (!manifest.synthetic || manifest.accounts.length !== 2) throw new Error('Synthetic manifest required');
    const clients = [];
    for (const account of manifest.accounts) {
      const login = await app.inject({method:'POST', url:'/api/auth/login', headers:{origin:'http://localhost:3299','x-enduro-client':'web'}, payload:{email:account.email,password:account.password}});
      if (login.statusCode !== 200) throw new Error('Restored synthetic login failed');
      const cookie = String(login.headers['set-cookie']).split(';')[0];
      clients.push({cookie,handle:account.handle});
      const chat = await app.inject({method:'GET',url:`/api/rides/${manifest.ride}/messages`,headers:{cookie}});
      if (chat.statusCode !== 200 || chat.json().items.length !== 2) throw new Error('Restored chat failed');
    }
    const privatePosts = await db.query("SELECT id,author_id FROM posts WHERE visibility='private' AND author_id IN (SELECT id FROM users WHERE handle IN ('pilot_sm','pilot_so'))");
    if (privatePosts.length !== 2) throw new Error('Restored private posts missing');
    for (const row of privatePosts) {
      const owner = (await db.query('SELECT handle FROM users WHERE id=$1',[row.author_id]))[0].handle;
      const other = clients.find(c => c.handle !== owner);
      const denied = await app.inject({method:'GET',url:`/api/posts/${row.id}`,headers:{cookie:other.cookie}});
      if (denied.statusCode !== 404) throw new Error('Restored private post access failed');
    }
    const guestChat = await app.inject({method:'GET',url:`/api/rides/${manifest.ride}/messages`});
    if (guestChat.statusCode !== 401) throw new Error('Restored guest chat guard failed');
    pilotChecks = {logins:2,chatMessages:2,privatePosts:2,foreignPrivateAccess:'denied',guestChat:401};
  }
  console.log(JSON.stringify({ result: 'RESTORE_OPEN_OK', version: health.json().version, counts, pilotChecks, guest_me_status: me.statusCode, network_listener: false, mail_worker: false }));
} finally {
  if (app) await app.close();
  await db.close();
}
