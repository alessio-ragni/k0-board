// k0 Dictate — dictation that stays on this Mac.
//
// It is one of two things at a time, and the server says which.
//
// The trial, which decides the engine. While you hold Control to dictate with Wispr Flow, this
// listens to the same microphone at the same moment, and when you let go it hands the recording to
// two offline engines — Apple's, here, and Whisper, through the server — and tells the server how
// long each one took. The trial page on the board puts the three texts side by side. It only ever
// listens: every key still reaches the app it was meant for.
//
// Dictation, once an engine has been kept and the switch on that page is on. Control held on its
// own is a quick phrase; Control+Space, or Control tapped twice, is hands-free until Control comes
// again. A pill at the bottom of the screen shows it is listening; when the phrase is over, the
// chosen engine turns it into text, the text goes into the last ten, and then it is pasted where
// the cursor is. Right-click the pill for the microphone and those ten.
//
// It is an app of its own, apart from the menu bar icon, because macOS ties the Microphone and
// Accessibility permissions to the app's signature, and this one is meant to change almost never.
// See build.sh.

import AppKit
import AVFoundation
import Speech
import ApplicationServices
import CoreAudio
import AudioToolbox

let port = ProcessInfo.processInfo.environment["K0_PORT"] ?? "4319"
let base = "http://127.0.0.1:\(port)"

func now() -> Double { Date().timeIntervalSince1970 * 1000 }

func post(_ path: String, _ body: [String: Any], then: (([String: Any]) -> Void)? = nil) {
    guard let url = URL(string: "\(base)\(path)"),
          let data = try? JSONSerialization.data(withJSONObject: body) else { return }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "content-type")
    req.httpBody = data
    URLSession.shared.dataTask(with: req) { data, _, _ in
        guard let then, let data,
              let answer = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        DispatchQueue.main.async { then(answer) }
    }.resume()
}

// MARK: - Listening

/// Records the microphone to a 16 kHz mono WAV, the format both engines read without converting.
final class Recorder {
    private let engine = AVAudioEngine()
    private var file: AVAudioFile?
    private(set) var url: URL?
    /// How loud the last moment was, 0…1, for the wave in the pill. Called on the main thread.
    var onLevel: ((Float) -> Void)?

    func start(into url: URL) throws {
        let input = engine.inputNode
        if let device = Microphones.chosen(), let unit = input.audioUnit {
            var id = device
            AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0,
                                 &id, UInt32(MemoryLayout<AudioDeviceID>.size))
        }
        let inFormat = input.outputFormat(forBus: 0)
        guard let outFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000,
                                             channels: 1, interleaved: false),
              let converter = AVAudioConverter(from: inFormat, to: outFormat) else {
            throw NSError(domain: "k0", code: 1, userInfo: [NSLocalizedDescriptionKey: "no usable audio format"])
        }
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
        ]
        let file = try AVAudioFile(forWriting: url, settings: settings,
                                   commonFormat: .pcmFormatFloat32, interleaved: false)
        self.file = file
        self.url = url
        input.installTap(onBus: 0, bufferSize: 4096, format: inFormat) { buffer, _ in
            let capacity = AVAudioFrameCount(Double(buffer.frameLength) * 16000 / inFormat.sampleRate) + 32
            guard let out = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: capacity) else { return }
            var fed = false
            var error: NSError?
            converter.convert(to: out, error: &error) { _, status in
                if fed {
                    status.pointee = .noDataNow
                    return nil
                }
                fed = true
                status.pointee = .haveData
                return buffer
            }
            if error == nil { try? file.write(from: out) }
            if let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 {
                var sum: Float = 0
                for i in 0..<Int(buffer.frameLength) { sum += samples[i] * samples[i] }
                let level = min(1, sqrt(sum / Float(buffer.frameLength)) * 8)
                DispatchQueue.main.async { self.onLevel?(level) }
            }
        }
        engine.prepare()
        try engine.start()
    }

    /// Stops, and closes the file so the engines read all of it.
    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        file = nil
    }
}

// MARK: - Apple's engine

struct Heard {
    let text: String
    let confidence: Double
    let locale: String
}

