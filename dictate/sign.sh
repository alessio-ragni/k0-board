#!/bin/bash
# Makes, once, the certificate "k0 Dictate.app" is signed with, in a keychain of k0's own next to
# the app. macOS ties the Microphone and Accessibility permissions to the app's signature; signed
# ad hoc, that is a hash of the program and changes with every build, so every update that touched
# dictation asked for both again. Signed with this certificate it stays the same, and so do they.
#
# A keychain of its own, not the login one: a key in the login keychain makes codesign ask for the
# Mac's password, and a keychain k0 made and holds the password of never does. Its password sits
# beside it, readable by this user only — whoever can read it can already rewrite the source this
# app is built from. Anything that fails here leaves the build signing ad hoc, as before.
#
# Usage: sign.sh <keychain> <password file>. Exits 0 when the identity is there to sign with.
set -e
KEYCHAIN="$1"
PASSFILE="$2"
NAME="k0 local signing"

ready() {
  [ -f "$KEYCHAIN" ] && [ -f "$PASSFILE" ] &&
    security unlock-keychain -p "$(cat "$PASSFILE")" "$KEYCHAIN" 2>/dev/null &&
    security find-identity -p codesigning "$KEYCHAIN" 2>/dev/null | grep -q "\"$NAME\""
}
ready && exit 0

rm -f "$KEYCHAIN" "$PASSFILE"
umask 077
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
K0_SIGN_PASS="$(/usr/bin/openssl rand -hex 24)"
export K0_SIGN_PASS

cat > "$TMP/cert.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF
# The system's LibreSSL, not a Homebrew OpenSSL 3: the .p12 of the latter is one `security` cannot read.
/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 7300 -config "$TMP/cert.cnf" \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" 2>/dev/null
/usr/bin/openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$NAME" \
  -passout env:K0_SIGN_PASS -out "$TMP/id.p12"

security create-keychain -p "$K0_SIGN_PASS" "$KEYCHAIN"
# No locking itself after a while: it is unlocked before every build anyway, but a build that
# finds it locked half-way would sign ad hoc and lose the permissions.
security set-keychain-settings "$KEYCHAIN"
security unlock-keychain -p "$K0_SIGN_PASS" "$KEYCHAIN"
# -T: codesign may use the key without asking.
security import "$TMP/id.p12" -k "$KEYCHAIN" -P "$K0_SIGN_PASS" -T /usr/bin/codesign >/dev/null
printf %s "$K0_SIGN_PASS" > "$PASSFILE"
ready
