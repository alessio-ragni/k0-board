import { check, section, after } from './harness.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseListeners, parseCwds, parseSs, parseNetTcp, portOf } from '../platform/shared/listeners.js'

// `servers.js` drags in `db.js`, which opens the database the moment it is imported — and it
// drags in `paths.js`, which decides where the logs go from `HOME`. Both are moved somewhere
// harmless BEFORE the import, because a plain `import` at the top would resolve first and open
// the real board. Same trap, and the same answer, as in mode.test.mjs.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-servers-test-'))
process.env.K0_DB = path.join(TMP, 'board.db')
process.env.K0_HOME = TMP
const servers = await import('../server/servers.js')
const store = await import('../server/db.js')
const { detectCommand, pickPort, phaseOf, urlFor, isInside, logPathFor, lastLine } = servers
const { attribute, ancestry, strayPids } = servers

// ── Which repositories get a globe ───────────────────────────────────────────
section('Which repositories get a globe')
// `dev` is what every one of these projects actually uses, and it wins outright.
check('dev is the one', detectCommand({ scripts: { dev: 'vite', serve: 'x' } })?.command, 'npm run dev')
check('serve when there is no dev', detectCommand({ scripts: { serve: 'http-server' } })?.command, 'npm run serve')
// `start` is excluded on purpose. By convention it runs what has been BUILT — and there is a
// concrete trap behind the convention: k0's own package.json has ONLY `start`, so accepting it
// would put a globe on k0 that launched a second k0 onto the port the first one is holding.
check('start is never chosen', detectCommand({ scripts: { start: 'node server/index.js' } }), null)
check('k0 itself gets no globe', detectCommand({ name: 'k0-board', scripts: { start: 'node server/index.js' } }), null)
check('nor does a package with no scripts', detectCommand({ name: 'x' }), null)
check('nor an empty script', detectCommand({ scripts: { dev: '   ' } }), null)
check('nor a script that is not a string', detectCommand({ scripts: { dev: 12 } }), null)
check('nor nothing at all', detectCommand(null), null)
check('nor a scripts field that is not an object', detectCommand({ scripts: 'dev' }), null)
// The command is never the script's own text: scripts chain, and only `npm run` puts
// node_modules/.bin on the PATH they chain through.
check(
  'the chained script is still run through npm',
  detectCommand({ scripts: { dev: 'velite && node scripts/build.mjs && vite' } })?.command,
  'npm run dev'
)

// ── Which port to show ───────────────────────────────────────────────────────
section('Which port to show')
// A framework that opens a second socket opens it above the one it was asked for, so the lowest
// is the one the person typed into their browser last time.
check('the lowest one', pickPort([5173, 24678, 4321]), 4321)
check('one is one', pickPort([3000]), 3000)
// Everything from 49152 up was handed out by the kernel for an outgoing connection. Those are
// not offers, and showing one would send the browser somewhere nothing is being served.
check('ephemeral ports are not offers', pickPort([51000, 60123]), null)
check('but a real one among them still counts', pickPort([51000, 4321]), 4321)
check('nothing listening is null, not zero', pickPort([]), null)
check('and neither is a missing set', pickPort(undefined), null)
check('a port out of range is not a port', pickPort([0]), null)

check('the address is built from the port', urlFor(4321), 'http://localhost:4321')
check('and there is no address without one', urlFor(null), null)

