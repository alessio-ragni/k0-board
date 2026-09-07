---
name: k0-order
description: Reorders the k0 backlog from an instruction said out loud — what goes to the top, what waits on what, what is starred. Resolves the keys to stories itself, applies the change through the API and answers in one line. Use this skill when the user types "/k0-order", or says "K51 to the top", "K42 depends on K37", "star K19", "move K7 below K12", "put the login one last", "unstar K3", "K51 in cima", "K42 dipende da K37", "metti la stella su K19", "sposta K7 sotto K12", "questa prima di quella". Do not use it to decide what to work on next (that is /k0-next), to change a story's state or title (/k0-story), or to break one up (/k0-split).
---

# /k0-order <what to move, what waits on what, what to star>

Priority dictated at the speed it is thought: *K51 to the top, K42 waits on K37, star K19.*
Several instructions in one breath is the normal case, not the exception.

## Procedure

1. **Read the board.**

   ```bash
   PORT="${K0_PORT:-4319}"
   REPO="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; REPO="${REPO%/.git}"
   [ -d "$REPO" ] || REPO="$(git rev-parse --show-toplevel 2>/dev/null)"
   curl -sS --max-time 30 --get --data-urlencode "repo=$REPO" \
     "http://127.0.0.1:$PORT/api/backlog" -o "$SCRATCH/k0-backlog.json"
   ```

   `127.0.0.1`, not `k0.localhost`: `curl` does not resolve that name. `--get --data-urlencode`,
   not `?repo=$REPO`: a repository path with a space in it makes `curl` refuse the address
   outright, and one with a `#` in it quietly sends half. `$SCRATCH` is the session's
   scratch directory; nothing is written outside it. `REPO` is the repository the stories are
   filed under — the main one, even when this session sits in a subdirectory of it or inside a
   worktree, which is why it is not `$PWD`.

   - `curl` cannot connect → the server is not running. Say so (`k0-board start`, or the tray
     icon → *Restart*) and **stop**.
   - `{"enabled": false}` → say in one line that the backlog is switched off in k0's settings and
     **stop**.
   - `REPO` empty → this is not a git repository. Ask once which repository this belongs to.

   That one file has every key, alias, title, state, star, `sort_hint` and dependency you need.
   Do not ask the user for any of it and do not fetch it twice.

2. **Resolve what he named.** `K42` is a key; *the login one* is a title. Keys are per
   repository, so `K42` here is not `K42` next door — resolve inside the repository you are in.
   If a key is not on this board, say so and ask which repository; do not guess at another one.
   If a description matches two stories, ask which. Never act on a key you have not seen in the
   file.

3. **Work out every change before sending one.** The list is small, so hold it whole: a
   contradiction inside one breath — *K7 to the top, and K7 after K12* — is caught now, and
   asked about now, not half-applied.

4. **Apply it.**

   **Position.** Stories are ordered by `sort_hint` ascending, ties broken by age — the older
   story wins a tie. So *to the top* is not a fixed number, it is **ten below the lowest
   `sort_hint` on the board**, and *to the bottom* is ten above the highest. Both numbers are in
   the file you read in step 1; work them out from it every time:

   ```bash
   # lowest sort_hint on the board is 20 → to the top is 10
   curl -sS --max-time 30 -X PATCH "http://127.0.0.1:$PORT/api/backlog/story/$ID" \
     -H 'content-type: application/json' -d '{"sort_hint": 10}'
   ```

   Never send a hardcoded number, and never the one in that example. Send `-1` twice and the
   second story ties with the first, the tie goes to whichever is older, and the story he asked
   to put on top lands second — while the receipt line says it went to the top. He has no way to
   see that until he reloads the board.

   To put one *between* two neighbours that have no room between them, renumber: take the
   affected list in the order he now wants it, hand out 10, 20, 30 … and `PATCH` only the rows
   whose number actually changed. Renumbering the ones that did not move is churn the mirror
   then has to write out again.

   **Star.**

   ```bash
   curl -sS --max-time 30 -X PATCH "http://127.0.0.1:$PORT/api/backlog/story/$ID" \
     -H 'content-type: application/json' -d '{"starred": true}'
   ```

   **Dependency.** `story_id` is the one that waits, `depends_on` is the one it waits for — say
   the sentence out loud before you fill it in, because inverted dependencies are silent and
   only turn up weeks later.

   ```bash
   curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/dependency" \
     -H 'content-type: application/json' -d '{"story_id": 42, "depends_on": 37}'
   ```

   Removing one is the same call with `"remove": true`.

5. **Say what you did, in one line.** In his language, keys and what changed, nothing else:

   > K51 to the top, K42 now waits on K37, star on K19.

   No table, no recap of the board, no offer to reorder anything else. He is mid-thought and the
   line is a receipt, not a report.

## Dependencies warn, they never block

A dependency marks a story on the board and nothing more. It does not stop it being started,
planned or finished, and this skill never refuses an instruction because of one. When a change
leaves a story waiting on something unfinished, that goes in the same receipt line as a clause:

> K42 now waits on K37, which is still Planned — a note, not a lock.

Two things are worth stopping for, and both are mistakes rather than priorities:

- **a story depending on itself** — say so and do not send it;
- **a loop** — K42 waits on K37, which already waits on K42. You can see it in the `deps` of the
  file you read in step 1. Name the loop, do not send the call, and let him choose which edge he
  actually meant.

## Rules

- **Only order, star and dependencies.** Not state, not title, not epic, not deletion. If he asks
  for one of those in the same breath, do the ordering, say which part you left alone and which
  skill does it, and stop.
- **Never invent a key.** `key_num` is the server's to allocate. A key that is not on the board
  is a mistake to report, not a story to create.
- **Never ask what the API can tell you.** The current order, who is starred, what already
  depends on what, whether a story is blocked — it is all in step 1's answer.
- **Talk in the language the user speaks.**
- **No files outside the scratch directory**, and never write into `.k0/` by hand: the server
  mirrors the change there on its own.
