---
name: k0-import
description: Fills the k0 board with Claude Code sessions that have already happened, one card per session, working out a title and a description by reading the conversation. Takes at most the 10 most recent sessions per repository from the last 14 days, skips automated runs and anything already imported, and asks for the go-ahead before creating any cards. Use this skill when the user types "/k0-import" or says "import my sessions", "load my old sessions into k0", "fill the board with what I have already done", "pick up the sessions I opened outside k0". Do not use it to create a card for new work: that is what the + on the dashboard is for.
---

# /k0-import [days] [max per repo]

Takes Claude Code sessions that have already happened — including the ones opened by hand,
outside k0 — and makes them appear on the board as yellow cards, one per session, with a title
and a description saying what it was about and where it got to.

- `[days]` — how far back to go. With no arguments: **14**.
- `[max per repo]` — at most how many sessions per repository. With no arguments: **10**.

## Procedure

1. **Ask the server what there is to import.**

   ```bash
   PORT="${K0_PORT:-4319}"
   curl -sS --max-time 120 "http://127.0.0.1:$PORT/api/sessions/candidates?days=14&per_repo=10" \
     -o "$SCRATCH/k0-candidates.json"
   ```

   `127.0.0.1`, not `k0.localhost`: browsers resolve that name by themselves, `curl` does not.
   `$SCRATCH` is the session's scratch directory.

   If `curl` cannot connect, the k0 server is not running: say so (`k0-board start`, or the
   tray icon → *Restart*) and **stop**. The scan can take a few seconds: that is normal, it is
   looking at the head of a thousand transcripts.

2. **Read the file.** It is a list of candidates, most recent first. For each one you get:
   `session_id`, `project_path`, `project_name`, `alive`, `started_at`, `ended_at`, `turns`,
   `title_hint` (the name the session already has, if it has one), `first_prompt`,
   `recent_prompts` (the last few exchanges) and `last_reply` (the last thing Claude said).

   If the list is empty, say there is nothing new to import and **stop**.

3. **Show what you found and wait for the go-ahead.** One line per repository with how many
   sessions, and the total. Create nothing before the user has said yes.

4. **Write a title and a description for each session**, by reading the digest — not by
   copying the first prompt.

   - `title` — 2 to 5 words, 60 characters at most, saying what it is about. Write it
     readably ("Reply to the vendor"): the server normalises it into the shape k0 uses for
     session names. If the digest is not enough to make sense of it, use `title_hint`.
   - `description` — one or two lines: what the session was about and where it got to.
     **In the language the session was held in**, which you can tell from the user's messages
     in the digest. Do not translate.
   - For a session that is still running (`alive: true`), write it in the present tense.

   Work in batches of about 20 candidates, so the last one gets the same attention as the first.

5. **Create the cards.**

   ```bash
   curl -sS -X POST "http://127.0.0.1:$PORT/api/sessions/import" \
     -H 'content-type: application/json' -d @"$SCRATCH/k0-import.json"
   ```

   where `k0-import.json` is `{"items": [...]}` and every item has `session_id`,
   `project_path`, `title`, `description`, `started_at`, `ended_at` — the last four copied
   straight from the candidate. If there are many candidates, send several calls of about 30
   items each.

   The answer says `created` and `skipped` (with the reason for every one skipped).

6. **Close the account.** How many cards were born, and that on the board they are yellow:
   they are picked up again with **Resume**, which reopens the conversation where it left off,
   and cleared away with **Done**.

## Rules

- **Do not invent.** If the digest does not make it clear what happened, say so in the
  description instead of filling it with guesses.
- **Do not touch cards that already exist.** This skill only creates: no `PATCH`, no `DELETE`.
  Sessions already imported are skipped by the server itself.
- **No files outside the scratch directory.**
- Automated runs — `claude -p`, subagents, skills launched from a script — do not even reach
  the candidate list: the server drops them. Do not try to recover them.
- If the user passes numbers (`/k0-import 30 5`), they are `days` and `per_repo`: put them in
  the query in step 1.