/// Apple's engine listens in one language at a time and cannot say which one it is hearing. So the
/// recording goes to an Italian and an English transcriber at once, and the one more sure of itself
/// wins. A sentence that mixes the two is exactly what this cannot do well, and the trial is there
/// to show how badly.
enum AppleEngine {
    static let languages = ["it-IT", "en-US"]

    static func transcriber(_ identifier: String) async -> SpeechTranscriber? {
        guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: identifier)) else {
            return nil
        }
        return SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [],
                                 attributeOptions: [.transcriptionConfidence])
    }

    /// The models are fetched by macOS, not by k0, the first time a language is used. Done once at
    /// launch, so that the first phrase of the trial does not pay for it.
    static func prepare() async -> Bool {
        var ready = true
        for identifier in languages {
            guard let transcriber = await transcriber(identifier) else {
                ready = false
                continue
            }
            do {
                if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
                    try await request.downloadAndInstall()
                }
            } catch {
                ready = false
            }
        }
        return ready
    }

    static func hear(_ url: URL, in identifier: String) async throws -> Heard {
        guard let transcriber = await transcriber(identifier) else {
            return Heard(text: "", confidence: 0, locale: identifier)
        }
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let file = try AVAudioFile(forReading: url)
        async let collected = collect(transcriber)
        if let last = try await analyzer.analyzeSequence(from: file) {
            try await analyzer.finalizeAndFinish(through: last)
        } else {
            await analyzer.cancelAndFinishNow()
        }
        let (text, confidence) = try await collected
        return Heard(text: text.trimmingCharacters(in: .whitespacesAndNewlines), confidence: confidence,
                     locale: identifier)
    }

    private static func collect(_ transcriber: SpeechTranscriber) async throws -> (String, Double) {
        var text = ""
        var sum = 0.0
        var count = 0
        for try await result in transcriber.results {
            text += String(result.text.characters)
            for run in result.text.runs {
                if let confidence = run.transcriptionConfidence {
                    sum += confidence
                    count += 1
                }
            }
        }
        return (text, count > 0 ? sum / Double(count) : 0)
    }

    /// Both languages at once, and the surer one. The time is the time of the slower of the two,
    /// because both have to finish before anybody can say which one won.
    static func best(_ url: URL) async -> (Heard?, [Heard]) {
        var all: [Heard] = []
        await withTaskGroup(of: Heard?.self) { group in
            for identifier in languages {
                group.addTask { try? await hear(url, in: identifier) }
            }
            for await heard in group {
                if let heard { all.append(heard) }
            }
        }
        let best = all.filter { !$0.text.isEmpty }.max { $0.confidence < $1.confidence }
        return (best, all)
    }
}

// MARK: - Talking to the server, and waiting for the answer

func ask(_ path: String, _ body: [String: Any]? = nil) async -> Any? {
    guard let url = URL(string: "\(base)\(path)") else { return nil }
    var req = URLRequest(url: url)
    req.timeoutInterval = 120
    if let body, let data = try? JSONSerialization.data(withJSONObject: body) {
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = data
    }
    guard let (data, _) = try? await URLSession.shared.data(for: req) else { return nil }
    return try? JSONSerialization.jsonObject(with: data)
}

// MARK: - Microphones

/// The input devices CoreAudio knows, and the one picked from the pill's menu. Remembered by UID,
/// which survives unplugging; the numeric id does not.
enum Microphones {
    static let key = "microphone"

    static func all() -> [(id: AudioDeviceID, uid: String, name: String)] {
        var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices,
                                                 mScope: kAudioObjectPropertyScopeGlobal,
                                                 mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr
        else { return [] }
        var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
        let system = AudioObjectID(kAudioObjectSystemObject)
        guard AudioObjectGetPropertyData(system, &address, 0, nil, &size, &ids) == noErr else { return [] }
        return ids.compactMap { id in
            guard inputs(id) > 0, let uid = string(id, kAudioDevicePropertyDeviceUID),
                  let name = string(id, kAudioObjectPropertyName) else { return nil }
            return (id, uid, name)
        }
    }

