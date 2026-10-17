import { check, section, after } from './harness.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ── k0 Cloud, played by a stand-in ───────────────────────────────────────────
// `cloud.js` is one of the two files in k0 that reach outside, so this test makes sure it cannot:
// the real `fetch` throws, and every call goes to a small Supabase written below, in memory, that
// knows the handful of endpoints k0 uses. What is worth proving is the behaviour around them —
// signing in with a code, a story's number coming from the cloud, a story made offline getting a
// provisional one and then its real one, changes going up and other machines' changes coming down
// — and that none of it ever throws at the board.

const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-cloud-home-'))
process.env.HOME = FAKE_HOME
process.env.USERPROFILE = FAKE_HOME
process.env.K0_HOME = FAKE_HOME
process.env.K0_DB = path.join(FAKE_HOME, 'k0.db')
process.env.K0_CONFIG = path.join(FAKE_HOME, 'config.json')
process.env.K0_CLOUD_FILE = path.join(FAKE_HOME, 'cloud.json')
process.env.K0_CLOUD_URL = 'https://cloud.test'
process.env.K0_CLOUD_KEY = 'sb_publishable_test'

globalThis.fetch = () => {
  throw new Error('a test must never reach the real cloud')
}

const db = await import('../server/db.js')
const cloud = await import('../server/cloud.js')
const sync = await import('../server/sync.js')

// The database is closed first: Windows refuses to delete a folder with an open file in it.
after(() => {
  db.close()
  fs.rmSync(FAKE_HOME, { recursive: true, force: true })
})

/** A Supabase that fits in a test: one user, one workspace, the records table and the counter. */
function fakeSupabase() {
  const s = {
    up: true,
    approved: true,
    nextKey: 1,
    seq: 0,
    records: new Map(),
    calls: [],
    providers: { github: true, google: false },
    codes: new Set(['good-code']),
    verifier: null,
  }
  const json = (status, body) => ({
    ok: status < 400,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  })
  s.fetch = async (url, opts = {}) => {
    if (!s.up) throw new TypeError('fetch failed')
    const u = new URL(url)
    const body = opts.body ? JSON.parse(opts.body) : null
    s.calls.push(`${opts.method} ${u.pathname}`)
    if (opts.headers?.apikey !== 'sb_publishable_test') return json(401, { message: 'no key' })
    const authed = opts.headers?.authorization === 'Bearer access-1' || opts.headers?.authorization === 'Bearer access-2'
    if (u.pathname === '/auth/v1/settings') return json(200, { external: s.providers })
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'pkce') {
      if (!s.codes.has(body.auth_code) || !body.code_verifier) return json(400, { error_description: 'bad code' })
      s.verifier = body.code_verifier
      return json(200, { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 })
    }
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'refresh_token') {
      return body.refresh_token === 'refresh-1'
        ? json(200, { access_token: 'access-2', refresh_token: 'refresh-1', expires_in: 3600 })
        : json(400, { error_description: 'revoked' })
    }
    if (u.pathname === '/auth/v1/logout') return json(204)
    if (!authed) return json(401, { message: 'no token' })
    if (u.pathname === '/rest/v1/rpc/k0_me') {
      return json(200, { id: 'u1', email: 'someone@example.com', name: 'Someone', approved: s.approved, is_admin: false, workspace: 'ws1' })
    }
    if (u.pathname === '/rest/v1/rpc/k0_next_key') {
      if (!s.approved) return json(403, { message: 'not a member of this workspace' })
      return json(200, s.nextKey++)
    }
    if (u.pathname === '/rest/v1/rpc/k0_reserve_keys') {
      s.nextKey = Math.max(s.nextKey, body.upto + 1)
      return json(200, s.nextKey)
    }
    if (u.pathname === '/rest/v1/records' && opts.method === 'POST') {
      for (const r of body) s.records.set(`${r.kind}:${r.uid}`, { ...r, seq: ++s.seq })
      return json(201)
    }
    if (u.pathname === '/rest/v1/records' && opts.method === 'GET') {
      const since = Number(u.searchParams.get('seq').slice(3))
      const notMe = u.searchParams.get('machine').slice(4)
      const rows = [...s.records.values()].filter((r) => r.seq > since && r.machine !== notMe).sort((a, b) => a.seq - b.seq)
      return json(200, rows)
    }
    return json(404, { message: `nothing at ${u.pathname}` })
  }
  return s
}

const REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'k0-cloud-repo-')))
fs.mkdirSync(path.join(REPO, '.git'))
after(() => fs.rmSync(REPO, { recursive: true, force: true }))

const sb = fakeSupabase()
cloud.useFetch(sb.fetch)

// ── Before anybody signs in ──────────────────────────────────────────────────
section('Before anybody signs in')
{
  check('nobody is linked', cloud.status().linked, false)
  check('so there is no number to ask the cloud for', await cloud.nextKey(), null)
  check('and nothing was asked', sb.calls.length, 0)
  const story = db.createStory({ project_path: REPO, title: 'Made before the cloud' })
  check('a story still gets a real number, counted here', story.key, 'K1')
  check('and nothing is queued for a cloud nobody linked', db.outboxSize(), 0)
  check('the providers switched on are the ones the cloud says', (await cloud.providers()).join(' '), 'github')
}

// ── Signing in ───────────────────────────────────────────────────────────────
section('Signing in')
{
  let refused = null
  try {
    cloud.loginUrl('linkedin', 'http://k0.localhost:4319/auth/callback')
  } catch (err) {
    refused = err.message
  }
  check('only GitHub and Google are ways in', /GitHub|github/.test(refused || ''), true)

  const url = new URL(cloud.loginUrl('github', 'http://k0.localhost:4319/auth/callback'))
  check('the browser is sent to the cloud\'s own sign-in', url.origin + url.pathname, 'https://cloud.test/auth/v1/authorize')
  check('for the provider that was picked', url.searchParams.get('provider'), 'github')
  check('coming back to this machine', url.searchParams.get('redirect_to'), 'http://k0.localhost:4319/auth/callback')
  check('with only the public half of the secret on the way out', url.searchParams.get('code_challenge_method'), 's256')

  let bad = null
  try {
    await cloud.finishLogin('stolen-code')
  } catch (err) {
    bad = err.message
  }
  check('a code the cloud does not know signs nobody in', bad, 'bad code')
  check('and leaves nobody linked', cloud.status().linked, false)

  cloud.loginUrl('github', 'http://k0.localhost:4319/auth/callback')
  const after = await cloud.finishLogin('good-code')
  check('the right code signs in', after.linked, true)
  check('as the person the cloud says it is', after.email, 'someone@example.com')
  check('who has been let in', after.approved, true)
  check('the secret half went with the code, never before it', typeof sb.verifier === 'string' && sb.verifier.length > 40, true)
  const onDisk = JSON.parse(fs.readFileSync(process.env.K0_CLOUD_FILE, 'utf8'))
  check('the sign-in is kept beside the database', onDisk.session.refresh_token, 'refresh-1')
  if (process.platform !== 'win32') {
    check('readable by its owner and nobody else', (fs.statSync(process.env.K0_CLOUD_FILE).mode & 0o777).toString(8), '600')
  }
  let reused = null
  try {
    await cloud.finishLogin('good-code')
  } catch (err) {
    reused = err.message
  }
  check('a sign-in cannot be finished twice', /expired/.test(reused || ''), true)
}

// ── Moving a board that was already here ─────────────────────────────────────
section('Moving a board that was already here')
{
  db.createStory({ project_path: REPO, title: 'A second old one' })
  sb.nextKey = 1
  const before = await sync.round()
  check('a board made before signing in has to be moved first', before.needs_move, true)
  check('and until it is, nothing goes up', sb.records.size, 0)
  check('and new stories are still numbered here, not by the cloud', db.createStory({ project_path: REPO, title: 'meanwhile' }).key, 'K3')
  check('so the cloud has handed out nothing yet', sb.nextKey, 1)

  const plan = await sync.movePlan()
  check('the preview starts where the cloud is', plan.start, 1)
  check('and lists every story on the board', plan.rows.length, 3)
  check('oldest first, old number beside new', plan.rows.map((r) => `${r.old}>${r.new}`).join(' '), 'K1>K1 K2>K2 K3>K3')
  check('the preview changes nothing', db.getStory(1).key, 'K1')

  const done = await sync.move()
  check('the move says how many it moved', done.moved, 3)
  check('a copy of the database was kept first', fs.existsSync(done.backup), true)
  check('and every old number beside its new one', JSON.parse(fs.readFileSync(done.map, 'utf8')).length, 3)
  check('the cloud\'s counter is past the whole board', sb.nextKey, 4)
  check('after the move nothing is left to move', sync.needsMove(), false)
}

