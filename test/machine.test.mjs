import { check, section } from './harness.mjs'
import { childrenOf, subtree, verdict, shortName } from '../server/machine.js'
import { cpuSeconds, parsePs } from '../platform/shared/ps.js'
import { parseVmStat, parseSwap } from '../platform/darwin/metrics.js'
import { parseMeminfo, parseSwapFromMeminfo, parsePressure } from '../platform/linux/metrics.js'

// ── CPU time ─────────────────────────────────────────────────────────────────
section('CPU time')
// It is needed for the difference between two samples, which is the only way to know how hard a
// session is working NOW: `ps`'s own `%cpu` is the average since the process was born.
check('minutes and seconds, as ps usually writes them', cpuSeconds('9:40.82'), 580.82)
check('even when the minutes add up', cpuSeconds('136:21.14'), 8181.14)
check('a process just born', cpuSeconds('0:00.01'), 0.01)
check('hours, minutes and seconds', cpuSeconds('2:03:04'), 7384)
check('and the days in front', cpuSeconds('1-00:00:10'), 86410)
check('something unintelligible is worth zero', cpuSeconds('anything'), 0)
check('and so is nothing at all', cpuSeconds(undefined), 0)

// ── The lines of ps ──────────────────────────────────────────────────────────
section('The lines of ps')
const PS = [
  '    1     0   5680 136:21.14 /sbin/launchd',
  ' 45913 45020 285840   8:20.34 /home/you/.local/bin/claude',
  ' 45945 45913   9216   0:01.00 npm exec chrome-devtools-mcp@latest --user-data-dir=/home/you/.cache/x',
  ' 45996 45945 320000   0:30.00 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --type=renderer',
  ' 11972 45913   1024   0:00.10 caffeinate -i -t 300',
].join('\n')

{
  const procs = parsePs(PS)
  check('one row per process', procs.size, 5)
  check('memory arrives in bytes, not KB', procs.get(45913).rss, 285840 * 1024)
  check('the parent is read', procs.get(45945).ppid, 45913)
  check('and so is the CPU time', procs.get(45913).cpu, 500.34)
  check('the command keeps the spaces it has', procs.get(45996).cmd.includes('Google Chrome.app'), true)
  check('a broken line is skipped', parsePs('rubbish\n\n').size, 0)

  // The number that counts: everything a session has dragged along behind it. The `claude`
  // process on its own would say 279 MB, the subtree says 602 — and inside it there is a 312 MB
  // Chrome the card would never have confessed to on its own.
  const kids = childrenOf(procs)
  const pids = subtree(kids, 45913)
  check('the subtree takes children and grandchildren', pids.size, 4)
  check('and it does not take what has nothing to do with it', pids.has(1), false)
  const rss = [...pids].reduce((n, p) => n + procs.get(p).rss, 0)
  check('the sum is that of the whole tree', Math.round(rss / 1048576), 602)
}

// Two processes that are each other's parent do not exist, but if they did the sum would spin
// forever. Here it has to end, and count them once.
{
  const procs = parsePs(['  7 8 100 0:01.00 one', '  8 7 100 0:01.00 two'].join('\n'))
  check('a loop does not spin forever', subtree(childrenOf(procs), 7).size, 2)
}

