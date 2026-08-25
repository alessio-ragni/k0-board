// k0 — the icon in the menu bar.
//
// It knows nothing about sessions, transcripts or terminals: it asks the server what is waiting
// for you, tints the icon with the colour of the most urgent thing, and draws a short menu. All
// the intelligence stays in the server; this is only the face.

import AppKit
import UserNotifications

let port = ProcessInfo.processInfo.environment["K0_PORT"] ?? "4319"
// API calls go to the number, which depends on no name at all. The board in the browser opens
// with k0.localhost instead, so the browser learns that "k0" means this.
let base = "http://127.0.0.1:\(port)"
let boardURL = "http://k0.localhost:\(port)"

/// Where k0 keeps the things that outlive a reinstall. Mirrors `server/paths.js`.
let k0Home: URL = {
    if let custom = ProcessInfo.processInfo.environment["K0_HOME"] {
        return URL(fileURLWithPath: custom)
    }
    return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".k0")
}()

// MARK: - What the server answers

struct Waiting: Decodable {
    let id: Int
    let title: String
    let project: String
    let status: String
    let window: String?
}

struct Status: Decodable {
    let urgent: String?
    let waiting: [Waiting]
    /// Which of the four modes we are in: `sleep`, `away`, `nerd`, `driving`. The server holds
    /// it, not us: it is the same control that is on the board, and two separate copies of the
    /// same thing would end up disagreeing.
    ///
    /// Optional on purpose: a server older than this icon does not send the field, and with a
    /// plain `String` the whole response would fail to decode — the icon would say "server not
    /// responding" because of one field it could not find.
    let mode: String?
}

/// The four modes, in the order of the scale: sleepiest to most awake. The words are the
/// server's (`server/mode.js`); the titles are what the user reads.
enum Modes {
    static let all: [(String, String)] = [
        ("sleep", "Sleep"),
        ("away", "Away"),
        ("nerd", "Nerd"),
        ("driving", "Driving"),
    ]
}

/// The same colours as the board, but saturated: in a menu bar, pastels disappear.
func colour(_ state: String?) -> NSColor {
    switch state {
    case "ASK":      return NSColor(srgbRed: 0.94, green: 0.27, blue: 0.27, alpha: 1) // red
    case "PLANNED":  return NSColor(srgbRed: 0.98, green: 0.45, blue: 0.09, alpha: 1) // orange
    case "IDLE":     return NSColor(srgbRed: 0.92, green: 0.70, blue: 0.03, alpha: 1) // yellow
    case "WORKING",
         "PLANNING": return NSColor(srgbRed: 0.23, green: 0.51, blue: 0.96, alpha: 1) // blue
    default:         return NSColor(srgbRed: 0.61, green: 0.64, blue: 0.69, alpha: 1) // grey
    }
}

/// The same labels as the dashboard.
let label: [String: String] = [
    "ASK": "Needs answer",
    "PLANNED": "Needs approval",
    "IDLE": "Your turn",
    "WORKING": "Working",
    "PLANNING": "Planning",
]

/// The notifications switch, which stays as it was left even after a restart. Switched off, the
/// icon still changes colour: what disappears is only the notification.
enum Notifications {
    static let key = "k0.notifications"

    static var enabled: Bool {
        get {
            if UserDefaults.standard.object(forKey: key) == nil { return true } // on by default
            return UserDefaults.standard.bool(forKey: key)
        }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }
}

// MARK: - Cmd+V for images

/// In Terminal, Cmd+V with an image on the clipboard does nothing: Terminal swallows the
/// keystroke before Claude Code sees it, and an image would not go through a terminal anyway.
/// Inside an editor it works only because an extension is doing this same job.
///
/// The keystroke is not intercepted here — that road wants the Accessibility permission and
/// needs macOS to make it stick, which is far from a given. Instead this works on the clipboard,
/// which asks for no permission at all: **while Terminal is in front**, an image on the
/// clipboard is saved to a file and its path is put in its place. So your ordinary Cmd+V pastes
/// the path, and Claude Code recognises it and attaches it as `[Image #1]`. The moment you leave
/// Terminal the image goes back on the clipboard exactly as you copied it.
final class ImagePaste {
    private var image: Data?         // the real image, set aside
    private var ourChange = -1       // the changeCount of the swap we made
    private var counter = 0