// ── The first sync ───────────────────────────────────────────────────────────
section('The first sync')
{
  await sync.round()
  check('the board that was already here goes up whole', sb.records.has(`story:${db.getStory(1).uid}`), true)
  check('and nothing is left waiting', db.outboxSize(), 0)
  const doc = sb.records.get(`story:${db.getStory(1).uid}`)
  check('a story travels with its title', doc.data.title, 'Made before the cloud')
  check('and the project it is in, by name', doc.data.project_name, path.basename(REPO))
  check('but not its id on this machine, which means nothing anywhere else', 'id' in doc.data, false)
  check('it is written down as coming from this machine', doc.machine, cloud.machine())
}

// ── Numbers from the cloud ───────────────────────────────────────────────────
section('Numbers from the cloud')
{
  sb.nextKey = 40
  const k = await cloud.nextKey()
  check('signed in and let in, the next number is the cloud\'s', k, 40)
  const story = db.createStory({ project_path: REPO, title: 'Numbered by the cloud', cloud_key: k })
  check('and the story carries it', story.key, 'K40')
  check('this machine will not hand that number out again', db.createStory({ project_path: REPO, title: 'x', cloud_key: 41 }).key, 'K41')
}

// ── Offline ──────────────────────────────────────────────────────────────────
section('Offline')
{
  sb.up = false
  check('with the cloud unreachable there is no number', await cloud.nextKey(), null)
  check('and that is said rather than thrown', cloud.status().online, false)
  const story = db.createStory({ project_path: REPO, title: 'Made on a train', cloud_key: null })
  check('the story is made anyway, with a provisional key', /^K~\d+$/.test(story.key), true)
  const s = await sync.round()
  check('a round with no cloud does not throw', typeof s.sync_error, 'string')
  check('and keeps the change for later', db.outboxSize() > 0, true)
  check('the provisional key is still provisional', db.getStory(story.id).key, story.key)

  sb.up = true
  sb.nextKey = 50
  await sync.round()
  check('back online, it gets its real number', db.getStory(story.id).key, 'K50')
  check('and the queue empties', db.outboxSize(), 0)
  check('nothing provisional is left', db.provisionalKeys().length, 0)
  check('the cloud has it under the real number', sb.records.get(`story:${db.getStory(story.id).uid}`).data.key_num, 50)
}

// ── Changes made here ────────────────────────────────────────────────────────
section('Changes made here')
{
  const story = db.getStory(1)
  db.patchStory(story.id, { title: 'Renamed' })
  check('an edit is queued', db.outboxSize() >= 1, true)
  await sync.round()
  check('and arrives', sb.records.get(`story:${story.uid}`).data.title, 'Renamed')
  const epic = db.createEpic({ project_path: REPO, title: 'An epic', cloud_key: 60 })
  db.patchStory(story.id, { epic_id: epic.id })
  await sync.round()
  check('a reference goes up as the uid of what it points at', sb.records.get(`story:${story.uid}`).data.epic_id_uid, db.getEpic(epic.id).uid)
  db.deleteStory(story.id)
  await sync.round()
  check('a delete goes up as a delete, so other machines hear of it', sb.records.get(`story:${story.uid}`).deleted, true)
}

