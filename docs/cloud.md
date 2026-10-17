# k0 Cloud — where everything is, and how to run it

The design is in the README, under *How it is put together*; the tables are in `database.md`. This
page is the other half: the accounts, the switches and the chores, so that nobody has to work out
again where a key lives or how somebody is let in.

## The pieces

| What | Where | Owned by |
|---|---|---|
| Database, sign-in, row-level rules | Supabase project `k0-board` (ref `pegjzrbsogextluajmjm`, eu-west-1) | the Supabase organisation that holds the other projects |
| Schema | `supabase/migrations/*.sql`, applied with `supabase db push` | this repository |
| Sign-in settings (redirects, providers) | `supabase/config.toml`, and the project's Auth settings | this repository + the Supabase dashboard |
| Sign in with GitHub | OAuth app **k0** on the GitHub account `alessio-ragni` (Settings → Developer settings → OAuth Apps) | alessio-ragni |
| Sign in with Google | Google Cloud project **k0-board**, Google Auth Platform → client **k0 sign-in** (Web application) | the ISH Consulting Google account |
| Secrets for development | `~/.config/k0-cloud/.env`, mode 600, never in a repository | the machine |
| The board's own copy of a sign-in | `~/.k0/cloud.json`, mode 600 | each user's machine |
| Read-only board and admin page | `site/app/`, static, deployed with the site at `k0-board.com/app/` | this repository |
| Domain | `k0-board.com`, registered at Namecheap, its DNS on Route 53 (zone `Z03605431S6KOXV9INFOC` in the "playground" AWS account). `www` answers with a permanent redirect to the bare domain | Namecheap account + the "playground" AWS account |
| Waitlist and sign-in emails | Supabase edge function `notify` (`supabase/functions/notify`), called by the database on every early-access request and every account waiting for approval; sends through Resend from `hello@mail.k0-board.com` | Resend team "ISH CONSULTING SRL", domain `mail.k0-board.com`, a sending-only key |
| `hello@k0-board.com` | Amazon SES receives it (rule set `k0-board`, eu-west-1), keeps the raw message in the S3 bucket `k0-board-inbound-mail` for 30 days, and the Lambda `k0-mail-forward` (`infra/mail-forward`) forwards it through Resend with the original attached and Reply-To set to the sender | the "playground" AWS account |
| The site's hosting | AWS Amplify app **k0-board** (`d2a5vvbyu1rsx6`, eu-west-1, the AWS account called "playground", reached on this machine with the CLI profile `raypath`), branch `main`, served at `https://main.d2a5vvbyu1rsx6.amplifyapp.com` until `k0-board.com` points at it | the "playground" AWS account |

Both OAuth apps send people back to the same place: `https://pegjzrbsogextluajmjm.supabase.co/auth/v1/callback`.
Supabase then sends them on to k0 on their own machine (`http://k0.localhost:4319/auth/callback`)
or to the site; those addresses are the redirect allow-list in `supabase/config.toml`.

## What is in `~/.config/k0-cloud/.env`

`SUPABASE_PROJECT_REF`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (public, it is in the code too),
`SUPABASE_DB_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY` (bypasses every rule — admin scripts only),
`K0_GITHUB_CLIENT_ID`, `K0_GITHUB_SECRET`, `K0_GOOGLE_CLIENT_ID`, `K0_GOOGLE_SECRET`, `RESEND_API_KEY`
(sending only, only from `mail.k0-board.com`), `K0_HOOK_SECRET` (what the database shows the `notify`
function; also kept in Supabase Vault as `k0_hook_secret`).

The `notify` function's own secrets live in Supabase (`supabase secrets list`): `RESEND_API_KEY`,
`K0_HOOK_SECRET` and `K0_NOTIFY_EMAIL`, the address that gets told about new requests. The
forwarder's live on the Lambda: `FORWARD_TO`, `RESEND_API_KEY`, `BUCKET`, `PREFIX`.

Load it with `set -a; . ~/.config/k0-cloud/.env; set +a` before any `supabase` command that needs it.

## Chores

**Letting somebody in.** They sign in once (from k0 or from `k0-board.com/app/`), which creates
their account as waiting. An admin approves them on `k0-board.com/app/admin.html`. Until the site
is online the same thing is one call:

```bash
set -a; . ~/.config/k0-cloud/.env; set +a
curl -sS -X PATCH "$SUPABASE_URL/rest/v1/accounts?email=eq.someone@example.com" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H 'content-type: application/json' -d '{"approved": true}'
```

`"is_admin": true` in the same body makes somebody an admin.

**Changing the schema.** A new file in `supabase/migrations/`, then `supabase db push -p "$SUPABASE_DB_PASSWORD"`.
Never edit a migration that has already been pushed.

**Changing sign-in settings.** Edit `supabase/config.toml` and say why in the comment beside it.
`supabase config push` applies the auth part and then fails on storage with CLI 2.106; the
reliable way is the Management API with the CLI's token (`~/.supabase/access-token`):
`PATCH https://api.supabase.com/v1/projects/pegjzrbsogextluajmjm/config/auth`.

**Changing the emails.** Edit `supabase/functions/notify/index.js` and run
`supabase functions deploy notify --project-ref pegjzrbsogextluajmjm --use-api`. The forwarder:
zip `infra/mail-forward/index.mjs` and `aws lambda update-function-code --function-name k0-mail-forward --zip-file fileb://…`
(profile `raypath`, eu-west-1).

**Rotating a secret.** Generate the new one where it lives (GitHub app page, Google client page,
Supabase dashboard), put it in `~/.config/k0-cloud/.env`, and push it to Supabase's Auth settings
the same way. Nothing in the repository changes.

**Putting the site online.** The Amplify app is not connected to GitHub: it takes a zip of `site/`.

```bash
export AWS_PROFILE=raypath AWS_REGION=eu-west-1 APP=d2a5vvbyu1rsx6
(cd site && rm -f /tmp/k0-site.zip && zip -qr /tmp/k0-site.zip . -x README.md)
read JOB URL < <(aws amplify create-deployment --app-id $APP --branch-name main --query '[jobId,zipUploadUrl]' --output text)
curl -sS -X PUT -T /tmp/k0-site.zip "$URL" && aws amplify start-deployment --app-id $APP --branch-name main --job-id $JOB
```

A page that does not exist is answered with `404.html` (a rewrite rule on the app).

## How it was tested

The waitlist emails were tried with Resend's test address `delivered@resend.dev`: the request was
saved, the function answered `ok`, and the notice reached the owner's inbox (not spam). The
forwarder was tried by mailing `hello@k0-board.com` from `mail.k0-board.com`: SES stored it and the
forwarded copy reached the inbox with the original attached.

Google sign-in is **In production** since 17 October 2026: anybody with a Google account can sign
in (and then waits to be approved). The consent screen points at `k0-board.com`, its privacy page and
its terms.