    private static func inputs(_ id: AudioDeviceID) -> Int {
        var address = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams,
                                                 mScope: kAudioDevicePropertyScopeInput,
                                                 mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        AudioObjectGetPropertyDataSize(id, &address, 0, nil, &size)
        return Int(size) / MemoryLayout<AudioStreamID>.size
    }

    private static func string(_ id: AudioDeviceID, _ selector: AudioObjectPropertySelector) -> String? {
        var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal,
                                                 mElement: kAudioObjectPropertyElementMain)
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, &value) == noErr, let value else { return nil }
        return value.takeRetainedValue() as String
    }

    /// nil means the system's default input, which is also what an unplugged choice falls back to.
    static func chosen() -> AudioDeviceID? {
        guard let uid = UserDefaults.standard.string(forKey: key) else { return nil }
        return all().first { $0.uid == uid }?.id
    }
}

// MARK: - The pill

/// The bars that move with your voice.
final class Wave: NSView {
    var levels = [Float](repeating: 0, count: 9)
    var dim = false

    func push(_ level: Float) {
        levels.removeFirst()
        levels.append(level)
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        let gap: CGFloat = 3
        let width = (bounds.width - gap * CGFloat(levels.count - 1)) / CGFloat(levels.count)
        NSColor.white.withAlphaComponent(dim ? 0.35 : 0.95).setFill()
        for (i, level) in levels.enumerated() {
            let h = max(3, bounds.height * CGFloat(level))
            let rect = NSRect(x: CGFloat(i) * (width + gap), y: (bounds.height - h) / 2, width: width, height: h)
            NSBezierPath(roundedRect: rect, xRadius: width / 2, yRadius: width / 2).fill()
        }
    }
}

/// A round button drawn by hand, so the pill looks the same in light and dark mode.
final class Round: NSButton {
    let symbol: String
    let tint: NSColor

    init(_ symbol: String, tint: NSColor, target: AnyObject, action: Selector) {
        self.symbol = symbol
        self.tint = tint
        super.init(frame: NSRect(x: 0, y: 0, width: 24, height: 24))
        self.target = target
        self.action = action
        isBordered = false
        title = ""
    }

    required init?(coder: NSCoder) { fatalError() }

    override func draw(_ dirtyRect: NSRect) {
        tint.setFill()
        NSBezierPath(ovalIn: bounds.insetBy(dx: 1, dy: 1)).fill()
        guard let image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)?
            .withSymbolConfiguration(.init(pointSize: 11, weight: .bold)) else { return }
        let tinted = NSImage(size: image.size, flipped: false) { rect in
            image.draw(in: rect)
            NSColor.white.set()
            rect.fill(using: .sourceAtop)
            return true
        }
        let size = tinted.size
        tinted.draw(in: NSRect(x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2,
                               width: size.width, height: size.height))
    }
}

/// A panel that never takes the focus: the text has to land where the cursor already is.
final class PillPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class PillView: NSView {
    weak var owner: Dictation?
    /// Coloured, not black like Wispr Flow's, so the two are never mistaken for each other: green
    /// while it waits, red while it listens, orange while the words are being worked out.
    var colour = NSColor.systemGreen

    override func draw(_ dirtyRect: NSRect) {
        colour.withAlphaComponent(0.9).setFill()
        NSBezierPath(roundedRect: bounds, xRadius: bounds.height / 2, yRadius: bounds.height / 2).fill()
        NSColor.white.withAlphaComponent(0.25).setStroke()
        let edge = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: bounds.height / 2,
                                yRadius: bounds.height / 2)
        edge.lineWidth = 1
        edge.stroke()
    }

    override func rightMouseDown(with event: NSEvent) {
        guard let menu = owner?.menu() else { return }
        NSMenu.popUpContextMenu(menu, with: event, for: self)
    }
}

/// Always at the bottom of the screen while dictation is on: small when idle, the wave alone for a
/// quick phrase, cancel / wave / done when hands-free — the shapes Wispr Flow taught.
final class Pill {
    enum Look { case idle, quick, handsFree, working }

