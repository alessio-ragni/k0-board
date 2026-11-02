#!/bin/sh
# Puts k0-board.com online: refuses a site that was not rebuilt, zips `site/` without the files that
# only exist to make it, hands the zip to Amplify, waits for the deployment to finish, and then asks
# the live site for every address in the sitemap. A deployment Amplify calls a success is not yet a
# site that answers, so the last step is the one that decides.
#
#   npm run site:deploy
#
# Needs the AWS CLI with the `raypath` profile (see docs/cloud.md). Nothing here is secret.
set -eu

cd "$(dirname "$0")"
export AWS_PROFILE="${AWS_PROFILE:-raypath}" AWS_REGION="${AWS_REGION:-eu-west-1}"
APP=d2a5vvbyu1rsx6
ZIP="${TMPDIR:-/tmp}/k0-site-$$.zip"

node build.mjs --check

rm -f "$ZIP"
# The Markdown and the drawings are the sources of the feature pages, not pages: they stay home.
zip -qr "$ZIP" . -x README.md build.mjs deploy.sh 'features/*.md' 'features/*.art.html'

set -- $(aws amplify create-deployment --app-id "$APP" --branch-name main --query '[jobId,zipUploadUrl]' --output text)
JOB=$1 URL=$2
curl -fsS -X PUT -T "$ZIP" "$URL"
aws amplify start-deployment --app-id "$APP" --branch-name main --job-id "$JOB" >/dev/null
rm -f "$ZIP"

STATUS=PENDING
for _ in $(seq 1 60); do
  STATUS=$(aws amplify get-job --app-id "$APP" --branch-name main --job-id "$JOB" --query 'job.summary.status' --output text)
  case "$STATUS" in SUCCEED | FAILED | CANCELLED) break ;; esac
  sleep 5
done
[ "$STATUS" = SUCCEED ] || { echo "Amplify job $JOB ended $STATUS" >&2; exit 1; }

BAD=0
for U in $(sed -n 's:.*<loc>\(.*\)</loc>.*:\1:p' sitemap.xml); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$U")
  echo "$CODE $U"
  [ "$CODE" = 200 ] || BAD=1
done
# The sitemap online must be this one: an old copy answering 200 everywhere would hide a
# deployment that never arrived.
curl -fsS https://k0-board.com/sitemap.xml | cmp -s - sitemap.xml || { echo 'the live sitemap is not this one' >&2; BAD=1; }
[ "$BAD" = 0 ] && echo "k0-board.com is up to date (job $JOB)."
exit "$BAD"