// ── The four states ──────────────────────────────────────────────────────────
section('The four states')
const NOW = 1_700_000_000_000
// "Up" is never a reply to a request — k0 makes no network requests. It is: the process is
// alive AND the system says it is holding a port. That is stronger evidence anyway: a server
// still compiling would answer a request with an error and this test with the truth.
check('nothing running, and nothing asked for', phaseOf({ started: false, running: false, now: NOW }), 'off')
check('a port held is up', phaseOf({ started: true, running: true, port: 4321, startedAt: NOW - 1000, now: NOW }), 'up')
check('alive but silent, and young', phaseOf({ started: true, running: true, port: null, startedAt: NOW - 2000, now: NOW }), 'starting')
// The whole reason the globe can go red instead of quietly grey. k0 was told to start this and
// there is no process: it fell over, and shrugging would hide the one thing worth saying.
check('started, and gone', phaseOf({ started: true, running: false, startedAt: NOW - 2000, now: NOW }), 'failed')
check('and a server nobody asked for is simply off', phaseOf({ started: false, running: false, now: NOW }), 'off')
// A server somebody else started has no row at all, so it is up while it is seen and off after.
check('an adopted server needs no row to be up', phaseOf({ started: false, running: true, port: 3000, now: NOW }), 'up')
// `next dev` and a `velite && vite` chain both take their time, so the patience is generous —
// but it is not infinite, because a globe that spun for ever would say less than a red one.
check('still starting at 89 seconds', phaseOf({ running: true, port: null, startedAt: NOW - 89_000, now: NOW }), 'starting')
check('given up at 91', phaseOf({ running: true, port: null, startedAt: NOW - 91_000, now: NOW }), 'failed')
// A row in the database means "k0 started this and it is meant to be up". Stopping deletes the
// row, so a row whose process has gone is a server that FELL OVER — which is the whole reason
// the globe can go red instead of quietly grey.
check('a port outlives a long start', phaseOf({ running: true, port: 3000, startedAt: NOW - 500_000, now: NOW }), 'up')
// The first glance after k0 itself was restarted: the dev server has been up for hours, and
// nothing has been read off the machine yet. Calling that "failed" would put a red globe on a
// site that is serving perfectly well — which is precisely the thing k0 restarting must not do.
check(
  'nothing read yet is not a verdict',
  phaseOf({ running: true, port: null, startedAt: NOW - 3_600_000, now: NOW, sampled: false }),
  'starting'
)
check(
  'and once it has been read, the verdict stands',
  phaseOf({ running: true, port: null, startedAt: NOW - 3_600_000, now: NOW, sampled: true }),
  'failed'
)

// ── Which server belongs to which repository ─────────────────────────────────
section('Which server belongs to which repository')
check('the repository itself', isInside('/Users/you/site', '/Users/you/site'), true)
check('a directory inside it', isInside('/Users/you/site/src', '/Users/you/site'), true)
// The separator is the whole point: without it `/Users/you/site-old` would be adopted as if it
// were `/Users/you/site`, and the globe would govern the wrong server.
check('a neighbour that merely starts the same', isInside('/Users/you/site-old', '/Users/you/site'), false)
check('somewhere else entirely', isInside('/tmp', '/Users/you/site'), false)
check('an unknown directory belongs nowhere', isInside(null, '/Users/you/site'), false)
check('and nothing belongs to an unknown repository', isInside('/Users/you/site', null), false)

// ── Where the log goes ───────────────────────────────────────────────────────
section('Where the log goes')
// The transcript directory trap in reverse: two repositories whose names collapse to the same
// text must not collapse to the same file, or one would overwrite the other's failure.
check('the name is in it, so it can be read', path.basename(logPathFor('/Users/you/my-site')).startsWith('dev-my-site-'), true)
check(
  'two repositories with the same name never share a file',
  logPathFor('/a/site') === logPathFor('/b/site'),
  false
)
check(
  'and a name that only differs by punctuation does not either',
  logPathFor('/Users/you/my_site') === logPathFor('/Users/you/my-site'),
  false
)
check('the same repository always gets the same file', logPathFor('/a/site') === logPathFor('/a/site'), true)
check('it lives under the k0 home, with the other logs', logPathFor('/a/site').startsWith(path.join(TMP, 'logs')), true)

// ── What a failure has to say ────────────────────────────────────────────────
section('What a failure has to say')
check('the last thing said is the reason', lastLine('starting\nError: port 4321 is taken\n'), 'Error: port 4321 is taken')
check('blank lines at the end are not the reason', lastLine('the reason\n\n\n'), 'the reason')
// Terminal colour codes are noise in a tooltip: what arrives is the sentence, not the escape.
check('colour codes are stripped', lastLine('[31mError: nope[0m'), 'Error: nope')
check('nothing said is nothing shown', lastLine(''), '')
check('and neither is nothing at all', lastLine(undefined), '')
check('a very long line is cut, and says it was', lastLine('x'.repeat(400)).length, 200)
check('the cut is marked', lastLine('x'.repeat(400)).endsWith('…'), true)

// The log itself is read from the END, because a dev server that has been up all afternoon has
// written megabytes and only the last few lines are the reason it stopped.
{
  const file = path.join(TMP, 'a.log')
  fs.writeFileSync(file, 'first\nsecond\nthird\n')
  check('a small log is read whole', servers.logTail(file).trim().split('\n').length, 3)
  fs.writeFileSync(file, 'buried\n' + 'y'.repeat(9000) + '\nthe last word\n')
  const tail = servers.logTail(file, 64)
  check('a big one gives back only its end', tail.length <= 64, true)
  check('and the end is what was wanted', lastLine(tail), 'the last word')
  check('the beginning is genuinely not in it', tail.includes('buried'), false)
  // A server that never wrote anything, or a log that was never created: nothing to say, and
  // certainly not a crash on the way to drawing a globe.
  check('a log that is not there reads as nothing', servers.logTail(path.join(TMP, 'nope.log')), '')
  check('and so does an empty one', servers.logTail((fs.writeFileSync(path.join(TMP, 'e.log'), ''), path.join(TMP, 'e.log'))), '')
}

