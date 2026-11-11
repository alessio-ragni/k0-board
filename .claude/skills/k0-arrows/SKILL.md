---
name: k0-arrows
description: Reads and draws the arrows between stories on the k0 board — which stories the one in this session is joined to, in this repository or any other, which way each arrow points, where each of them stands and what its Log last said — and draws, removes or turns an arrow round when the user says so. Use this skill when the user types "/k0-arrows" or "/k0-arrows K42", or says "what is this story linked to", "show me the linked stories", "check everything this release waits on", "link this to K58", "K42 waits on K37 in the other repository", "remove the arrow to K19", "turn that arrow round", "a cosa è collegata questa storia", "fammi vedere i collegati", "controlla tutti i post-it collegati", "collega questa a K58", "togli la freccia verso K19", "inverti la freccia". Do not use it to reorder or star stories (that is /k0-order), to decide what to work on next (/k0-next), or to close or finish the linked stories — that is a button on the board, and it asks first.
---

# /k0-arrows [key] [what to draw, remove or turn]

An arrow goes **from the story that waits to the story it waits on**. *K42 → K37* reads "K42 waits
on K37": K37 comes first. On the board it is drawn by dragging; here it is said out loud. Arrows
cross repositories — a key names one story on the whole board, whichever repository it is filed
under — and that is most of the reason they exist.

## 1. Find the story

```bash
PORT="${K0_PORT:-4319}"
REPO="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; REPO="${REPO%/.git}"
[ -d "$REPO" ] || REPO="$(git rev-parse --show-toplevel 2>/dev/null)"
curl -sS --max-time 30 --get --data-urlencode "repo=$REPO" \
  "http://127.0.0.1:$PORT/api/backlog" -o "$SCRATCH/k0-backlog.json"
```

`127.0.0.1`, not `k0.localhost`: `curl` does not resolve that name. `--get --data-urlencode`, not
`?repo=$REPO`: a path with a space in it makes `curl` refuse the address, and one with a `#`
quietly sends half. `$SCRATCH` is the session's scratch directory; nothing is written outside it.

- `curl` cannot connect → the server is not running. Say so (`k0-board start`, or the tray icon →
  *Restart*) and **stop**.
- `{"enabled": false}` → say in one line that the backlog is switched off and **stop**.

With a key, take that story; with none, the one whose `session` is alive here. If two could be
meant, ask once, showing both. The story you start from has to be in this listing — it is the
other end of an arrow that may be anywhere.

## 2. Read the chain

```bash
curl -sS --max-time 30 "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID/linked" -o "$SCRATCH/k0-linked.json"
```

`$STORY_ID` is the `id` from step 1, not the key. The answer is the **whole chain** the story
belongs to — everything reached by following arrows either way, not only its neighbours:

- `edges` — every arrow in the chain as `{from, to}` keys: `from` waits on `to`;
- `stories` — every other story in it, with `key`, `title`, `repo` (the absolute path of its
  repository), `repo_name`, `state`, `status` and `session_alive` (whether a session is open on
  it right now), `downstream` (true when the story you started from waits on it, directly or
  through others) and `last_log`, the last thing its Log says.

An empty `stories` means the story has no arrows. Say that in one line and stop.

## 3. Say it, briefly

In the user's language, the stories that are waited on first:

> K61 Release 2.0 waits on K58 Rate limits (api, Working — "migration written, not yet run")
> and on K47 New pricing page (website, Planned).

Name the repository whenever it is not the one you are in. Do not print a table, and do not
recap stories that are Done unless he asked about them — say how many are done and leave it there.

What he does with the list is his to say: *check them*, *update them*, *write the handover*. Reading
another repository's story is this skill; **working in another repository is not** — the files of
a story filed under another `repo` are that repository's, and a session opened there does that work.

## 4. Draw, remove, turn round

Keys, not ids, on both ends, so a story in another repository needs no second listing:

```bash
curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/dependency" \
  -H 'content-type: application/json' -d '{"story_key": "K42", "depends_on_key": "K37"}'
```

`story_key` is the one that **waits**, `depends_on_key` the one it waits **on**. Say the sentence
out loud before filling it in — *K42 waits on K37* — because an arrow drawn backwards is silent
and only turns up weeks later.

- remove: the same call with `"remove": true`;
- turn round: the same call, naming the arrow **as it is now**, with `"flip": true`.

The server refuses, with `409` and a sentence, an arrow that would leave stories waiting on each
other for ever — K37 already waits on K42, or a longer ring. Read the sentence out and let him
choose which arrow he meant; never remove another arrow to make room for this one. A `404` means
one of the keys names nothing on the board: say which, and do not guess at another.

Then one line, a receipt and not a report:

> K42 now waits on K37 (api), which is still Planned.

## Rules

- **An arrow is a note, not a lock.** It marks the story that waits and asks once before that
  story is started; it never stops anything. Never refuse to work on a story because of one.
- **Never invent a key**, and never act on one you have not seen in an answer from the server.
- **Never close or finish the linked stories from here.** The board asks before doing that, and
  it is the user who answers.
- **Never ask what the API can tell you.**
- **Talk in the language the user speaks.**
- **No files outside the scratch directory**, and never write into `.k0/` by hand.
