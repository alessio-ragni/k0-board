#!/usr/bin/env python3
"""k0's tray icon for Linux.

The counterpart of menubar/K0MenuBar.swift, and deliberately the same shape: poll
/api/status every couple of seconds, tint a small square with the colour of the most urgent
session, and put the sessions that are waiting for you at the top of the menu so one click
brings the right terminal back.

Written in Python because it is the only language with a tray binding that is already
installed on a normal desktop: GNOME, KDE and the rest ship python3 with PyGObject. Anything
else would mean asking people to install a toolkit before they can see an icon. There are no
third-party imports here — the PNG the icon is made of is written by hand with zlib, which is
in the standard library, precisely so that this file never needs a pip install.

If PyGObject or an AppIndicator implementation is missing, this exits quietly. The board and
the server work perfectly without a tray icon; refusing to start would be worse than not
having one.
"""

import json
import os
import struct
import subprocess
import sys
import urllib.error
import urllib.request
import zlib

try:
    import gi

    gi.require_version("Gtk", "3.0")
    try:
        gi.require_version("AyatanaAppIndicator3", "0.1")
        from gi.repository import AyatanaAppIndicator3 as AppIndicator
    except (ValueError, ImportError):
        gi.require_version("AppIndicator3", "0.1")
        from gi.repository import AppIndicator3 as AppIndicator
    from gi.repository import GLib, Gtk
except (ImportError, ValueError) as err:  # pragma: no cover - depends on the desktop
    print(f"k0: no tray support on this desktop ({err}); the board still works", file=sys.stderr)
    raise SystemExit(0)

# libnotify is what makes a notification clickable: `notify-send` can only shout, and a
# notification you cannot click is one that tells you a session is waiting and then leaves you to
# find its terminal yourself. Where it is missing we still shout — see `notify`.
try:  # pragma: no cover - depends on the desktop
    gi.require_version("Notify", "0.7")
    from gi.repository import Notify

    if not Notify.init("k0"):
        Notify = None
except (ImportError, ValueError, GLib.Error):
    Notify = None


PORT = os.environ.get("K0_PORT", "4319")
BASE = f"http://127.0.0.1:{PORT}"
POLL_SECONDS = 2

CACHE = os.path.join(
    os.environ.get("XDG_CACHE_HOME", os.path.expanduser("~/.cache")), "k0", "tray"
)

# The same colours and the same order of urgency as the board and the macOS menu bar icon.
# ASK first because a question blocks everything behind it; COMPLETED never gets here.
URGENCY = ["ASK", "PLANNED", "IDLE", "WORKING", "PLANNING"]
COLOURS = {
    "ASK": (0xE8, 0x6A, 0x33),
    "PLANNED": (0x6C, 0x8E, 0xBF),
    "IDLE": (0xE0, 0xC0, 0x4A),
    "WORKING": (0x5B, 0xA8, 0x6A),
    "PLANNING": (0x8E, 0x7C, 0xC3),
    "quiet": (0x9A, 0x9A, 0x9A),
    "down": (0xB0, 0x50, 0x50),
}
LABELS = {
    "ASK": "Needs answer",
    "PLANNED": "Needs approval",
    "IDLE": "Your turn",
    "WORKING": "Working",
    "PLANNING": "Planning",
}
MODES = [("sleep", "Sleep"), ("away", "Away"), ("nerd", "Nerd"), ("driving", "Driving")]


def png(rgb, size=22):
    """A solid rounded square, as PNG bytes.

    Hand-rolled so the tray needs nothing but the standard library. The corners are cut by
    simply not drawing the four corner pixels, which at this size reads as rounded.
    """
    r, g, b = rgb
    rows = bytearray()
    for y in range(size):
        rows.append(0)  # PNG filter type for this scanline: none
        for x in range(size):
            edge = (x < 2 or x >= size - 2) and (y < 2 or y >= size - 2)
            rows += bytes((r, g, b, 0 if edge else 255))

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(rows), 9))
        + chunk(b"IEND", b"")
    )