// ── Memory, macOS ────────────────────────────────────────────────────────────
section('Memory, macOS')
// Real `vm_stat` output, taken from a real machine. "Used" memory is what Activity Monitor also
// counts: the applications' pages plus wired plus compressed. Files held in cache are not
// memory anybody is short of and stay out.
const VM = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    52643.
Pages active:                                 509014.
Pages inactive:                               477200.
Pages speculative:                             31425.
Pages wired down:                             289230.
Pages purgeable:                               11332.
File-backed pages:                            216167.
Anonymous pages:                              801472.
Pages occupied by compressor:                 168646.`

{
  const m = parseVmStat(VM)
  const P = 16384
  check("the applications' memory is anonymous minus purgeable", m.app, (801472 - 11332) * P)
  check('the wired', m.wired, 289230 * P)
  check('the compressed', m.compressed, 168646 * P)
  check('and the sum is the memory in use', m.used, (801472 - 11332 + 289230 + 168646) * P)
  check('the file cache is not memory anybody is short of', m.cached, 216167 * P)
  check('unintelligible output breaks nothing', parseVmStat('anything').used, 0)
}

check(
  'the swap in use',
  parseSwap('vm.swapusage: total = 13312.00M  used = 12660.19M  free = 651.81M  (encrypted)').used,
  12660.19 * 1024 ** 2
)
check(
  'and the total',
  parseSwap('vm.swapusage: total = 13312.00M  used = 12660.19M  free = 651.81M').total,
  13312 * 1024 ** 2
)
check('with no swap, zero', parseSwap('').total, 0)

// ── Memory, Linux ────────────────────────────────────────────────────────────
section('Memory, Linux')
// Real `/proc/meminfo` output, cut down to the lines that matter. "Used" is total minus
// MemAvailable, which is the kernel's own estimate of what a new process could get hold of
// without swapping — a far better answer than total minus free.
const MEMINFO = `MemTotal:       16384000 kB
MemFree:          512000 kB
MemAvailable:    8192000 kB
Buffers:          256000 kB
Cached:          4096000 kB
SwapTotal:       2048000 kB
SwapFree:        1024000 kB
Zswapped:          64000 kB
SUnreclaim:       128000 kB`

{
  const m = parseMeminfo(MEMINFO)
  const K = 1024
  check('the total is what the kernel says', m.total, 16384000 * K)
  check('used is total minus what is available', m.used, (16384000 - 8192000) * K)
  check('the cache is buffers plus cached', m.cached, (256000 + 4096000) * K)
  check('unreclaimable slab stands in for wired', m.wired, 128000 * K)
  check('and zswap for compressed', m.compressed, 64000 * K)
  // With no file at all the totals come from Node itself rather than from /proc: the point is
  // that it answers with a number instead of throwing.
  check('an empty file does not blow up', Number.isFinite(parseMeminfo('').used), true)

  const s = parseSwapFromMeminfo(MEMINFO)
  check('the swap total', s.total, 2048000 * K)
  check('and the part of it in use', s.used, (2048000 - 1024000) * K)
}

// Pressure Stall Information: the fraction of the last ten seconds in which something was
// stalled waiting for memory. The thresholds are the only part k0 chooses.
check('nothing stalling: normal', parsePressure('some avg10=0.00 avg60=0.00 avg300=0.00 total=0'), 1)
check('some stalling: a warning', parsePressure('some avg10=8.42 avg60=3.00 avg300=1.00 total=99'), 2)
check('a lot of stalling: critical', parsePressure('some avg10=45.10 avg60=30.00 avg300=9.00 total=99'), 4)
check('no PSI on this kernel: normal', parsePressure(''), 1)

// ── The verdict ──────────────────────────────────────────────────────────────
section('The verdict')
// It is the kernel's, not ours: 1 normal, 2 warning, 4 critical. Where the kernel publishes
// nothing the level is always 1, and the memory rule is the whole verdict.
const mem = (fraction) => ({ total: 100, used: fraction * 100 })
check('the kernel says all is well', verdict(1, mem(0.5)), 'ok')
check('the kernel warns', verdict(2, mem(0.5)), 'warn')
check('the kernel says it is critical', verdict(4, mem(0.5)), 'bad')
check('memory nearly gone: a warning even when the kernel is silent', verdict(1, mem(0.93)), 'warn')
check('below the threshold we stay calm', verdict(1, mem(0.89)), 'ok')

// ── The name to show ─────────────────────────────────────────────────────────
section('The name to show')
// Without this, half the processes would be called "node" and none of it would mean anything.
check(
  'a macOS application has its name in the bundle',
  shortName('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
  'Google Chrome'
)
// Helpers are counted under the name of the application that opened them, which is what is
// wanted: Chrome opens twenty, and "Google Chrome 4.5 GB" says far more than twenty rows.
check(
  'helpers count towards the application that opens them',
  shortName('/Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper'),
  'Claude'
)
check('an ordinary binary', shortName('/home/you/.local/bin/claude'), 'claude')
check('an MCP server started with npm', shortName('npm exec chrome-devtools-mcp@latest --user-data-dir=/x'), 'chrome-devtools-mcp')
check('a script behind node', shortName('/usr/local/bin/node /home/you/p/node_modules/.bin/tsc -b --noEmit'), 'tsc')
check('a commit hook', shortName('sh -e /home/you/p/.husky/pre-commit'), 'pre-commit')
check('an executable on Windows', shortName('C:\\nodejs\\node.exe C:\\p\\server.js'), 'server.js')
check("behind node -e there is no program: better to say node", shortName(`node -e import('./x.js').then(f)`), 'node')
check('and when there is nothing at all', shortName(''), 'unknown')