    let panel: PillPanel
    let view = PillView()
    let wave = Wave()
    let cancel: Round
    let done: Round

    init(owner: Dictation) {
        panel = PillPanel(contentRect: NSRect(x: 0, y: 0, width: 56, height: 14),
                          styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .statusBar
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        cancel = Round("xmark", tint: NSColor.white.withAlphaComponent(0.2), target: owner,
                       action: #selector(Dictation.cancelPressed))
        done = Round("checkmark", tint: NSColor.black.withAlphaComponent(0.3), target: owner,
                     action: #selector(Dictation.donePressed))
        view.owner = owner
        view.addSubview(wave)
        view.addSubview(cancel)
        view.addSubview(done)
        panel.contentView = view
        show(.idle)
    }

    func show(_ look: Look) {
        let size: NSSize
        switch look {
        case .idle: size = NSSize(width: 56, height: 14)
        case .quick, .working: size = NSSize(width: 86, height: 30)
        case .handsFree: size = NSSize(width: 140, height: 34)
        }
        let screen = NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) } ?? NSScreen.main
        let area = screen?.visibleFrame ?? .zero
        panel.setFrame(NSRect(x: area.midX - size.width / 2, y: area.minY + 10, width: size.width, height: size.height),
                       display: true)
        view.frame = NSRect(origin: .zero, size: size)
        view.colour = look == .idle ? .systemGreen : look == .working ? .systemOrange : .systemRed
        wave.isHidden = look == .idle
        wave.dim = look == .working
        cancel.isHidden = look != .handsFree
        done.isHidden = look != .handsFree
        if look == .handsFree {
            cancel.frame = NSRect(x: 5, y: 5, width: 24, height: 24)
            done.frame = NSRect(x: size.width - 29, y: 5, width: 24, height: 24)
            wave.frame = NSRect(x: 38, y: 7, width: size.width - 76, height: 20)
        } else {
            wave.frame = NSRect(x: 16, y: 6, width: size.width - 32, height: 18)
        }
        if look != .working { wave.levels = wave.levels.map { _ in 0 } }
        wave.needsDisplay = true
        view.needsDisplay = true
        panel.orderFrontRegardless()
    }

    func hide() { panel.orderOut(nil) }
}

// MARK: - Dictation, and the trial beside it

/// Everything that happens between a key and a paste. The keyboard is read through an event tap —
/// Accessibility again — because Control+Space has to be kept from the app in front, which a mere
/// listener cannot do.
final class Dictation: NSObject, NSApplicationDelegate {
    enum Phase { case idle, quick, handsFree, working }

    let recorder = Recorder()
    var pill: Pill?
    var tap: CFMachPort?

    // What the server said.
    var mode = "trial"
    var engine = ""
    var trialDir: URL?
    var liveDir: URL?
    var appleReady = false

    // Where we are.
    var phase = Phase.idle
    var controlDown = false
    var pressedAt: Double = 0
    var lastTapAt: Double = 0
    var spoiled = false
    var current = ""
    var showTimer: Timer?

    var dictating: Bool { mode == "dictate" }

    func applicationDidFinishLaunching(_ n: Notification) {
        // The trial page opens the app; at login launchd does. Two copies would both paste.
        let mine = ProcessInfo.processInfo.processIdentifier
        if NSRunningApplication.runningApplications(withBundleIdentifier: "com.k0.dictate")
            .contains(where: { $0.processIdentifier != mine }) {
            exit(0)
        }
        // Asks once; System Settings lists the app afterwards whatever the answer was.
        let prompt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        _ = AXIsProcessTrustedWithOptions([prompt: true] as CFDictionary)
        AVCaptureDevice.requestAccess(for: .audio) { _ in }

        recorder.onLevel = { [weak self] level in self?.pill?.wave.push(level) }

        Task {
            let ready = await AppleEngine.prepare()
            await MainActor.run {
                self.appleReady = ready
                self.hello()
            }
        }
        hello()
        Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { _ in self.hello() }
    }

