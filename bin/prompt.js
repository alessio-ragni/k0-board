import readline from 'node:readline'

/**
 * Asking, and saying, on a terminal.
 *
 * Small enough to write by hand, and worth writing by hand: an installer that pulls in a
 * prompt library is an installer that can break because somebody else's package broke.
 */

export const colours = process.stdout.isTTY && !process.env.NO_COLOR

const wrap = (code) => (s) => (colours ? `\u001b[${code}m${s}\u001b[0m` : s)

export const bold = wrap('1')
export const dim = wrap('2')
export const red = wrap('31')
export const green = wrap('32')
export const yellow = wrap('33')

export const say = (...args) => console.log(...args)
export const step = (text) => console.log(`\n${bold('▸')} ${bold(text)}`)
export const ok = (text) => console.log(`  ${green('✓')} ${text}`)
export const warn = (text) => console.log(`  ${yellow('!')} ${text}`)
export const fail = (text) => console.log(`  ${red('✗')} ${text}`)
export const note = (text) => console.log(`  ${dim(text)}`)

/**
 * A yes/no question. `fallback` is the answer when there is nobody to ask — a pipe, a CI job —
 * because a question nobody can hear must not hang forever.
 */
export function confirm(question, { fallback = false } = {}) {
  if (!process.stdin.isTTY) return Promise.resolve(fallback)
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(`${question} ${dim(fallback ? '[Y/n]' : '[y/N]')} `, (answer) => {
      rl.close()
      const a = answer.trim().toLowerCase()
      resolve(a === '' ? fallback : a === 'y' || a === 'yes')
    })
  })
}
