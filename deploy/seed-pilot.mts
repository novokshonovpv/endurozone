// Synthetic data only. Stop the stand before opening its PGlite directory.
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const check = process.argv[2] === '--check';
if (!check && process.platform !== 'linux') throw new Error('Stand mode requires Linux');
const root = check ? resolve('.') : '/opt/endurozone/app';
const scratch = check ? await mkdtemp(join(tmpdir(), 'ez-pilot-check-')) : '/opt/endurozone/ops';
const manifestPath = join(scratch, 'pilot-fixtures.json');
const dataDir = check ? join(scratch, 'postgres') : join(root, '.data/postgres');
if (!check) {
  const config = await readFile('/etc/endurozone.env', 'utf8');
  if (/^DATABASE_URL=.+/m.test(config)) throw new Error('PGlite stand only');
}
await mkdir(scratch, { recursive: true, mode: 0o700 });
let state: any;
try { state = JSON.parse(await readFile(manifestPath, 'utf8')); }
catch (error: any) { if (error.code !== 'ENOENT') throw error; }
const { openDatabase } = await import(pathToFileURL(join(root, 'apps/api/src/database.ts')).href);
const { buildApp } = await import(pathToFileURL(join(root, 'apps/api/src/app.ts')).href);
const db = await openDatabase({ dataDir });
let app;
const save = () => writeFile(manifestPath, JSON.stringify(state, null, 2), { mode: 0o600 });
const origin = 'http://localhost:3299';
try {
  if (!state) {
    const collisions = await db.query("SELECT id FROM users WHERE handle IN ('pilot_sm','pilot_so')");
    if (collisions.length) throw new Error('Reserved demo handles exist without a manifest; refusing to modify them');
    state = { synthetic: true, accounts: [
      { handle: 'pilot_sm', email: 'pilot_sm@example.test', displayName: 'ДЕМО · Смоленск', city: 'Смоленск', level: 'amateur', password: randomBytes(24).toString('base64url') },
      { handle: 'pilot_so', email: 'pilot_so@example.test', displayName: 'ДЕМО · Сочи', city: 'Сочи', level: 'beginner', password: randomBytes(24).toString('base64url') },
    ] };
    await save();
  }
  if (!state.synthetic || state.accounts.length !== 2) throw new Error('Invalid fixture manifest');
  app = await buildApp({ db, origin, logger: false, rateMax: 1000 });
  async function request(method: any, url: string, client?: any, payload?: any, expected = 200) {
    const response = await app.inject({ method, url, payload, headers: {
      origin, 'x-enduro-client': 'web', ...(client ? { cookie: client.cookie, 'x-csrf-token': client.csrfToken } : {}),
    } });
    if (response.statusCode !== expected) throw new Error(`${method} ${url}: expected ${expected}, got ${response.statusCode}`);
    return response;
  }
  const clients = [];
  for (const account of state.accounts) {
    const exists = await db.query('SELECT id FROM users WHERE handle=$1', [account.handle]);
    const response = exists.length
      ? await request('POST', '/api/auth/login', undefined, { email: account.email, password: account.password })
      : await request('POST', '/api/auth/register', undefined, account, 201);
    clients.push({ ...response.json(), cookie: String(response.headers['set-cookie']).split(';')[0] });
  }
  const [organizer, member] = clients;
  const find = async (table: string, column: string, owner: string, title: string) =>
    (await db.query(`SELECT id FROM ${table} WHERE ${column}=$1 AND title=$2 LIMIT 1`, [owner, title]))[0]?.id;
  for (const c of clients) {
    const bikes = await db.query("SELECT id FROM bikes WHERE owner_id=$1 AND make='Demo' AND model='Pilot 250' LIMIT 1", [c.user.id]);
    const bike = bikes[0]?.id ?? (await request('POST', '/api/me/bikes', c, {
      make: 'Demo', model: 'Pilot 250', year: 2024, modification: 'Синтетическая техника', engine: '250 / 4T', hours: 12,
      notes: 'Тестовый мотоцикл. Это не реальная модель и не справочник совместимости.',
    }, 201)).json().id;
    const title = `ДЕМО · первый бортжурнал · ${c.user.city}`;
    const post = await find('posts', 'author_id', c.user.id, title) ?? (await request('POST', '/api/posts', c, {
      bikeId: bike, title, body: 'Искусственная запись для проверки сайта: гараж, журнал, подписки и избранное. Реального выезда и обслуживания нет.', kind: 'ride', visibility: 'public',
    }, 201)).json().id;
    const privateTitle = `ДЕМО · личная заметка · ${c.user.city}`;
    if (!await find('posts', 'author_id', c.user.id, privateTitle)) await request('POST', '/api/posts', c, {
      bikeId: bike, title: privateTitle, body: 'Синтетическая личная запись: должна быть доступна только владельцу. Контактов, адресов и реальных расходов здесь нет.', kind: 'maintenance', visibility: 'private',
    }, 201);
    state[c.user.handle] = { bike, post };
    await save();
  }
  await request('PUT', `/api/me/following/${organizer.user.handle}`, member);
  await request('PUT', `/api/me/favorites/${state.pilot_sm.post}`, member, undefined, 204);
  const title = 'ДЕМО · искусственный трек для проверки';
  let track = await find('tracks', 'author_id', organizer.user.id, title);
  if (!track) {
    const gpx = `<gpx version="1.1" creator="Enduro.Zone synthetic test" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${Array.from({length:25}, (_,i)=>`<trkpt lon="32.1" lat="${54.7+i*0.002}"/>`).join('')}</trkseg></trk></gpx>`;
    track = (await request('POST', '/api/tracks', organizer, {
      title, description: 'Искусственная линия. Не реальный маршрут; не использовать для катания.', city: 'Смоленск', difficulty: 'easy',
      accessNotes: 'Тестовые данные. Разрешение на катание отсутствует. Реального выезда нет.', gpx, trimM: 100, publicationConsent: true,
    },201)).json().id;
    // Publish only this synthetic fixture, not user submissions; no moderator role is granted.
    await db.query("UPDATE tracks SET status='published' WHERE id=$1 AND author_id=$2", [track, organizer.user.id]);
  }
  const rideTitle = 'ДЕМО · проверка заявки и чата · выезда нет';
  let ride = await find('rides', 'organizer_id', organizer.user.id, rideTitle);
  if (!ride) ride = (await request('POST', '/api/rides', organizer, {
    trackId: track, title: rideTitle, description: 'Тест интерфейса, реальной встречи и выезда нет. Маршрут искусственный.',
    meetingNotes: 'Синтетическая точка сбора. Реального адреса и контакта нет.',
    startsAt: new Date(Date.now()+3*86400000).toISOString(), timezone: 'Europe/Moscow', capacity: 10,
  },201)).json().id;
  const memberships = await db.query('SELECT status FROM ride_members WHERE ride_id=$1 AND user_id=$2',[ride, member.user.id]);
  if (memberships[0]?.status !== 'accepted') {
    await request('POST', `/api/rides/${ride}/join`, member);
    await request('POST', `/api/rides/${ride}/members/${member.user.id}/decision`, organizer, {action:'accept'});
  }
  for (const c of clients) {
    const existing = await db.query('SELECT id FROM ride_messages WHERE ride_id=$1 AND author_id=$2 LIMIT 1',[ride,c.user.id]);
    if (!existing.length) await request('POST', `/api/rides/${ride}/messages`, c, {body:'ДЕМО: тестовое сообщение. Реальной встречи нет.'},201);
  }
  state.track = track; state.ride = ride; await save();
  const guestChat = await app.inject({method:'GET',url:`/api/rides/${ride}/messages`});
  if (guestChat.statusCode !== 401) throw new Error('Guest chat guard failed');
  console.log(JSON.stringify({result:'PILOT_FIXTURES_READY', synthetic:true, accounts:2, ride, credentials:'Private server manifest; not printed', guestChat:401, check}));
} catch (error: any) {
  console.error('Fixture preparation failed:', error.message);
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  await db.close();
}