    /// Tells the board this app is alive and what it is allowed to do, and learns what to be and
    /// where to put the recordings — the server owns those folders, so the two never disagree.
    func hello() {
        installTap()
        let body: [String: Any] = [
            "accessibility": AXIsProcessTrusted(),
            "microphone": AVCaptureDevice.authorizationStatus(for: .audio) == .authorized,
            "apple": appleReady,
        ]
        post("/api/dictate/hello", body) { answer in
            if let dir = answer["dir"] as? String { self.trialDir = URL(fileURLWithPath: dir) }
            if let dir = answer["liveDir"] as? String { self.liveDir = URL(fileURLWithPath: dir) }
            if let engine = answer["engine"] as? String { self.engine = engine }
            if let mode = answer["mode"] as? String, mode != self.mode, self.phase == .idle {
                self.mode = mode
                self.drawIdle()
            }
        }
    }

    func drawIdle() {
        if dictating {
            if pill == nil { pill = Pill(owner: self) }
            pill?.show(.idle)
        } else {
            pill?.hide()
        }
    }

    // MARK: The keyboard

    /// Retried on every hello: until Accessibility is granted the tap cannot exist, and nobody
    /// should have to restart the app after granting it.
    func installTap() {
        if let tap, CGEvent.tapIsEnabled(tap: tap) { return }
        if let tap {
            CGEvent.tapEnable(tap: tap, enable: true)
            return
        }
        let mask = (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue)
        let me = Unmanaged.passUnretained(self).toOpaque()
        guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
                                          eventsOfInterest: CGEventMask(mask), callback: { _, type, event, me in
            let this = Unmanaged<Dictation>.fromOpaque(me!).takeUnretainedValue()
            return this.handle(type, event)
        }, userInfo: me) else { return }
        self.tap = tap
        let source = CFMachPortCreateRunLoopSource(nil, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
    }

    /// Returns nil to keep a key from the app in front — only ever Control+Space, and only while
    /// dictating. Everything else passes through untouched.
    func handle(_ type: CGEventType, _ event: CGEvent) -> Unmanaged<CGEvent>? {
        let pass = Unmanaged.passUnretained(event)
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            return pass
        }
        // Our own Command-V, on its way to the app in front.
        if event.getIntegerValueField(.eventSourceUserData) == 0x6b30 { return pass }
        let flags = event.flags.intersection([.maskControl, .maskShift, .maskAlternate, .maskCommand,
                                              .maskSecondaryFn])
        if type == .keyDown {
            let space = event.getIntegerValueField(.keyboardEventKeycode) == 49
            if dictating && space && flags == .maskControl && phase != .working {
                if phase != .handsFree { goHandsFree() }
                return nil
            }
            if controlDown { spoiled = true }
            if phase == .quick { abandon() }
            return pass
        }
        // A change of modifiers.
        let controlOnly = flags == .maskControl
        if controlOnly && !controlDown {
            controlDown = true
            spoiled = false
            pressedAt = now()
            controlPressed()
        } else if controlDown && !flags.contains(.maskControl) {
            controlDown = false
            controlReleased()
        } else if controlDown && !controlOnly {
            spoiled = true
            if phase == .quick { abandon() }
        }
        return pass
    }