// ── Reading the sockets, from lsof ───────────────────────────────────────────
section('Reading the sockets, from lsof')
// Real output, from `lsof -nP -iTCP -sTCP:LISTEN -F pn`. The `f` lines are the thing to notice:
// lsof emits them whether or not they were asked for, so the parser steps over what it did not
// ask for rather than trying to understand it.
const LSOF = [
  'p635', 'f10', 'n*:49168', 'f11', 'n*:49168',
  'p5864', 'f17', 'n127.0.0.1:4319',
  'p8859', 'f80', 'n[::1]:3000', 'f95', 'n*:57621',
].join('\n')
{
  const ports = parseListeners(LSOF)
  check('three processes are listening', ports.size, 3)
  // The same port on IPv4 and IPv6 is one port, not two: the set folds them.
  check('a port held twice is still one port', [...ports.get(635)].join(), '49168')
  check('the port is read off the address', [...ports.get(5864)].join(), '4319')
  // The last colon is the separator, which is what makes IPv6 harmless.
  check('an IPv6 address is not two ports', [...ports.get(8859)].sort((a, b) => a - b).join(), '3000,57621')
}
check('nothing listening parses to nothing', parseListeners('').size, 0)
check('and so does nothing at all', parseListeners(undefined).size, 0)
// A name with no process in front of it belongs to nobody and is dropped rather than guessed at.
check('an orphan address is not attributed', parseListeners('n*:4321').size, 0)

check('a plain address', portOf('127.0.0.1:4321'), 4321)
check('a wildcard address', portOf('*:4321'), 4321)
check('an IPv6 address', portOf('[::1]:4321'), 4321)
check('an address with no port', portOf('/tmp/some.sock'), null)
check('a port that is not a number', portOf('*:*'), null)
check('a port past the end of the range', portOf('*:70000'), null)

// ── Where a process is working from ──────────────────────────────────────────
section('Where a process is working from')
{
  const cwds = parseCwds(['p5864', 'fcwd', 'n/Users/you/k0', 'p900', 'fcwd', 'n/Users/you/site'].join('\n'))
  check('one directory each', cwds.size, 2)
  check('and it is the directory', cwds.get(900), '/Users/you/site')
}
check('an empty answer is an empty map', parseCwds('').size, 0)

// ── Reading the sockets, from ss ─────────────────────────────────────────────
section('Reading the sockets, from ss')
// The Linux fallback: `ss` arrives with iproute2, where lsof arrives with nothing, so a minimal
// system is likelier to have this one than the other.
const SS = [
  'LISTEN 0 511  *:4321  *:*  users:(("node",pid=1234,fd=20))',
  'LISTEN 0 511  [::]:3000  [::]:*  users:(("node",pid=5678,fd=21),("node",pid=5679,fd=21))',
  'LISTEN 0 128  127.0.0.1:631  0.0.0.0:*',
].join('\n')
{
  const ports = parseSs(SS)
  check('the port comes off the fourth column', [...ports.get(1234)].join(), '4321')
  // A socket shared by a parent and its child is owned by both, and either one is a fair
  // answer to "what is holding this port".
  check('a shared socket belongs to both holders', [...ports.get(5678)].join() + '/' + [...ports.get(5679)].join(), '3000/3000')
  check('a listener with no process named is skipped', ports.has(631), false)
  check('so only the two are known', ports.size, 3)
}
check('an empty answer is an empty map', parseSs('').size, 0)

// ── Reading the sockets, on Windows ──────────────────────────────────────────
section('Reading the sockets, on Windows')
const NETSTAT = ['"LocalPort","OwningProcess"', '"4321","1234"', '"3000","5678"', '"70000","9"'].join('\n')
{
  const ports = parseNetTcp(NETSTAT)
  check('the header is not a row', ports.size, 2)
  check('the port belongs to its owner', [...ports.get(1234)].join(), '4321')
  check('a port past the end of the range is dropped', ports.has(9), false)
}
check('an empty answer is an empty map', parseNetTcp('').size, 0)