def icon_for(state):
    """Write the icon for `state` once and hand back its path."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{state}.png")
    if not os.path.exists(path):
        with open(path, "wb") as fh:
            fh.write(png(COLOURS.get(state, COLOURS["quiet"])))
    return path


def api(path, payload=None):
    """One request to the server. Returns None when the server is not answering."""
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        BASE + path,
        data=data,
        headers={"Content-Type": "application/json", "Origin": BASE},
        method="POST" if data else "GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            body = response.read()
            return json.loads(body) if body else {}
    except (urllib.error.URLError, OSError, ValueError):
        return None


# Notifications still waiting to be clicked. They are held here for one reason: a Notify object
# that Python garbage-collects takes its action callback with it, and the click then does nothing.
_shown = []


def _forget(notification):
    if notification in _shown:
        _shown.remove(notification)


def notify(card_id, title, body):
    """Say that a session is waiting, and let the click take you to it.

    The action is named `default`, which is what a notification daemon calls the click on the
    banner itself rather than on a button. Not every daemon honours actions; where it does not,
    or where libnotify is missing altogether, this falls back to `notify-send`, which still says
    what happened — the terminal is then one click away in the menu instead of none.
    """
    if Notify is not None:
        try:
            note = Notify.Notification.new(title, body, None)
            note.add_action("default", "Open", lambda *_: api(f"/api/card/{card_id}/focus", {}))
            note.connect("closed", _forget)
            _shown.append(note)
            if note.show():
                return
            _forget(note)
        except (GLib.Error, TypeError):
            pass
    try:
        subprocess.Popen(["notify-send", "-a", "k0", title, body])
    except OSError:
        pass  # no notification daemon: not worth complaining about


class Tray:
    def __init__(self):
        self.indicator = AppIndicator.Indicator.new(
            "k0", icon_for("quiet"), AppIndicator.IndicatorCategory.APPLICATION_STATUS
        )
        self.indicator.set_status(AppIndicator.IndicatorStatus.ACTIVE)
        self.menu = Gtk.Menu()
        self.indicator.set_menu(self.menu)
        self.seen = set()
        self.first_pass = True
        self.mode = None
        self.build_menu([], down=True)
        GLib.timeout_add_seconds(POLL_SECONDS, self.poll)
        self.poll()

    # ── the loop ────────────────────────────────────────────────────────────
    def poll(self):
        status = api("/api/status")
        if status is None:
            self.indicator.set_icon_full(icon_for("down"), "k0: server not responding")
            self.build_menu([], down=True)
            return True

        waiting = status.get("waiting") or []
        urgent = status.get("urgent")
        self.mode = status.get("mode")
        self.indicator.set_icon_full(
            icon_for(urgent or "quiet"),
            LABELS.get(urgent, "k0 — nothing waiting for you"),
        )
        self.build_menu(waiting, down=False)
        self.announce(waiting)
        return True

    def announce(self, waiting):
        """Notify about cards that have just started waiting, not about every one every time."""
        now = {(card["id"], card["status"]) for card in waiting}
        if not self.first_pass:
            for card in waiting:
                if (card["id"], card["status"]) not in self.seen:
                    notify(card["id"], LABELS.get(card["status"], "k0"), card.get("title", ""))
        self.seen = now
        self.first_pass = False

    # ── the menu ────────────────────────────────────────────────────────────
    def build_menu(self, waiting, down):
        for child in self.menu.get_children():
            self.menu.remove(child)

        if down:
            self.add_item("Server not responding", None, enabled=False)
        elif not waiting:
            self.add_item("Nothing waiting for you", None, enabled=False)
        else:
            for card in waiting:
                label = f"{LABELS.get(card['status'], card['status'])} — {card.get('title', '')}"
                self.add_item(label, lambda _w, c=card: api(f"/api/card/{c['id']}/focus", {}))

        self.menu.append(Gtk.SeparatorMenuItem())
        for value, label in MODES:
            item = Gtk.CheckMenuItem(label=label)
            item.set_active(self.mode == value)
            item.connect("activate", self.on_mode, value)
            item.show()
            self.menu.append(item)

        self.menu.append(Gtk.SeparatorMenuItem())
        self.add_item("Dashboard", lambda _w: subprocess.Popen(["xdg-open", BASE]))
        self.add_item("Restart server", lambda _w: subprocess.Popen(["systemctl", "--user", "restart", "k0.service"]))
        self.add_item("Quit", lambda _w: Gtk.main_quit())
        self.menu.show_all()

    def add_item(self, label, handler, enabled=True):
        item = Gtk.MenuItem(label=label)
        item.set_sensitive(enabled and handler is not None)
        if handler:
            item.connect("activate", handler)
        item.show()
        self.menu.append(item)

    def on_mode(self, widget, value):
        # A CheckMenuItem fires `activate` when it is rebuilt too, which would post the mode
        # back to the server in an endless loop. Only a real change is worth a request.
        if widget.get_active() and self.mode != value:
            api("/api/mode", {"mode": value})


if __name__ == "__main__":
    Tray()
    Gtk.main()