    func controlPressed() {
        if !dictating {
            trialBegin()
            return
        }
        switch phase {
        case .idle:
            if pressedAt - lastTapAt < 400 {
                goHandsFree()
            } else {
                startRecording()
                phase = .quick
                // Not shown at once: Control+C would flash it. A quarter of a second of Control alone
                // is somebody about to speak.
                showTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: false) { _ in
                    if self.phase == .quick && !self.spoiled { self.pill?.show(.quick) }
                }
            }
        default:
            break
        }
    }

    func controlReleased() {
        if !dictating {
            trialEnd()
            return
        }
        let held = now() - pressedAt
        switch phase {
        case .quick:
            showTimer?.invalidate()
            if spoiled || held < 400 {
                // A tap, not a phrase: perhaps the first half of a double tap.
                if !spoiled && held < 300 { lastTapAt = now() }
                abandon()
            } else {
                finish()
            }
        case .handsFree:
            // The Control that opened hands-free (the second tap, or Control+Space) is not the one
            // that closes it: that one comes later, on its own.
            if !spoiled && pressedAt > handsFreeSince { finish() }
        default:
            break
        }
    }

    var handsFreeSince: Double = 0

    func goHandsFree() {
        showTimer?.invalidate()
        if phase != .quick { startRecording() }
        phase = .handsFree
        handsFreeSince = now()
        lastTapAt = 0
        pill?.show(.handsFree)
    }

    @objc func cancelPressed() { abandon() }
    @objc func donePressed() { if phase == .handsFree { finish() } }

    // MARK: Recording, and what becomes of it

    func startRecording() {
        guard let liveDir else { return }
        try? FileManager.default.createDirectory(at: liveDir, withIntermediateDirectories: true)
        current = String(Int(now()))
        try? recorder.start(into: liveDir.appendingPathComponent("\(current).wav"))
    }

    /// Thrown away: nothing pasted, nothing kept.
    func abandon() {
        showTimer?.invalidate()
        recorder.stop()
        if let url = recorder.url { try? FileManager.default.removeItem(at: url) }
        phase = .idle
        drawIdle()
    }

    func finish() {
        recorder.stop()
        guard let url = recorder.url else { return abandon() }
        phase = .working
        pill?.show(.working)
        let engine = self.engine
        Task {
            let text = await Dictation.transcribe(url, engine: engine)
            if text.isEmpty { NSLog("k0 Dictate: \(engine) heard nothing in \(url.lastPathComponent)") }
            await MainActor.run {
                self.phase = .idle
                self.drawIdle()
                if !text.isEmpty { self.deliver(text) }
            }
        }
    }

    static func transcribe(_ url: URL, engine: String) async -> String {
        if engine == "whisper" {
            let answer = await ask("/api/dictate/transcribe", ["wav": url.path]) as? [String: Any]
            if let error = answer?["error"] as? String { NSLog("k0 Dictate: Whisper said \(error)") }
            return (answer?["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        }
        let (best, _) = await AppleEngine.best(url)
        try? FileManager.default.removeItem(at: url)
        return best?.text ?? ""
    }

    /// Into the last ten first, then pasted: if the paste goes nowhere, the phrase is still there.
    func deliver(_ text: String) {
        Task {
            _ = await ask("/api/dictate/history", ["text": text])
            await MainActor.run { self.paste(text) }
        }
    }

    /// The clipboard is borrowed, not taken: whatever was on it goes back a moment later.
    func paste(_ text: String) {
        let board = NSPasteboard.general
        let saved: [[NSPasteboard.PasteboardType: Data]] = (board.pasteboardItems ?? []).map { item in
            var copy: [NSPasteboard.PasteboardType: Data] = [:]
            for type in item.types { if let data = item.data(forType: type) { copy[type] = data } }
            return copy
        }
        board.clearContents()
        board.setString(text, forType: .string)
        let ours = board.changeCount
        // Command pressed, V, Command let go — the whole gesture, from a source of our own, so the
        // keys somebody may still be holding do not mix in. A bare V carrying the Command flag was
        // ignored often enough by Chrome and the Terminal to look like a paste that never happened.
        let source = CGEventSource(stateID: .privateState)
        source?.userData = 0x6b30
        for (code, down) in [(CGKeyCode(55), true), (9, true), (9, false), (55, false)] {
            let key = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down)
            key?.flags = down || code == 9 ? .maskCommand : []
            key?.post(tap: .cghidEventTap)
            usleep(8_000)
        }
        // An app reads the clipboard when it gets round to the paste, which can take more than half a
        // second; and if somebody copied something meanwhile, that is theirs and stays.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            guard board.changeCount == ours else { return }
            board.clearContents()
            let items = saved.map { copy -> NSPasteboardItem in
                let item = NSPasteboardItem()
                for (type, data) in copy { item.setData(data, forType: type) }
                return item
            }
            if !items.isEmpty { board.writeObjects(items) }
        }
    }

    // MARK: The pill's menu

    func menu() -> NSMenu {
        let menu = NSMenu()
        let mics = NSMenuItem(title: "Microphone", action: nil, keyEquivalent: "")
        let micMenu = NSMenu()
        let chosen = UserDefaults.standard.string(forKey: Microphones.key)
        let auto = NSMenuItem(title: "System default", action: #selector(chooseMicrophone(_:)), keyEquivalent: "")
        auto.target = self
        auto.state = chosen == nil ? .on : .off
        micMenu.addItem(auto)
        for mic in Microphones.all() {
            let item = NSMenuItem(title: mic.name, action: #selector(chooseMicrophone(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = mic.uid
            item.state = mic.uid == chosen ? .on : .off
            micMenu.addItem(item)
        }
        mics.submenu = micMenu
        menu.addItem(mics)
        menu.addItem(.separator())

        let history = NSMenuItem(title: "Transcript history", action: nil, keyEquivalent: "")
        let historyMenu = NSMenu()
        let list = lastTen()
        if list.isEmpty {
            historyMenu.addItem(NSMenuItem(title: "Nothing dictated yet", action: nil, keyEquivalent: ""))
        }
        for text in list {
            let title = text.count > 60 ? String(text.prefix(60)) + "…" : text
            let item = NSMenuItem(title: title, action: #selector(pasteOne(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = text
            item.toolTip = text
            historyMenu.addItem(item)
        }
        history.submenu = historyMenu
        menu.addItem(history)

        let last = NSMenuItem(title: "Paste last transcript", action: #selector(pasteOne(_:)), keyEquivalent: "")
        last.target = self
        last.representedObject = list.first
        last.isEnabled = list.first != nil
        menu.addItem(last)
        return menu
    }

    /// Read synchronously: the menu is open for as long as it takes, and the server is on this Mac.
    func lastTen() -> [String] {
        guard let url = URL(string: "\(base)/api/dictate/history"),
              let data = try? Data(contentsOf: url),
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return list.compactMap { $0["text"] as? String }
    }

    @objc func chooseMicrophone(_ sender: NSMenuItem) {
        if let uid = sender.representedObject as? String {
            UserDefaults.standard.set(uid, forKey: Microphones.key)
        } else {
            UserDefaults.standard.removeObject(forKey: Microphones.key)
        }
    }

    /// The menu has taken the focus by now; it gives it back as it closes, and the paste waits for that.
    @objc func pasteOne(_ sender: NSMenuItem) {
        guard let text = sender.representedObject as? String else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self.paste(text) }
    }

    // MARK: The trial

    /// Control held on its own, as Wispr Flow uses it. Any other key pressed meanwhile — Control+C in
    /// a terminal, Control+Space for Wispr's hands-free mode — throws the recording away: that was
    /// not somebody dictating. Nothing is kept from the app in front.
    var trialRecording = false

    func trialBegin() {
        guard let trialDir else { return }
        try? FileManager.default.createDirectory(at: trialDir, withIntermediateDirectories: true)
        current = String(Int(now()))
        do {
            try recorder.start(into: trialDir.appendingPathComponent("\(current).wav"))
            trialRecording = true
        } catch {
            trialRecording = false
        }
    }

    func trialEnd() {
        guard trialRecording else { return }
        let releasedAt = now()
        recorder.stop()
        trialRecording = false
        guard let url = recorder.url else { return }
        // Shorter than this is a key brushed, not a phrase — Wispr ignores it too.
        if spoiled || releasedAt - pressedAt < 400 {
            try? FileManager.default.removeItem(at: url)
            return
        }
        let id = current
        post("/api/dictate/trial", [
            "id": id,
            "releasedAt": releasedAt,
            "durationMs": releasedAt - pressedAt,
            "wav": url.path,
        ])
        Task.detached {
            let (best, all) = await AppleEngine.best(url)
            let ms = now() - releasedAt
            var apple: [String: Any] = [
                "text": best?.text ?? "",
                "ms": ms,
                "lang": best?.locale ?? "",
            ]
            apple["candidates"] = all.map { ["lang": $0.locale, "text": $0.text, "confidence": $0.confidence] }
            post("/api/dictate/trial/\(id)", ["apple": apple])
        }
    }
}

let app = NSApplication.shared
let delegate = Dictation()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