// ── Changes made elsewhere ───────────────────────────────────────────────────
section('Changes made elsewhere')
{
  const epicUid = '11111111-1111-4111-8111-111111111111'
  const storyUid = '22222222-2222-4222-8222-222222222222'
  const add = (kind, uid, data) => sb.records.set(`${kind}:${uid}`, { kind, uid, data, deleted: false, machine: 'other-laptop', changed_at: Date.now(), seq: ++sb.seq })
  // Out of order on purpose: the story arrives before the epic it is in.
  add('story', storyUid, { key_num: 70, title: 'From the other laptop', project_path: '/somewhere/else', epic_id_uid: epicUid, state: 'Backlog', created_at: 1, updated_at: 1 })
  add('epic', epicUid, { key_num: 69, title: 'Their epic', project_path: '/somewhere/else', created_at: 1, updated_at: 1 })
  await sync.round()
  const id = db.idOfUid('story', storyUid)
  check('a story made on another machine comes down', db.getStory(id)?.title, 'From the other laptop')
  check('with its number', db.getStory(id)?.key, 'K70')
  check('inside the epic it was in, whatever order they arrived in', db.getStory(id)?.epic_id, db.idOfUid('epic', epicUid))
  check('and is not sent straight back up', db.outboxSize(), 0)

  add('story', storyUid, { key_num: 70, title: 'Renamed over there', project_path: '/somewhere/else', state: 'Working', created_at: 1, updated_at: 2 })
  db.patchStory(id, { title: 'Renamed here, not sent yet' })
  sb.up = false
  await sync.round()
  sb.up = true
  // The pull happens after the push in a round, so to prove the rule the push has to fail first.
  const pulled = sync.apply([{ ...sb.records.get(`story:${storyUid}`) }])
  check('a change made here and not yet sent wins over one coming down', pulled.skipped, 1)
  check('so the title is still this machine\'s', db.getStory(id).title, 'Renamed here, not sent yet')
}

// ── Waiting to be let in ─────────────────────────────────────────────────────
section('Waiting to be let in')
{
  sb.approved = false
  await cloud.refreshMe()
  check('somebody signed in but not let in is told so', cloud.status().approved, false)
  check('and gets no numbers from the cloud', await cloud.nextKey(), null)
  const before = sb.calls.filter((c) => c === 'POST /rest/v1/records').length
  db.createStory({ project_path: REPO, title: 'while waiting' })
  await sync.round()
  check('and sends nothing up', sb.calls.filter((c) => c === 'POST /rest/v1/records').length, before)
  sb.approved = true
}

// ── Signing out ──────────────────────────────────────────────────────────────
section('Signing out')
{
  sync.detach()
  const out = await cloud.logout()
  check('signing out unlinks the board', out.linked, false)
  check('the sign-in is gone from disk', JSON.parse(fs.readFileSync(process.env.K0_CLOUD_FILE, 'utf8')).session, undefined)
  check('nothing more is queued', db.syncRecording(), false)
  check('and the next story is numbered here again', /^K\d+$/.test(db.createStory({ project_path: REPO, title: 'after' }).key), true)
}

// ── Where a repository lives ─────────────────────────────────────────────────
section('Where a repository lives')
check('ssh and https name the same repository', sync.normaliseRemote('git@github.com:alessio-ragni/k0-board.git'),
  sync.normaliseRemote('https://github.com/alessio-ragni/k0-board'))
check('a password in the address does not travel', sync.normaliseRemote('https://user:secret@github.com/a/b.git'), 'github.com/a/b')
check('no remote is no name', sync.normaliseRemote(''), '')

// ── An old board, numbered per repository ────────────────────────────────────
// What a board from before k0 Cloud looks like: every repository counted from one, so K1 exists
// several times over, and the text of the stories names other stories by those numbers.
section('An old board, numbered per repository')
{
  const A = '/tmp/k0-old-a'
  const B = '/tmp/k0-old-b'
  const a1 = db.createStory({ project_path: A, title: 'First in A', key_num: 9001 })
  const a2 = db.createStory({ project_path: A, title: 'Second in A', key_num: 9002, body: 'Needs K9001 done first, see also K9001·D3.' })
  const b1 = db.createStory({ project_path: B, title: 'First in B', key_num: 9001, body: 'Nothing to do with K9002 over there? K9001 here.' })
  const plan = db.renumberAll({ start: 500, apply: false })
  const mine = plan.filter((r) => [A, B].includes(r.project_path))
  check('the same old key in two repositories gets two new ones', new Set(mine.map((r) => r.new)).size, 3)
  db.renumberAll({ start: 500, apply: true })
  const newA1 = db.getStory(a1.id).key
  check('a key named in the text follows the story it named', db.getStory(a2.id).body, `Needs ${newA1} done first, see also ${newA1}·D3.`)
  check('but only inside its own repository', db.getStory(b1.id).body, `Nothing to do with K9002 over there? ${db.getStory(b1.id).key} here.`)
}
