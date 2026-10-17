# site

Everything that is served at `https://k0-board.com`: the marketing site and the web side of k0
Cloud. All of it is static — plain HTML, CSS and ES modules, no build step and no dependencies.
The pages that need data talk to Supabase directly from the browser with `fetch`.

## The marketing site

- **`index.html`** — the home page: what k0 does, how to start, the plans, and the early-access
  form.
- **`waitlist.js`** — makes that form real. It validates the address, then inserts one row into
  the `access_requests` table of k0 Cloud with the publishable key. Row-level security lets the
  anonymous role insert into that table and nothing else, so the key is safe in a public page. A
  `409` means the address is already on the list and is answered with the same thank-you.
- **`privacy.html`**, **`terms.html`** — what is stored and where, and the early-access terms.
- **`404.html`** — served for any address that does not exist. It links its stylesheet with
  absolute paths for that reason.
- **`site.css`** — one stylesheet for all of the above. The colours are custom properties on
  `:root`, redefined for `prefers-color-scheme: dark`; the sticky notes keep their dark ink in
  both schemes.
- **`favicon.svg`** — the same icon as the local board.

The marketing pages load their fonts (Caveat, Instrument Sans, JetBrains Mono) from Google Fonts.
That is the marketing site only: the k0 app itself still makes no request for fonts.

## The app pages

- **`app/index.html`** — the board, read-only. Sign in with GitHub or Google and you see the
  stories your computer has sent to k0 Cloud, in the same six columns as the local board, with
  the live status of each one. Click a card to read its description, plan and decisions. Nothing
  can be edited here: the board is edited from k0 on your computer.
- **`app/admin.html`** — for admins only: the accounts, pending first, with Approve and Revoke,
  and the list of access requests.

`app/cloud.js` is shared by both: sign-in (PKCE), the session, and the fetch helpers. They are
served at `https://k0-board.com/app/`, which is where *Sign in* on the home page leads.

## Trying it locally

```sh
python3 -m http.server -d site 8080
```

Then open <http://localhost:8080/> for the site and <http://localhost:8080/app/> for the board.
Signing in works from there: the Supabase redirect allow-list already includes
`http://localhost:*/app/**` and `https://k0-board.com/**`. Until a sign-in provider is switched
on, the board says that sign-in is not open yet.

Submitting the early-access form locally writes to the real waitlist, so use an address you
would not mind seeing there.

## Deploying

The folder is deployed as it is, as static files on AWS Amplify — there is no build. Whatever is
in `site/` is what is served.
