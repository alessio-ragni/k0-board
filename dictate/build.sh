#!/bin/bash
# Builds "k0 Dictate.app": a minimal bundle, with no Xcode project.
set -e
cd "$(dirname "$0")"

# Where the app goes: given by k0 (~/.k0/dictate/), so it outlives a reinstall of k0 itself.
OUT="${1:-.}"
mkdir -p "$OUT"
APP="$OUT/k0 Dictate.app"
BIN="$APP/Contents/MacOS/k0-dictate"
STAMP="$APP/Contents/Resources/source.sha"

# The whole reason this is an app of its own, apart from the menu bar icon: macOS ties the
# Microphone and Accessibility permissions to the app's signature. Signed with a certificate of
# this Mac's own (sign.sh) the signature outlives a rebuild; signed ad hoc, when that cannot be
# made, it changes with every one. Either way it is rebuilt only when its own two files, or what it
# is signed with, say something different — compared by content, not by date, because installing
# k0 copies them and every copy is newer.
DIR="$(cd "$OUT" && pwd)"
KEYCHAIN="$DIR/signing.keychain-db"
SIGNER=-
if ./sign.sh "$KEYCHAIN" "$DIR/signing.pass" >/dev/null 2>&1; then SIGNER="k0 local signing"; fi
SOURCE="$( (cat K0Dictate.swift Info.plist; echo "$SIGNER") | shasum | cut -c1-40)"
if [ -x "$BIN" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$SOURCE" ]; then
  echo "✅ $APP (already up to date)"
  exit 0
fi

# What the last build was signed as: the permissions granted to it hold only if this one matches.
BEFORE="$(codesign -d -r- "$APP" 2>&1 | sed -n 's/^designated => //p')"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp Info.plist "$APP/Contents/Info.plist"

swiftc -O -swift-version 5 -o "$BIN" K0Dictate.swift
echo "$SOURCE" > "$STAMP"

# With a fixed identifier: the identifier is what System Settings shows the permission under.
# codesign finds an identity only in a keychain on the user's list, so k0's is put on it for the
# length of one signature and the list is put back as it was. A minute at most: a codesign that
# stopped to ask something would otherwise hold k0 up with nobody there to answer.
signed=false
if [ "$SIGNER" != - ]; then
  LIST=()
  while IFS= read -r k; do LIST+=("$k"); done < <(security list-keychains -d user | sed 's/^[[:space:]]*"//; s/"$//')
  trap 'security list-keychains -d user -s "${LIST[@]}"' EXIT
  security list-keychains -d user -s "${LIST[@]}" "$KEYCHAIN"
  /usr/bin/perl -e 'alarm 60; exec @ARGV' codesign --force --timestamp=none --keychain "$KEYCHAIN" \
    --sign "$SIGNER" --identifier com.k0.dictate "$APP" >/dev/null 2>&1 && signed=true
  security list-keychains -d user -s "${LIST[@]}"
  trap - EXIT
fi
if ! $signed; then
  codesign --force --sign - --identifier com.k0.dictate "$APP" >/dev/null 2>&1 || {
    echo "⚠️  signing failed: macOS will not let this app use the microphone"
  }
fi

# Read by platform/darwin/dictate.js, which otherwise clears the old permissions so macOS asks again.
AFTER="$(codesign -d -r- "$APP" 2>&1 | sed -n 's/^designated => //p')"
if [ -n "$AFTER" ] && [ "$AFTER" = "$BEFORE" ] && [[ "$AFTER" != cdhash* ]]; then
  echo "permissions: kept"
fi

LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
if [ -x "$LSREGISTER" ]; then "$LSREGISTER" -f "$APP" >/dev/null 2>&1 || true; fi

echo "✅ $APP"
