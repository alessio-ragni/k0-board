# site

The web side of k0 Cloud. Everything here is static — plain HTML, CSS and ES modules, no build
step and no dependencies. The pages talk to Supabase directly from the browser with `fetch`.

## The pages

- **`app/index.html`** — the board, read-only. Sign in with GitHub or Google and you see the
  stories your computer has sent to k0 Cloud, in the same six columns as the local board, with
  the live status of each one. Click a card to read its description, plan and decisions. Nothing
  can be edited here: the board is edited from k0 on your computer.
- **`app/admin.html`** — for admins only: the accounts, pending first, with Approve and Revoke,
  and the list of access requests.

`app/cloud.js` is shared by both: sign-in (PKCE), the session, and the fetch helpers.

They will be served at `https://k0-board.com/app/`. The marketing site will live in `site/` as
well, later.

## Trying them locally

```sh
npx serve site
# or
python3 -m http.server -d site 8080
```

Then open <http://localhost:8080/app/>. Signing in works from there: the Supabase redirect
allow-list already includes `http://localhost:*/app/**` and `https://k0-board.com/**`. Until a
sign-in provider is switched on, the page says that sign-in is not open yet.
