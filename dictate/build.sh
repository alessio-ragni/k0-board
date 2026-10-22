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
# Microphone and Accessibility permissions to the app's signature, and an ad-hoc signature changes
# with every rebuild. The icon changes often; this is meant to change almost never, so an update
# of k0 does not make everybody grant both permissions again. Which is why it is rebuilt only when
# its own two files say something different — compared by content, not by date, because
# installing k0 copies them and every copy is newer.
SOURCE="$(cat K0Dictate.swift Info.plist | shasum | cut -c1-40)"
if [ -x "$BIN" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$SOURCE" ]; then
  echo "✅ $APP (already up to date)"
  exit 0
fi

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp Info.plist "$APP/Contents/Info.plist"

swiftc -O -swift-version 5 -o "$BIN" K0Dictate.swift
echo "$SOURCE" > "$STAMP"

# Ad-hoc, with a fixed identifier: the identifier is what System Settings shows the permission under.
codesign --force --sign - --identifier com.k0.dictate "$APP" >/dev/null 2>&1 || {
  echo "⚠️  signing failed: macOS will not let this app use the microphone"
}

LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
if [ -x "$LSREGISTER" ]; then "$LSREGISTER" -f "$APP" >/dev/null 2>&1 || true; fi

echo "✅ $APP"
