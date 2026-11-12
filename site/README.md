# site

Everything that is served at `https://k0-board.com`: the marketing site and the web side of k0
Cloud. All of it is static — plain HTML, CSS and ES modules, no dependencies, and nothing to build
when it is deployed. The one generated part, the feature pages, is generated before the commit and
committed.
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
- **`favicon.svg`** — the k0 mark, drawn in strokes so it needs no font. The local board has an
  icon of its own, which takes the colour of the most urgent status.

## The feature pages

Every feature of k0 has a short page at `/features/<slug>/`, and they are all listed at
`/features/`; eight of them are cards on the home page as well. None of these is written by hand:

- **`features/<slug>.md`** — one feature: a header with its title, card text, summary, order,
  whether it is one of the eight shown on the home page (`home: yes`),
  version and related features, then a few hundred words of Markdown. A feature marked
  `status: coming` gets a card that says *coming soon* and no page.
- **`features/<slug>.art.html`** — the drawing beside it, built only from the pieces at the end of
  `site.css` (`.mini` notes, `.screen`, `.pill`, `.chip`, `.art-arrow`): no pictures, nothing fetched.
- **`build.mjs`** — reads them with the board's own Markdown renderer (`web/md.js`) and writes
  `features/<slug>/index.html`, `features/index.html`, the cards between the
  `<!-- features:start -->` and `<!-- features:end -->` markers in `index.html`, and
  `sitemap.xml`. `npm run site` writes; `node site/build.mjs --check` writes nothing and fails if
  anything on disk is not what it would write, which is how CI and the release catch a page that
  was edited and not rebuilt. A related feature that has no page stops the build: it would be a
  broken link on a public page.

The words of a page are written by the `site-feature` skill in `.claude/skills/`, from the story's
decisions, the manual and the changelog; whether a story deserves a page is decided while it is
discussed, and the release checks that every feature it brings has one.

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
npm run serve
```

or click the globe on the `k0` column of the board, which runs the same thing: the feature pages
are rebuilt, then `site/serve.mjs` serves the folder on `127.0.0.1:8080` (`PORT` changes it).
Then open <http://localhost:8080/> for the site and <http://localhost:8080/app/> for the board.
Signing in works from there: the Supabase redirect allow-list already includes
`http://localhost:*/app/**` and `https://k0-board.com/**`. Until a sign-in provider is switched
on, the board says that sign-in is not open yet.

Submitting the early-access form locally writes to the real waitlist, so use an address you
would not mind seeing there.

## Deploying

The folder is deployed as it is, as static files on AWS Amplify — there is no build. Whatever is
in `site/` is what is served, except the files that only exist to make it: this README,
`build.mjs`, `serve.mjs`, `deploy.sh` and the feature sources.

```sh
npm run site:deploy
```

It refuses a site that was not rebuilt, uploads the zip, waits for Amplify to finish, then asks the
live site for every address in the sitemap and compares the sitemap online with this one. The
release runs it as its last step; `docs/cloud.md` has the same thing written out by hand.