    private let folder = k0Home.appendingPathComponent("cache/images")

    func start() {
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        clearOld()
        Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { _ in self.tick() }
        NSLog("k0: image pasting active (no permission required)")
    }

    private func tick() {
        let pb = NSPasteboard.general
        let inTerminal = NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "com.apple.Terminal"

        // The clipboard changed at somebody else's hand: read what is on it now.
        if pb.changeCount != ourChange {
            image = imageOnClipboard(pb)
            ourChange = -1
        }

        guard let png = image else { return }

        if inTerminal && ourChange == -1 {
            // You come into Terminal with an image copied: the path goes in its place.
            counter += 1
            let file = folder.appendingPathComponent("clipboard-\(counter).png")
            guard (try? png.write(to: file)) != nil else { return }
            pb.clearContents()
            pb.setString(file.path, forType: .string)
            ourChange = pb.changeCount
        } else if !inTerminal && ourChange != -1 {
            // You have left Terminal: the image goes back where it was.
            pb.clearContents()
            pb.setData(png, forType: .png)
            ourChange = pb.changeCount
        }
    }

    /// Only when the clipboard really holds an image and nothing else: if there is text, it is
    /// an ordinary paste and must not be touched.
    private func imageOnClipboard(_ pb: NSPasteboard) -> Data? {
        guard pb.string(forType: .string) == nil else { return nil }
        if let png = pb.data(forType: .png) { return png }
        guard let tiff = pb.data(forType: .tiff),
              let rep = NSBitmapImageRep(data: tiff) else { return nil }
        return rep.representation(using: .png, properties: [:])
    }

    /// Yesterday's images are of no use to anybody.
    private func clearOld() {
        let cutoff = Date().addingTimeInterval(-86400)
        let f = FileManager.default
        guard let files = try? f.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentModificationDateKey])
        else { return }
        for u in files {
            let date = (try? u.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
            if let date, date < cutoff { try? f.removeItem(at: u) }
        }
    }
}

// MARK: - The app

