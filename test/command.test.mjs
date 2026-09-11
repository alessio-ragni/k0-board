import { check, section } from './harness.mjs'
import { posixCommand, powershellCommand } from '../platform/shared/command.js'

// ── The one line a terminal is handed ────────────────────────────────────────
// Every session k0 opens goes through one of these two, and since Claude Code 2.1 the line also has
// to carry an environment variable: without it a session on a newer model starts with no task
// tools at all. What is worth proving is that the variable lands where the shell reads it, that a
// line with no variables is the line it always was, and that a name which could smuggle a command
// in never reaches the shell.

const threw = (fn) => {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

section('POSIX')
check(
  'with no variables the line is the one it always was',
  posixCommand({ cwd: '/My Projects/k0', bin: '/bin/claude', args: ['-n', 'Fix-Now'] }),
  "cd '/My Projects/k0' && '/bin/claude' '-n' 'Fix-Now'"
)
check(
  'an empty set of variables changes nothing',
  posixCommand({ cwd: '/p', bin: 'claude', env: {} }),
  "cd '/p' && 'claude'"
)
check(
  'a variable goes in front of the program, through env',
  posixCommand({ cwd: '/p', bin: 'claude', args: ['-n', 'x'], env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' } }),
  "cd '/p' && env CLAUDE_CODE_ENABLE_TODO_TOOLS='1' 'claude' '-n' 'x'"
)
check(
  'a value with a quote in it survives',
  posixCommand({ cwd: '/p', bin: 'claude', env: { NOTE: "it's" } }),
  "cd '/p' && env NOTE='it'\\''s' 'claude'"
)
check(
  'a name that is not a name is refused',
  threw(() => posixCommand({ cwd: '/p', bin: 'claude', env: { 'X; rm -rf ~': '1' } })),
  true
)

section('PowerShell')
check(
  'with no variables the line is the one it always was',
  powershellCommand({ cwd: 'C:\\k0', bin: 'claude.exe', args: ['-n', 'x'] }),
  "Set-Location 'C:\\k0'; & 'claude.exe' '-n' 'x'"
)
check(
  'a variable is set before the program runs',
  powershellCommand({ cwd: 'C:\\k0', bin: 'claude.exe', env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' } }),
  "Set-Location 'C:\\k0'; $env:CLAUDE_CODE_ENABLE_TODO_TOOLS='1'; & 'claude.exe'"
)
check(
  'a value with a quote in it survives',
  powershellCommand({ cwd: 'C:\\k0', bin: 'claude.exe', env: { NOTE: "it's" } }),
  "Set-Location 'C:\\k0'; $env:NOTE='it''s'; & 'claude.exe'"
)
check(
  'a name that is not a name is refused',
  threw(() => powershellCommand({ cwd: 'C:\\k0', bin: 'claude.exe', env: { 'X=1; calc': '1' } })),
  true
)
