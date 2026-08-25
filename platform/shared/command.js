/**
 * Turning "run this program, in this directory, with these arguments" into one line a shell
 * will accept.
 *
 * It has to be one line because that is all a terminal can be handed: there is no argv on the
 * far side, only text typed into a shell. Which makes quoting the whole of the problem — a
 * project directory called `My Projects` or `it's-mine` has to survive the trip intact, and
 * a prompt passed as an argument can contain anything at all.
 */

/** POSIX single quotes: everything is literal inside them, and a quote ends and reopens them. */
export const posixQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`

export const posixCommand = ({ cwd, bin, args = [] }) =>
  ['cd', posixQuote(cwd), '&&', posixQuote(bin), ...args.map(posixQuote)].join(' ')

/** PowerShell single quotes: same idea, but a quote is escaped by doubling it. */
export const powershellQuote = (s) => `'${String(s).replace(/'/g, "''")}'`

export const powershellCommand = ({ cwd, bin, args = [] }) =>
  [
    `Set-Location ${powershellQuote(cwd)};`,
    '&',
    powershellQuote(bin),
    ...args.map(powershellQuote),
  ].join(' ')