final class K0: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    var seen: [Int: String] = [:]      // the last known status of every card
    var firstPass = true               // no notifications on the first pass: that would be noise at startup
    /// What macOS currently thinks of this app's notifications. **Asked again and again, never
    /// remembered from the one answer at launch**: `requestAuthorization` replies asynchronously,
    /// this app starts at login — before the notification service is necessarily up — and a
    /// boolean captured in that callback would then say "no" for the rest of the day, with
    /// nothing anywhere to say why.
    var notificationStatus: UNAuthorizationStatus = .notDetermined
    private var loggedStatus: UNAuthorizationStatus?
    private var ticksBeforeAsking = 0
    let images = ImagePaste()

    func applicationDidFinishLaunching(_ n: Notification) {
        item.button?.image = icon(nil)
        item.menu = NSMenu()

        UNUserNotificationCenter.current().delegate = self

        images.start()
        watchScreens()
        watchTerminal()

        Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in
            self.refresh()
            self.readNotificationPermission()
        }
        refresh()
        readNotificationPermission()
    }

    /// Reads the permission on **every** pass, two seconds apart, along with everything else.
    ///
    /// It rides the same beat as the rest on purpose. Somebody who has just switched k0 on in
    /// System Settings comes straight back to this menu to see it change, and a menu that still
    /// says "blocked" reads as broken — they switch it off again, or give up. Half a minute is
    /// long enough for that; two seconds is not. The read is one call to a service already
    /// listening, next to an HTTP request that happens anyway.
    ///
    /// Asking is the part that is kept slow: the request is fired only where the permission has
    /// never been asked for, and at most once every half minute, because a request that fails
    /// leaves the status exactly as it was and would otherwise be retried on every pass.
    ///
    /// The log line is the point of the rest. A permission that was refused and one that was
    /// never asked for are both perfectly silent, and until this was written down the only visible
    /// symptom was a notification that did nothing. `launchd` sends it to
    /// `~/.k0/logs/com.k0.menubar.err.log`.
    func readNotificationPermission() {
        let centre = UNUserNotificationCenter.current()
        centre.getNotificationSettings { settings in
            DispatchQueue.main.async {
                self.record(settings.authorizationStatus)
                guard settings.authorizationStatus == .notDetermined else { return }
                guard self.ticksBeforeAsking <= 0 else {
                    self.ticksBeforeAsking -= 1
                    return
                }
                self.ticksBeforeAsking = 15   // half a minute, at one read every two seconds
                centre.requestAuthorization(options: [.alert, .sound]) { granted, error in
                    if let error {
                        NSLog("k0: macOS refused the notification permission: \(error.localizedDescription)")
                    } else if !granted {
                        NSLog("k0: the notification permission was declined")
                    }
                    // Whatever the answer, the next read is two seconds away and will report it.
                }
            }
        }
    }

    private func record(_ status: UNAuthorizationStatus) {
        notificationStatus = status
        guard loggedStatus != status else { return }
        loggedStatus = status
        NSLog("k0: notifications are \(Self.name(status))")
    }

    private static func name(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "allowed"
        case .provisional: return "allowed quietly"
        case .denied: return "denied"
        case .notDetermined: return "not granted — macOS has not registered this app"
        default: return "in an unknown state (\(status.rawValue))"
        }
    }

    /// True only when a notification posted now would actually be delivered.
    var canNotify: Bool { notificationStatus == .authorized || notificationStatus == .provisional }

    // MARK: The screen changing under the windows

    /// You plug a monitor in or out, or change resolution, and the session windows stay where
    /// they were: out of place, or off screen entirely. This hears the news and asks the server
    /// to put them back.
    ///
    /// It falls to the menu bar icon because it is the only piece of k0 that sees that
    /// notification: the server is plain Node, and to notice by itself it would have to
    /// interrogate the screen constantly, which is a waste for something that happens twice a day.
    func watchScreens() {
        NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { _ in self.relayoutWindows() }
    }

    /// The debounce is not general caution: the notification arrives in bursts — plugging in a
    /// monitor sends several in a row — and macOS takes a moment to settle the new arrangement
    /// anyway. Moving on the first one would centre everything on the old screen.
    private var screenTimer: Timer?
    func relayoutWindows() {
        screenTimer?.invalidate()
        screenTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: false) { _ in
            guard let url = URL(string: "\(base)/api/windows/relayout") else { return }
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            URLSession.shared.dataTask(with: req).resume()
        }
    }

    // MARK: Terminal quitting

    /// Shift+Enter starts a new line because the Terminal profile holds a key binding that sends
    /// Esc+Enter (the installer writes it; the reason is over there). The point is **when** to
    /// write it: Terminal reads those bindings only at startup, and on quitting it rewrites its
    /// preferences from what it had in memory — erasing our entry. Written while Terminal is
    /// running it is written for nothing; the only moment it survives is **right after Terminal
    /// has died**, and from there until its next launch nobody touches it again.
    ///
    /// It falls to the menu bar icon for the same reason as the screens: it is the only piece of
    /// k0 that sees applications leave. The real work stays in `k0-board shift-enter`, so the
    /// logic about profiles and preferences is written in one place only.
    func watchTerminal() {
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didTerminateApplicationNotification,
            object: nil,
            queue: .main
        ) { n in
            let app = n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            guard app?.bundleIdentifier == "com.apple.Terminal" else { return }
            self.restoreShiftEnter(in: 2)
        }

        // A Mac just switched on, or k0 installed with Terminal already closed: now is the good
        // moment, and no notification is coming to tell us.
        if !terminalRunning { restoreShiftEnter(in: 0) }
    }

    var terminalRunning: Bool {
        NSWorkspace.shared.runningApplications.contains { $0.bundleIdentifier == "com.apple.Terminal" }
    }

    private var shiftEnterInFlight = false

    /// The wait is not general caution: Terminal, as it dies, is still flushing its preferences
    /// to disk. Writing in the middle of that means being overwritten, which is exactly the
    /// trouble this is running away from.
    func restoreShiftEnter(in seconds: TimeInterval) {
        guard !shiftEnterInFlight else { return }
        shiftEnterInFlight = true

        // <k0>/menubar/k0.app → two steps back and we are at <k0>/bin/k0-board.js.
        let cli = Bundle.main.bundleURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("bin/k0-board.js")

        // The installer puts the interpreter's real path in the service's environment, because
        // under launchd the PATH is barely more than /usr/bin:/bin and a version manager's node
        // would not be found at all.
        let node = ProcessInfo.processInfo.environment["K0_NODE"] ?? "/usr/bin/env"
        let args = node == "/usr/bin/env" ? ["node", cli.path, "shift-enter"] : [cli.path, "shift-enter"]

        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + seconds) {
            defer { DispatchQueue.main.async { self.shiftEnterInFlight = false } }

            guard FileManager.default.isReadableFile(atPath: cli.path) else {
                NSLog("k0: Shift+Enter, cannot find \(cli.path) — was the app moved out of k0?")
                return
            }
            let p = Process()
            p.executableURL = URL(fileURLWithPath: node)
            p.arguments = args
            do {
                try p.run()
                p.waitUntilExit()
                NSLog("k0: Terminal quit, Shift+Enter put back in the profile (exit \(p.terminationStatus))")
            } catch {
                NSLog("k0: Shift+Enter not put back — \(error.localizedDescription)")
            }
        }
    }

    // MARK: Icon

    /// A small rounded square like a sticky note, tinted with the most urgent status.
    func icon(_ state: String?) -> NSImage {
        let side: CGFloat = 14
        let img = NSImage(size: NSSize(width: side, height: side))
        img.lockFocus()
        let r = NSBezierPath(roundedRect: NSRect(x: 1, y: 1, width: side - 2, height: side - 2),
                             xRadius: 2.5, yRadius: 2.5)
        if state == nil {
            // Nothing going on: outline only, so it does not catch the eye.
            colour(nil).setStroke()
            r.lineWidth = 1.5
            r.stroke()
        } else {
            colour(state).setFill()
            r.fill()
        }
        img.unlockFocus()
        img.isTemplate = false
        return img
    }

    // MARK: The refresh round

    func refresh() {
        guard let url = URL(string: "\(base)/api/status") else { return }
        var req = URLRequest(url: url)
        req.timeoutInterval = 3
        URLSession.shared.dataTask(with: req) { data, _, _ in
            let status: Status? = data.flatMap { try? JSONDecoder().decode(Status.self, from: $0) }
            DispatchQueue.main.async { self.draw(status) }
        }.resume()
    }

    func draw(_ status: Status?) {
        // Server down: a dark icon and a menu that says so, instead of disappearing.
        guard let status else {
            item.button?.image = icon(nil)
            item.button?.toolTip = "k0 — server not responding"
            buildMenu(nil)
            return
        }

        item.button?.image = icon(status.urgent)
        item.button?.toolTip = status.waiting.isEmpty
            ? "k0 — nothing waiting for you"
            : "k0 — \(status.waiting.count) waiting"
        buildMenu(status)
        notifyNew(status)
    }

    // MARK: Menu

    func buildMenu(_ status: Status?) {
        let menu = NSMenu()

        if status == nil {
            let m = NSMenuItem(title: "Server not responding", action: nil, keyEquivalent: "")
            m.isEnabled = false
            menu.addItem(m)
        } else if status!.waiting.isEmpty {
            let m = NSMenuItem(title: "Nothing waiting for you", action: nil, keyEquivalent: "")
            m.isEnabled = false
            menu.addItem(m)
        } else {
            for w in status!.waiting {
                let m = NSMenuItem(title: "\(w.title) · \(label[w.status] ?? w.status)",
                                   action: #selector(goToSession(_:)), keyEquivalent: "")
                m.target = self
                m.tag = w.id
                m.image = dot(w.status)
                menu.addItem(m)
            }
        }

        menu.addItem(.separator())
        let board = NSMenuItem(title: "Dashboard", action: #selector(openBoard), keyEquivalent: "")
        board.target = self
        menu.addItem(board)
        let restart = NSMenuItem(title: "Restart", action: #selector(restartServer), keyEquivalent: "")
        restart.target = self
        menu.addItem(restart)
        // macOS has the last word here, and when it is saying no the switch below would be a lie:
        // ticked, and nothing ever arrives. So the item stops pretending and takes you to the one
        // place where that can be undone.
        if canNotify {
            let notifications = NSMenuItem(title: "Notifications", action: #selector(toggleNotifications), keyEquivalent: "")
            notifications.target = self
            notifications.state = Notifications.enabled ? .on : .off
            menu.addItem(notifications)
        } else {
            let blocked = NSMenuItem(title: "Notifications blocked by macOS…",
                                     action: #selector(openNotificationSettings),
                                     keyEquivalent: "")
            blocked.target = self
            menu.addItem(blocked)
        }
        // The four modes sit next to these because they are the same kind of gesture — something
        // you leave as it is — but the tick comes from the server rather than from here: over
        // there the board changes them too, and the menu is rebuilt every two seconds anyway.
        // With the server down the items are left without an action, so macOS greys them out by
        // itself: `isEnabled` would not be enough, automatic menu enabling takes it straight back.
        //
        // All this says is where we are: whether the mode is holding all the way to the closed
        // lid is the board's story, which has the room to write it in words.
        menu.addItem(.separator())
        // With no answer from the server — or with a server older than this field — nothing is
        // ticked: guessing a mode and showing it as true would be worse than saying nothing,
        // because that is exactly the question the menu is there to answer.
        let current = status.flatMap { $0.mode }
        for (key, title) in Modes.all {
            let entry = NSMenuItem(title: title,
                                   action: status == nil ? nil : #selector(chooseMode(_:)),
                                   keyEquivalent: "")
            entry.target = self
            entry.representedObject = key
            entry.state = current == key ? .on : .off
            menu.addItem(entry)
        }

        menu.addItem(.separator())
        let quitItem = NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        item.menu = menu
    }

    func dot(_ state: String) -> NSImage {
        let d: CGFloat = 9
        let img = NSImage(size: NSSize(width: d, height: d))
        img.lockFocus()
        colour(state).setFill()
        NSBezierPath(ovalIn: NSRect(x: 0, y: 0, width: d, height: d)).fill()
        img.unlockFocus()
        return img
    }

    // MARK: Actions

    @objc func goToSession(_ sender: NSMenuItem) { focus(sender.tag) }

    func focus(_ id: Int) {
        guard let url = URL(string: "\(base)/api/card/\(id)/focus") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        URLSession.shared.dataTask(with: req).resume()
    }

    @objc func toggleNotifications(_ sender: NSMenuItem) {
        Notifications.enabled.toggle()
        sender.state = Notifications.enabled ? .on : .off
    }

    /// Straight to the Notifications pane. The colour of the dot in the menu bar still tells you
    /// what is waiting — what is missing without this permission is only being told without
    /// looking.
    @objc func openNotificationSettings() {
        guard let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") else { return }
        NSWorkspace.shared.open(url)
    }

    /// The server holds the mode, so here we only ask. The tick moves straight away so the menu
    /// is not left mute under your finger; the real one arrives with the next round, which is at
    /// most two seconds later.
    ///
    /// Clicking the one already ticked does nothing: you leave a mode, you do not switch it off,
    /// and there is always one lit.
    @objc func chooseMode(_ sender: NSMenuItem) {
        guard let chosen = sender.representedObject as? String, sender.state != .on else { return }
        for entry in sender.menu?.items ?? [] where entry.representedObject is String {
            entry.state = (entry.representedObject as? String) == chosen ? .on : .off
        }
        guard let url = URL(string: "\(base)/api/mode") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["mode": chosen])
        URLSession.shared.dataTask(with: req) { _, _, _ in
            DispatchQueue.main.async { self.refresh() }
        }.resume()
    }

    @objc func openBoard() {
        if let url = URL(string: boardURL) { NSWorkspace.shared.open(url) }
    }

    @objc func restartServer() {
        let uid = getuid()
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        p.arguments = ["kickstart", "-k", "gui/\(uid)/com.k0.server"]
        try? p.run()
    }

    @objc func quit() { NSApp.terminate(nil) }

    // MARK: Notifications

    /// Notifies only the MOVE into "Needs answer" or "Needs approval", and only when you are not
    /// already looking at that very terminal.
    func notifyNew(_ status: Status) {
        var now: [Int: String] = [:]
        for w in status.waiting { now[w.id] = w.status }

        // The seen statuses are updated even with notifications off: switching them back on must
        // not deliver everything that happened in the meantime all at once.
        if !firstPass && Notifications.enabled {
            for w in status.waiting where w.status == "ASK" || w.status == "PLANNED" {
                guard seen[w.id] != w.status else { continue }   // already notified
                guard !amLookingAt(w.window) else { continue }
                notify(w)
            }
        }
        seen = now
        firstPass = false
    }

    /// True when Terminal is the front application and its front window is this one.
    func amLookingAt(_ window: String?) -> Bool {
        guard NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "com.apple.Terminal" else {
            return false
        }
        guard let window, let expected = Int(window) else { return false }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        p.arguments = ["-e", "tell application \"Terminal\" to get id of front window"]
        let out = Pipe()
        p.standardOutput = out
        p.standardError = Pipe()
        do { try p.run() } catch { return false }
        p.waitUntilExit()
        let text = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        return Int(text.trimmingCharacters(in: .whitespacesAndNewlines)) == expected
    }

    /// There is one way to notify and no other. There used to be a second one — `osascript -e
    /// 'display notification'` — for when the Mac would not deliver this bundle's own. It is gone:
    /// a banner posted by `osascript` **belongs to Script Editor**, so it carries no card, has no
    /// delegate, and clicking it opened Script Editor's file dialog instead of the terminal. A
    /// notification you cannot click is worse than none, because you go and click it.
    ///
    /// When macOS will not deliver ours, the menu says so — see `buildMenu`.
    func notify(_ w: Waiting) {
        guard canNotify else { return }
        let c = UNMutableNotificationContent()
        c.title = "k0"
        c.body = "\(w.title) · \(label[w.status] ?? w.status)"
        c.userInfo = ["cardId": w.id]
        c.sound = .default
        let r = UNNotificationRequest(identifier: "k0-\(w.id)-\(w.status)", content: c, trigger: nil)
        UNUserNotificationCenter.current().add(r) { error in
            if let error { NSLog("k0: the notification was not delivered: \(error.localizedDescription)") }
        }
    }

    // Clicking the notification goes straight to that terminal.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        if let id = response.notification.request.content.userInfo["cardId"] as? Int { focus(id) }
        completionHandler()
    }

    // Show it even when k0 is "in the foreground" (it never really is, it is an accessory).
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
}

let app = NSApplication.shared
let delegate = K0()
app.delegate = delegate
app.setActivationPolicy(.accessory)   // no Dock icon, just the menu bar
app.run()
