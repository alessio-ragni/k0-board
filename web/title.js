/**
 * The title rule, one for everybody: the browser uses it as you type and the server uses it
 * when it names the session. What you see in the field is exactly the name the session gets.
 *
 * Every word takes a capital on its first letter and keeps the rest EXACTLY as you wrote it —
 * so "Fix API" stays "Fix-API", while "fix api" becomes "Fix-Api". Spaces become dashes.
 *
 *   claude code      -> Claude-Code
 *   Fix-API          -> Fix-API
 *   fix api          -> Fix-Api
 *   this and that    -> This-And-That
 *   Export CSV       -> Export-CSV
 */
export const MAX = 60

export function titleCase(raw) {
  return (raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // accents go: this name ends up in a terminal
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+/, '') // a trailing dash stays: it is what lets you type the word after a space
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join('-')
    .slice(0, MAX)
}
