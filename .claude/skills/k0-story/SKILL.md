---
name: k0-story
description: Puts one story on the k0 board in a single move — the user says what he wants, it lands as a post-it with a key of its own, and a Claude Code session can start on it straight away. No questions, no rounds, no ceremony: this is the fast door. Use this skill when the user says "/k0-story", "add a story", "put this on the board", "new post-it", "note this down for later", "one more thing for the backlog", "and start it now", or in Italian "aggiungi una storia", "mettila sul board", "segnati questa cosa", "nuova storia e partiamo". Do not use it for something big enough to need breaking up — that is /k0-epic — and do not use it on a story that already exists: discussing it is /k0-discuss, planning it is /k0-plan, working it is /k0-work.
---

# /k0-story [what it is]

One story, straight onto the board. The user has already said what he wants; your job is to
write it down well and get out of the way. **No rounds, no questions, no confirmation** unless
he asks for one or something is genuinely missing.

If he also says *and start it* — or anything like it — start the session in the same breath.

## Before anything

```bash
PORT="${K0_PORT:-4319}"
REPO="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; REPO="${REPO%/.git}"
[ -d "$REPO" ] || REPO="$(git rev-parse --show-toplevel 2>/dev/null)"
curl -sS --max-time 30 --get --data-urlencode "repo=$REPO" \
  "http://127.0.0.1:$PORT/api/backlog" -o "$SCRATCH/k0-backlog.json"
node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  console.log(JSON.stringify({enabled: b.enabled, epics: (b.epics||[]).map(e => ({key: e.key, title: e.title}))}))' \
  "$SCRATCH/k0-backlog.json"
```

`127.0.0.1`, not `k0.localhost`: browsers resolve that name by themselves, `curl` does not.
`--get --data-urlencode`, not `?repo=$REPO`: a repository path with a space in it makes `curl`
refuse the address outright, and one with a `#` in it quietly sends half.
`$SCRATCH` is the session's scratch directory; nothing is written outside it. `REPO` is the
repository the stories are filed under — the main one, even when this session sits in a
subdirectory of it or inside a worktree, which is why it is not `$PWD`.

- `curl` cannot connect → the k0 server is not running. Say so (`k0-board start`, or the tray
  icon → *Restart*) and **stop**.
- `enabled` is `false` → say in one line that the backlog is switched off in k0's settings and
  **stop**. Do not create anything and do not argue for turning it on.
- `REPO` empty → this is not a git repository. Ask once which repository the story belongs to
  and take the path he gives. That is the only question this skill asks on its own.

**Read the two lines `node` prints, not the file.** The board's answer carries every story in the
repository with everything known about each one, and this skill needs exactly two things out of
it: whether the feature is on, and what the epics are called. On a board of a hundred stories,
reading all of that to write one post-it costs more than the post-it does. If the user named no
epic, even the list of epics is surplus — check `enabled` and move on.

If he did name one in passing — *"this one goes under invoicing"* — match it in that list and use
its `key`. Do not ask which epic: a story with no epic is perfectly normal and stands on its own all
the same.

## Write it

- **`title`** — 2 to 6 words, 60 characters at most, the thing itself. Readable, not a slug.
- **`body`** — the *why*, in one or two sentences: what he wants and what it is for. **His
  words, his language**, tidied but not translated and not padded. If he said one sentence, the
  body is one sentence.
- **`lang`** — the language he spoke: `it`, `en`, and so on.
- **`prompt`** — only when the story is starting now: the instruction the session opens with.

Do not invent scope. If he described half a thing, the story is half a thing — a story is
allowed to be thin, and `/k0-discuss` exists for the rest.

## Create it

```bash
curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/story" \
  -H 'content-type: application/json' -d @"$SCRATCH/k0-story.json"
```

with `{ "project_path": "…", "title": "…", "body": "…", "lang": "it", "epic_key": "K7" }` —
`project_path` is `REPO`, and `epic_key` only when there is one. Write the JSON to a file and
send it with `-d @file`: a body dictated by voice will have quotes and newlines in it and will
not survive being pasted inline.

The answer carries the `key` and the `id`. **Read them from there** — never work
them out yourself, and never ask.

## Start it, if that is what he said

```bash
curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/story/$ID/start" \
  -H 'content-type: application/json' -d '{"auto_send": true}'
```

`prompt` is optional here: leave it out and the story's own prompt is used. Only start when he
asked. A story created and left on the board is the normal case.

## Say one line

In his language, and one line is the whole report:

> **K42 · 1.12** — Fix the invoice export. On the board, in Backlog.

Add *and the session is running* when you started one. Nothing else: no summary of what you
understood, no list of what he might want next, no offer to discuss it.

## Rules

- **Speed is the feature.** Two calls, one line back. If you find yourself asking a second
  question, you are in the wrong skill.
- **Never ask for what the API just told you** — the key, the epic, the state.
- **Store what he said in the language he said it in.** The interface is English; his words are
  his.
- **This skill only creates.** No `PATCH`, no `DELETE`, no touching stories that already exist.
- **Several stories in one breath** — *"add these three"* — is still this skill: one `POST` each,
  then one line each. Do not turn it into a discussion.
- If he starts discussing instead of dictating, hand over to `/k0-discuss` on the story you have
  just created rather than running rounds here.