// ── Which server belongs to which repository, in full ────────────────────────
section('Which server belongs to which repository, in full')
// One machine, written out once and read several ways. k0 is pid 100. Two dev servers: one k0
// started in /w/site (the shell 200, npm 210, vite 220 holding 4321), and one somebody typed in
// a terminal in /w/shop (the shell 300 — which is the TERMINAL's shell, working from home — npm
// 310 and next 320 holding 3000).
const PROCS = new Map([
  [1, { ppid: 0, cmd: '/sbin/launchd' }],
  [100, { ppid: 1, cmd: 'node server/index.js' }],
  [110, { ppid: 100, cmd: 'lsof -nP -iTCP' }],
  [200, { ppid: 1, cmd: '/bin/zsh -lc npm run dev' }],
  [210, { ppid: 200, cmd: 'npm run dev' }],
  [220, { ppid: 210, cmd: 'node vite' }],
  [300, { ppid: 1, cmd: '-zsh' }],
  [310, { ppid: 300, cmd: 'npm run dev' }],
  [320, { ppid: 310, cmd: 'node next dev' }],
])
const KIDS = new Map([
  [0, [1]], [1, [100, 200, 300]], [100, [110]], [200, [210]], [210, [220]], [300, [310]], [310, [320]],
])
const PORTS = new Map([
  [100, new Set([4319])], // k0 itself
  [220, new Set([4321, 24678])], // the one k0 started: vite, plus its second socket
  [320, new Set([3000])], // the one typed by hand
])
const CWDS = new Map([
  [200, '/w/site'], [210, '/w/site'], [220, '/w/site'],
  [300, '/w/you'], [310, '/w/shop'], [320, '/w/shop'],
])
const ROWS = [{ project_path: '/w/site', pid: 200, command: 'npm run dev' }]
const REPOS = ['/w/site', '/w/shop', '/w/quiet']
const facts = (over = {}) =>
  attribute({ ports: PORTS, procs: PROCS, kids: KIDS, cwds: CWDS, rows: ROWS, repos: REPOS, isAlive: () => true, self: 100, ...over })

{
  const by = facts()
  check('both servers are found', [...by.keys()].sort().join(' '), '/w/shop /w/site')
  check('a repository with nothing running is not in the map', by.has('/w/quiet'), false)
  // The port is held by a grandchild, not by the process k0 spawned: finding it is the whole
  // reason the subtree is walked.
  check("the port of the one k0 started is its grandchild's", by.get('/w/site').port, 4321)
  check('and the second socket vite opens is not the answer', by.get('/w/site').port === 24678, false)
  check('it is not adopted, k0 started it', by.get('/w/site').adopted, false)
  check('the root to stop is the process k0 spawned', by.get('/w/site').root, 200)
  check('and the whole subtree goes with it', by.get('/w/site').pids.sort((a, b) => a - b).join(), '200,210,220')

  check('the one typed by hand is found too', by.get('/w/shop').port, 3000)
  check('and it is marked as somebody else’s', by.get('/w/shop').adopted, true)
  // The terminal's own shell is working from HOME, not from the repository, so the climb stops
  // at npm. Stopping the shell instead would close the user's terminal window to stop a server.
  check('the climb stops before the terminal’s shell', by.get('/w/shop').root, 310)
  check('so only npm and next are signalled', by.get('/w/shop').pids.sort((a, b) => a - b).join(), '310,320')
}
{
  // k0 listens on a port and may well be working from a repository on this very board. It is not
  // a dev server, and it is certainly not one to offer to kill.
  const by = facts({ repos: ['/w/k0'], cwds: new Map([...CWDS, [100, '/w/k0'], [110, '/w/k0']]), rows: [] })
  check('k0 never adopts itself', by.has('/w/k0'), false)
}
{
  // The guard against a recycled pid: k0 remembers starting something in /w/quiet as pid 900,
  // but 900 is now a stranger's process. Believing the row would mean a click on the globe
  // killing whatever now wears that number.
  const procs = new Map([...PROCS, [900, { ppid: 1, cmd: '/usr/bin/some-other-program' }]])
  const rows = [{ project_path: '/w/quiet', pid: 900, command: 'npm run dev' }]
  const by = facts({ procs, rows })
  check('a pid that has been handed out again is not believed', by.has('/w/quiet'), false)
}
{
  const rows = [{ project_path: '/w/quiet', pid: 900, command: 'npm run dev' }]
  const by = facts({ rows, isAlive: (pid) => pid !== 900 })
  check('nor is one whose process has gone', by.has('/w/quiet'), false)
}
{
  // And the other side of that guard, which matters just as much: when the row is not believed
  // but the server really IS running from that directory, it is adopted rather than lost. k0
  // forgetting what it started is not a reason to show a green site as off.
  const by = facts({ rows: [] })
  check('a forgotten server is found again anyway', by.get('/w/site').port, 4321)
  check('and it comes back as somebody else’s', by.get('/w/site').adopted, true)
  // The climb reaches the shell k0 spawned, because that one really is working in the repository.
  check('with the top of its tree to stop', by.get('/w/site').root, 200)
}
{
  // Started, but nothing listening yet: it is still in the map — that is what makes the globe
  // spin rather than go dark — with no port to show.
  const by = facts({ ports: new Map(), repos: ['/w/site'] })
  check('a server still coming up is known, with no port', by.get('/w/site').port, null)
}
{
  // Windows: the working directory of another process cannot be read, so adoption is off. The
  // servers k0 started are still governed; the others are not claimed on a guess.
  const by = facts({ canAdopt: false })
  check('without adoption only k0’s own are found', [...by.keys()].join(), '/w/site')
}
{
  // A neighbour whose path merely starts the same must not be adopted as if it were the repo.
  const by = facts({ repos: ['/w/sit'], rows: [] })
  check('a near-miss on the path is not a match', by.has('/w/sit'), false)
}

