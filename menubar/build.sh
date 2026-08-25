#!/bin/bash
# Builds k0.app: a minimal bundle, with no Xcode project.
set -e
cd "$(dirname "$0")"

APP="k0.app"
BIN="$APP/Contents/MacOS/k0"

# Rebuilding changes the signature, and macOS then makes you grant the Accessibility
# permission all over again. So it only recompiles when the code has really changed.
if [ -x "$BIN" ] && [ "$BIN" -nt K0MenuBar.swift ] && [ "$BIN" -nt Info.plist ]; then
  echo "✅ $(pwd)/$APP (already up to date)"
  exit 0
fi

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp Info.plist "$APP/Contents/Info.plist"

# -swift-version 5: Swift 6's strict concurrency is not worth it for a 400-line app.
swiftc -O -swift-version 5 -o "$BIN" K0MenuBar.swift

# Ad-hoc signature: without one, macOS does not deliver the bundle's notifications.
codesign --force --sign - --identifier com.k0.menubar "$APP" >/dev/null 2>&1 || {
  echo "⚠️  signing failed: macOS will not deliver this app's notifications"
}

# And a signature is not enough on its own: macOS only grants the notification permission to an
# app it knows about. The bundle never passes through Finder — launchd starts it — so nothing
# else would ever register it, and the permission would be refused with no explanation.
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
if [ -x "$LSREGISTER" ]; then "$LSREGISTER" -f "$APP" >/dev/null 2>&1 || true; fi

echo "✅ $(pwd)/$APP"
