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
check('nothing running at all', phaseOf({ running: false, now: NOW }), 'off')
check('a port held is up', phaseOf({ running: true, port: 4321, startedAt: NOW - 1000, now: NOW }), 'up')
check('alive but silent, and young', phaseOf({ running: true, port: null, startedAt: NOW - 2000, now: NOW }), 'starting')
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