section('Climbing to the top of a server')
check('every process up to the top', ancestry(PROCS, 320, 100).join(), '320,310,300')
check('a process with no parent known is on its own', ancestry(new Map(), 999, 100).join(), '999')
check('the climb stops at k0 itself', ancestry(PROCS, 110, 100).join(), '110')
check('and it stops at init', ancestry(PROCS, 200, 100).join(), '200')

section('Who is worth asking about')
check('k0 and its children are not', strayPids(PORTS, PROCS, KIDS, 100).sort((a, b) => a - b).join(), '220,320')
check('with no process table, only k0 itself is excluded', strayPids(PORTS, new Map(), new Map(), 100).join(), '220,320')

// ── The record of intent ─────────────────────────────────────────────────────
section('The record of intent')
// The table is not a record of what is RUNNING — that is read off the machine every few seconds
// and nothing stored could keep up with it. It is a record of intent, and that is what tells a
// server that was switched off apart from one that fell over.
{
  check('nothing is remembered to begin with', store.getDevServer('/a/site'), null)
  store.setDevServer('/a/site', { pid: 4242, command: 'npm run dev', startedAt: NOW })
  check('what was started is remembered', store.getDevServer('/a/site').pid, 4242)
  check('with the command that started it', store.getDevServer('/a/site').command, 'npm run dev')
  store.setDevServer('/a/site', { pid: 4343, command: 'npm run dev', startedAt: NOW + 1 })
  check('starting again replaces, it does not pile up', store.listDevServers().length, 1)
  check('and it is the new process that is remembered', store.getDevServer('/a/site').pid, 4343)
  store.setDevServer('/b/site', { pid: 5555, command: 'npm run serve', startedAt: NOW })
  check('two repositories, two rows', store.listDevServers().length, 2)
  // Stopping deletes the row. That is the whole mechanism behind the red globe: a row whose
  // process has gone was never stopped, so it fell over.
  store.clearDevServer('/a/site')
  check('stopping forgets it', store.getDevServer('/a/site'), null)
  check('and leaves the other alone', store.getDevServer('/b/site').pid, 5555)
  store.clearDevServer('/nowhere')
  check('forgetting what was never there is not an error', store.listDevServers().length, 1)
}

// ── A repository with nothing to run ─────────────────────────────────────────
section('A repository with nothing to run')
// No package.json at all: no command, and therefore no globe — not a globe that would do
// nothing when pressed.
check('a directory that is not a project has no globe', servers.stateOf(path.join(TMP, 'empty')), null)
{
  const repo = path.join(TMP, 'site')
  fs.mkdirSync(repo, { recursive: true })
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }))
  const state = servers.stateOf(repo)
  check('a project with a dev script has one', state.state, 'off')
  check('and it knows what it would run', state.command, 'npm run dev')
  check('with nowhere to send you yet', state.url, null)
  servers.forget()
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' } }))
  check('and it loses the globe if the script goes', servers.stateOf(repo), null)
}

// Tidying up waits until the tests have run, which is what `after` is for. The handle goes
// before the files do: on Windows an open file cannot be deleted.
after(async () => {
  ;(await import('../server/db.js')).close()
  fs.rmSync(TMP, { recursive: true, force: true })
})
