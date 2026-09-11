/**
 * Turning "run this program, in this directory, with these arguments" into one line a shell
 * will accept.
 *
 * It has to be one line because that is all a terminal can be handed: there is no argv on the
 * far side, only text typed into a shell. Which makes quoting the whole of the problem — a
 * project directory called `My Projects` or `it's-mine` has to survive the trip intact, and
 * a prompt passed as an argument can contain anything at all.
 */

/**
 * The environment the program is started with, as name/value pairs. A value is quoted like
 * everything else; a name cannot be quoted at all — it sits bare in front of an `=` — so anything
 * that is not plainly a name is refused before it can reach a shell.
 */
const envPairs = (env = {}) =>
  Object.entries(env).map(([name, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`not an environment variable name: ${JSON.stringify(name)}`)
    return [name, value]
  })

/** POSIX single quotes: everything is literal inside them, and a quote ends and reopens them. */
export const posixQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`

// Through `env` rather than a bare `NAME=value` in front: the terminal hands the line to whatever
// shell the user logs in with, and `env` reads the same in sh, zsh and fish alike.
export const posixCommand = ({ cwd, bin, args = [], env }) => {
  const pairs = envPairs(env).map(([name, value]) => `${name}=${posixQuote(value)}`)
  return ['cd', posixQuote(cwd), '&&', ...(pairs.length ? ['env', ...pairs] : []), posixQuote(bin), ...args.map(posixQuote)].join(' ')
}

/** PowerShell single quotes: same idea, but a quote is escaped by doubling it. */
export const powershellQuote = (s) => `'${String(s).replace(/'/g, "''")}'`

export const powershellCommand = ({ cwd, bin, args = [], env }) =>
  [
    `Set-Location ${powershellQuote(cwd)};`,
    ...envPairs(env).map(([name, value]) => `$env:${name}=${powershellQuote(value)};`),
    '&',
    powershellQuote(bin),
    ...args.map(powershellQuote),
  ].join(' ')
