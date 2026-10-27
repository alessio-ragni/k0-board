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
///
/// The microphone is opened and closed on a queue of its own, never on the main thread: the
/// keyboard is read there, and opening a microphone can take seconds — four and a half, measured,
/// for an iPhone's over Continuity. Waited for on the main thread, that wait outlasted the
/// keyboard's patience: macOS switched the tap off, the release of Control never arrived, and the
/// pill stayed up listening until the app was restarted.
///
/// One engine serves phrase after phrase, because that is what measured best: fifty starts in a
/// row, switching microphone each time, gave sound every time, where a new engine for every
/// phrase came up deaf about one time in eight. It is built again only when it can no longer be
/// trusted — a microphone came or went, the default changed, the Mac woke up, or it gave no sound.
final class Recorder {
    private var engine = AVAudioEngine()
    private var queue = DispatchQueue(label: "k0.audio")
    private var stale = false
    /// Bumped by every start, stop and reset: an answer, or a buffer, from an earlier one is dropped.
    private var turn = 0
    private(set) var url: URL?
    /// How loud the last moment was, 0…1, for the wave in the pill. Called on the main thread.
    var onLevel: ((Float) -> Void)?
    /// The loudest moment of this recording, on the same scale, and when it began: a phrase that
    /// never got loud is silence, and Whisper fills silence with words nobody said.
    private(set) var peak: Float = 0
    private(set) var startedAt = Date()
    /// When the microphone last sent anything, loud or not; nil until it first does.
    private(set) var heardAt: Date?
    /// When the microphone said it was open; nil while it is still being opened.
    private(set) var openedAt: Date?
    /// Since when the audio queue has been busy on something that has not come back yet.
    private(set) var busySince: Date?
    /// The microphone this phrase is being recorded from, for the log.
    private(set) var device = ""

    /// The engine is built again before the next phrase.
    func renew() { stale = true }

    /// Opens the microphone into `url` and says, on the main thread, whether it could: nil, or why not.
    func start(into url: URL, then done: @escaping (String?) -> Void) {
        turn += 1
        let turn = self.turn
        // The old engine is let go on the audio queue, behind the work still holding it.
        let retired = stale ? engine : nil
        if stale {
            engine = AVAudioEngine()
            stale = false
        }
        self.url = url
        peak = 0
        startedAt = Date()
        heardAt = nil
        openedAt = nil
        device = ""
        let engine = self.engine
        busySince = Date()
        queue.async {
            withExtendedLifetime(retired) {}
            // Asked here, not on the main thread: CoreAudio can be slow to answer while devices change.
            let chosen = Microphones.chosen()
            let name = Microphones.name(chosen ?? Microphones.standard()) ?? "unknown microphone"
            DispatchQueue.main.async { if self.turn == turn { self.device = name } }
            let failure = Recorder.open(engine, into: url, device: chosen) { [weak self] level in
                guard let self, self.turn == turn else { return }
                self.heardAt = Date()
                self.peak = max(self.peak, level)
                self.onLevel?(level)
            }
            DispatchQueue.main.async {
                guard self.turn == turn else { return }
                self.busySince = nil
                if failure == nil { self.openedAt = Date() }
                done(failure)
            }
        }
    }

    /// Closes the microphone, and the file with it so the engines read all of it, then calls `done`
    /// on the main thread.
    func stop(then done: (() -> Void)? = nil) {
        turn += 1
        let turn = self.turn
        let engine = self.engine
        busySince = Date()
        queue.async {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
            DispatchQueue.main.async {
                guard self.turn == turn else { return }
                self.busySince = nil
                done?()
            }
        }
    }

    /// For a queue that never came back: whatever it is stuck in is left behind, with its engine,
    /// and the next phrase starts on a new queue and a new engine.
    func reset() {
        turn += 1
        busySince = nil
        queue = DispatchQueue(label: "k0.audio")
        engine = AVAudioEngine()
        stale = false
    }

    private static func open(_ engine: AVAudioEngine, into url: URL, device: AudioDeviceID?,
                             level: @escaping (Float) -> Void) -> String? {
        let input = engine.inputNode
        // A tap left behind by a start that failed half-way would make this one raise, and quit the app.
        input.removeTap(onBus: 0)
        if let device, let unit = input.audioUnit {
            var id = device
            AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0,
                                 &id, UInt32(MemoryLayout<AudioDeviceID>.size))
        }
        let inFormat = input.outputFormat(forBus: 0)
        guard inFormat.sampleRate > 0, inFormat.channelCount > 0 else { return "the microphone has no sound format" }
        guard let outFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000,
                                             channels: 1, interleaved: false),
              let converter = AVAudioConverter(from: inFormat, to: outFormat) else {
            return "no usable audio format"
        }
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
        ]
        let file: AVAudioFile
        do {
            file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32,
                                   interleaved: false)
        } catch {
            return "the recording could not be written: \(error.localizedDescription)"
        }
        input.installTap(onBus: 0, bufferSize: 1024, format: inFormat) { buffer, _ in
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
            var heard: Float = 0
            if let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 {
                var sum: Float = 0
                for i in 0..<Int(buffer.frameLength) { sum += samples[i] * samples[i] }
                // In decibels, not raw amplitude: a voice at a normal distance is a few hundredths of
                // full scale, which on a straight line left the bars lying flat whatever you said.
                let rms = sqrt(sum / Float(buffer.frameLength))
                heard = max(0, min(1, (20 * log10(max(rms, 1e-6)) + 55) / 40))
            }
            DispatchQueue.main.async { level(heard) }
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            return error.localizedDescription
        }
        return nil
    }
}

// MARK: - The log

/// One line per phrase in ~/.k0/logs/dictate.log, on this Mac only: what was heard, where it was
/// meant to go and where it went. Without it a paste that went nowhere left no trace at all.
func note(_ line: String) {
    let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".k0/logs")
    let file = dir.appendingPathComponent("dictate.log")
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let stamp = ISO8601DateFormatter().string(from: Date())
    let data = Data("\(stamp) \(line)\n".utf8)
    if let handle = try? FileHandle(forWritingTo: file) {
        handle.seekToEndOfFile()
        handle.write(data)
        try? handle.close()
    } else {
        try? data.write(to: file)
    }
}

func name(_ app: NSRunningApplication?) -> String { app?.localizedName ?? "nothing" }

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

func ask(_ path: String, _ body: [String: Any]? = nil, timeout: TimeInterval = 120) async -> Any? {
    guard let url = URL(string: "\(base)\(path)") else { return nil }
    var req = URLRequest(url: url)
    req.timeoutInterval = timeout
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

    /// The system's default input.
    static func standard() -> AudioDeviceID? {
        var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultInputDevice,
                                                 mScope: kAudioObjectPropertyScopeGlobal,
                                                 mElement: kAudioObjectPropertyElementMain)
        var id = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &id) == noErr,
              id != 0 else { return nil }
        return id
    }

    static func name(_ id: AudioDeviceID?) -> String? {
        guard let id else { return nil }
        return string(id, kAudioObjectPropertyName)
    }

    /// Calls `changed` on the main thread whenever a microphone comes or goes, or the default
    /// input changes — plugging a monitor with a webcam in it, or an iPhone wandering into range.
    static func watch(_ changed: @escaping (String) -> Void) {
        let system = AudioObjectID(kAudioObjectSystemObject)
        for (selector, what) in [(kAudioHardwarePropertyDefaultInputDevice, "default microphone changed"),
                                 (kAudioHardwarePropertyDevices, "a sound device came or went")] {
            var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal,
                                                     mElement: kAudioObjectPropertyElementMain)
            AudioObjectAddPropertyListenerBlock(system, &address, DispatchQueue.main) { _, _ in changed(what) }
        }
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
    /// Coloured, not black like Wispr Flow's, so the two are never mistaken for each other: a light
    /// blue while it waits and while it listens, orange while the words are being worked out, and red
    /// only when something went wrong — red means an error, and nothing else. Soft tones, the kind a
    /// terminal status line uses: the pill sits on screen all day.
    static let resting = NSColor(srgbRed: 0.40, green: 0.66, blue: 0.86, alpha: 1)
    static let working = NSColor(srgbRed: 0.88, green: 0.62, blue: 0.36, alpha: 1)
    static let failed = NSColor(srgbRed: 0.85, green: 0.42, blue: 0.43, alpha: 1)
    var colour = PillView.resting

    override func draw(_ dirtyRect: NSRect) {
        colour.withAlphaComponent(0.9).setFill()
        NSBezierPath(roundedRect: bounds, xRadius: bounds.height / 2, yRadius: bounds.height / 2).fill()
        NSColor.white.withAlphaComponent(0.25).setStroke()
        let edge = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: bounds.height / 2,
                                yRadius: bounds.height / 2)
        edge.lineWidth = 1
        edge.stroke()
    }

    override func rightMouseDown(with event: NSEvent) { owner?.openMenu() }
}

/// Always at the bottom of the screen while dictation is on: small when idle, the wave alone for a
/// quick phrase, cancel / wave / done when hands-free — the shapes Wispr Flow taught.
final class Pill {
    enum Look { case idle, quick, handsFree, working, failed }

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
        case .quick, .working, .failed: size = NSSize(width: 86, height: 30)
        case .handsFree: size = NSSize(width: 140, height: 34)
        }
        place(size)
        view.frame = NSRect(origin: .zero, size: size)
        view.colour = look == .working ? PillView.working : look == .failed ? PillView.failed : PillView.resting
        wave.isHidden = look == .idle
        wave.dim = look == .working || look == .failed
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

    /// At the bottom of the screen the mouse is on. Also called when screens come and go: a pill left
    /// where a monitor used to be is a pill nobody can see.
    func place(_ size: NSSize? = nil) {
        let size = size ?? panel.frame.size
        let screen = NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) } ?? NSScreen.main
        let area = screen?.visibleFrame ?? .zero
        panel.setFrame(NSRect(x: area.midX - size.width / 2, y: area.minY + 10, width: size.width, height: size.height),
                       display: true)
    }

    /// Red for a second, then back to waiting: the phrase is not lost, it is in the menu's list when
    /// there was one to keep.
    func flashError() {
        show(.failed)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            if self?.view.colour == PillView.failed { self?.show(.idle) }
        }
    }
}

// MARK: - The pill's menu

/// A view whose origin is at the top, so the menu can be laid out the way it is read.
final class Flipped: NSView {
    override var isFlipped: Bool { true }
}

/// One line of the menu that does something: lit under the mouse, like a menu item, but drawn here so
/// it can hold two lines of a phrase and the time it was said.
final class MenuRow: NSView {
    let action: () -> Void
    var lit = false { didSet { needsDisplay = true } }

    init(frame: NSRect, action: @escaping () -> Void) {
        self.action = action
        super.init(frame: frame)
    }

    required init?(coder: NSCoder) { nil }

    override var isFlipped: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func updateTrackingAreas() {
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                       owner: self))
    }

    override func mouseEntered(with event: NSEvent) { lit = true }
    override func mouseExited(with event: NSEvent) { lit = false }
    override func mouseUp(with event: NSEvent) { if lit { action() } }

    override func draw(_ dirtyRect: NSRect) {
        guard lit else { return }
        PillView.resting.withAlphaComponent(0.35).setFill()
        NSBezierPath(roundedRect: bounds, xRadius: 7, yRadius: 7).fill()
    }
}

/// What a right-click on the pill opens, in place of the system's menu: dark and rounded like the pill,
/// above it, and — a panel that never takes the focus — leaving the cursor where it was, so a phrase
/// clicked here is pasted where you were typing. A click anywhere else, or Escape, closes it.
final class MenuPanel {
    let panel: PillPanel
    var outside: Any?
    var onClose: (() -> Void)?

    static let width: CGFloat = 360

    init(history: [(text: String, at: Double)], microphones: [(uid: String, name: String)], chosen: String?,
         paste: @escaping (String) -> Void, choose: @escaping (String?) -> Void, reset: @escaping () -> Void) {
        panel = PillPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered,
                          defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .popUpMenu
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]

        let inner = MenuPanel.width - 12
        let list = Flipped()
        var y: CGFloat = 6

        func header(_ title: String) {
            let label = NSTextField(labelWithString: title.uppercased())
            label.font = .systemFont(ofSize: 10, weight: .semibold)
            label.textColor = NSColor.white.withAlphaComponent(0.45)
            label.frame = NSRect(x: 18, y: y + 6, width: inner - 24, height: 14)
            list.addSubview(label)
            y += 24
        }
        func line() {
            let rule = NSBox(frame: NSRect(x: 18, y: y + 4, width: inner - 24, height: 1))
            rule.boxType = .custom
            rule.borderWidth = 0
            rule.fillColor = NSColor.white.withAlphaComponent(0.12)
            list.addSubview(rule)
            y += 9
        }
        func row(_ title: String, detail: String? = nil, mark: Bool = false, lines: Int = 1,
                 action: @escaping () -> Void) {
            let height: CGFloat = lines > 1 ? 46 : 28
            let item = MenuRow(frame: NSRect(x: 6, y: y, width: inner, height: height), action: action)
            let text = NSTextField(wrappingLabelWithString: title)
            text.font = .systemFont(ofSize: 13)
            text.textColor = NSColor.white.withAlphaComponent(0.92)
            text.maximumNumberOfLines = lines
            text.lineBreakMode = .byTruncatingTail
            text.cell?.truncatesLastVisibleLine = true
            let right: CGFloat = detail == nil ? 12 : 70
            text.frame = NSRect(x: 26, y: 5, width: inner - 26 - right, height: height - 10)
            item.addSubview(text)
            if mark {
                let tick = NSTextField(labelWithString: "✓")
                tick.font = .systemFont(ofSize: 12, weight: .semibold)
                tick.textColor = PillView.resting
                tick.frame = NSRect(x: 8, y: 6, width: 14, height: 16)
                item.addSubview(tick)
            }
            if let detail {
                let when = NSTextField(labelWithString: detail)
                when.font = .systemFont(ofSize: 11)
                when.textColor = NSColor.white.withAlphaComponent(0.45)
                when.alignment = .right
                when.frame = NSRect(x: inner - 66, y: 6, width: 58, height: 14)
                item.addSubview(when)
            }
            list.addSubview(item)
            y += height + 2
        }

        header("Transcript history")
        if history.isEmpty {
            let none = NSTextField(labelWithString: "Nothing dictated yet")
            none.font = .systemFont(ofSize: 13)
            none.textColor = NSColor.white.withAlphaComponent(0.45)
            none.frame = NSRect(x: 32, y: y + 4, width: inner - 40, height: 18)
            list.addSubview(none)
            y += 28
        }
        for entry in history {
            let long = entry.text.count > 48
            row(entry.text, detail: MenuPanel.ago(entry.at), lines: long ? 2 : 1) { paste(entry.text) }
        }
        line()
        if let last = history.first {
            row("Paste last transcript") { paste(last.text) }
            line()
        }
        header("Microphone")
        row("System default", mark: chosen == nil) { choose(nil) }
        for mic in microphones {
            row(mic.name, mark: mic.uid == chosen) { choose(mic.uid) }
        }
        line()
        row("Reset dictation") { reset() }
        y += 6

        let glass = NSVisualEffectView()
        glass.material = .hudWindow
        glass.blendingMode = .behindWindow
        glass.state = .active
        glass.appearance = NSAppearance(named: .darkAqua)
        glass.wantsLayer = true
        glass.layer?.cornerRadius = 14
        glass.layer?.masksToBounds = true
        glass.layer?.borderWidth = 1
        glass.layer?.borderColor = NSColor.white.withAlphaComponent(0.12).cgColor
        list.frame = NSRect(x: 0, y: 0, width: MenuPanel.width, height: y)
        glass.frame = list.frame
        glass.addSubview(list)
        panel.contentView = glass
        panel.setContentSize(list.frame.size)
    }

    /// Above the pill, centred on it, kept on the screen.
    func show(above pill: NSRect) {
        let screen = NSScreen.screens.first { $0.frame.intersects(pill) } ?? NSScreen.main
        let area = screen?.visibleFrame ?? .zero
        let size = panel.frame.size
        let height = min(size.height, area.height - 40)
        let x = min(max(pill.midX - size.width / 2, area.minX + 8), area.maxX - size.width - 8)
        panel.setFrame(NSRect(x: x, y: pill.maxY + 8, width: size.width, height: height), display: true)
        panel.orderFrontRegardless()
        outside = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            self?.close()
        }
    }

    func close() {
        if let outside { NSEvent.removeMonitor(outside) }
        outside = nil
        panel.orderOut(nil)
        onClose?()
        onClose = nil
    }

    static func ago(_ at: Double) -> String {
        let seconds = Date().timeIntervalSince1970 - at / 1000
        if seconds < 60 { return "just now" }
        if seconds < 3600 { return "\(Int(seconds / 60)) min ago" }
        if seconds < 86400 { return "\(Int(seconds / 3600)) h ago" }
        let format = DateFormatter()
        format.dateFormat = "d MMM"
        return format.string(from: Date(timeIntervalSince1970: at / 1000))
    }
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
    var tapSource: CFRunLoopSource?

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
    /// Which transcription is the one still wanted: one given up on, or cancelled, may still answer.
    var job = 0
    var workingSince: Double = 0
    /// A microphone that gave no sound is opened once more before the phrase is given up.
    var reopened = false

    var dictating: Bool { mode == "dictate" }

    func applicationDidFinishLaunching(_ n: Notification) {
        // The trial page opens the app; at login launchd does. Two copies would both paste.
        let mine = ProcessInfo.processInfo.processIdentifier
        if NSRunningApplication.runningApplications(withBundleIdentifier: "com.k0.dictate")
            .contains(where: { $0.processIdentifier != mine }) {
            exit(0)
        }
        // One question at a time: the microphone, then Accessibility once that is answered. Asked
        // together, the two windows opened on top of each other and the first click closed the other.
        AVCaptureDevice.requestAccess(for: .audio) { _ in
            DispatchQueue.main.async {
                let prompt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
                _ = AXIsProcessTrustedWithOptions([prompt: true] as CFDictionary)
            }
        }

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
        // In the common modes, so it keeps running while a menu or a drag holds the run loop.
        RunLoop.main.add(Timer(timeInterval: 0.5, repeats: true) { _ in self.watch() }, forMode: .common)
        observe()
        microphones = Microphones.all().map(\.name)
        note("started, microphones: \(microphones.joined(separator: ", "))")
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
    /// should have to restart the app after granting it. A tap macOS switched off is switched back on;
    /// one that is gone altogether — it happens across sleep and permission changes — is made again.
    func installTap() {
        if let tap, CFMachPortIsValid(tap) {
            if !CGEvent.tapIsEnabled(tap: tap) {
                note("keyboard: the tap was off, switched back on")
                CGEvent.tapEnable(tap: tap, enable: true)
            }
            return
        }
        if tap != nil { note("keyboard: the tap was gone, made again") }
        dropTap()
        let mask = (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue)
        let me = Unmanaged.passUnretained(self).toOpaque()
        guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
                                          eventsOfInterest: CGEventMask(mask), callback: { _, type, event, me in
            let this = Unmanaged<Dictation>.fromOpaque(me!).takeUnretainedValue()
            return this.handle(type, event)
        }, userInfo: me) else { return }
        self.tap = tap
        let source = CFMachPortCreateRunLoopSource(nil, tap, 0)
        tapSource = source
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
    }

    func dropTap() {
        if let tapSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), tapSource, .commonModes) }
        if let tap { CFMachPortInvalidate(tap) }
        tap = nil
        tapSource = nil
    }

    /// Returns nil to keep a key from the app in front — only ever Control+Space while dictating, and
    /// Escape while the pill is busy or its menu is open. Everything else passes through untouched.
    func handle(_ type: CGEventType, _ event: CGEvent) -> Unmanaged<CGEvent>? {
        let pass = Unmanaged.passUnretained(event)
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            let why = type == .tapDisabledByTimeout ? "the app was too slow" : "user input"
            DispatchQueue.main.async { note("keyboard: macOS switched the tap off (\(why)), switched back on") }
            return pass
        }
        // Our own Command-V, on its way to the app in front.
        if event.getIntegerValueField(.eventSourceUserData) == 0x6b30 { return pass }
        let flags = event.flags.intersection([.maskControl, .maskShift, .maskAlternate, .maskCommand,
                                              .maskSecondaryFn])
        if type == .keyDown {
            if event.getIntegerValueField(.keyboardEventKeycode) == 53 {
                if let menuPanel {
                    menuPanel.close()
                    return nil
                }
                if dictating && phase != .idle {
                    cancel("Escape")
                    return nil
                }
            }
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
                rememberTarget()
                guard startRecording() else { return }
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
        if phase != .quick {
            rememberTarget()
            guard startRecording() else { return }
        }
        phase = .handsFree
        handsFreeSince = now()
        lastTapAt = 0
        pill?.show(.handsFree)
    }

    @objc func cancelPressed() { abandon() }
    @objc func donePressed() { if phase == .handsFree { finish() } }

    // MARK: Recording, and what becomes of it

    /// False when there is nowhere to put the recording yet — the server has not answered since the
    /// app started — and then nothing is shown as listening.
    @discardableResult
    func startRecording() -> Bool {
        guard let liveDir else {
            note("microphone: not opened, k0 has not said where recordings go yet")
            return false
        }
        try? FileManager.default.createDirectory(at: liveDir, withIntermediateDirectories: true)
        current = String(Int(now()))
        reopened = false
        open(liveDir.appendingPathComponent("\(current).wav"))
        return true
    }

    func open(_ url: URL) {
        recorder.start(into: url) { failure in
            guard let failure, self.phase == .quick || self.phase == .handsFree else { return }
            note("microphone: \(self.recorder.device) did not open: \(failure)")
            self.recorder.renew()
            self.fail()
        }
    }

    /// Thrown away: nothing pasted, nothing kept.
    func abandon() {
        showTimer?.invalidate()
        recorder.stop()
        if let url = recorder.url { try? FileManager.default.removeItem(at: url) }
        phase = .idle
        drawIdle()
    }

    /// Something went wrong: nothing pasted, red for a moment, then back at rest and ready.
    func fail() {
        if phase == .working {
            job += 1
            phase = .idle
        } else {
            abandon()
        }
        if dictating { pill?.flashError() }
    }

    /// Escape while the pill listens or transcribes: whatever it was doing is dropped.
    func cancel(_ why: String) {
        note("cancelled with \(why)")
        if phase == .working {
            job += 1
            phase = .idle
            drawIdle()
        } else {
            abandon()
        }
    }

    func finish() {
        showTimer?.invalidate()
        guard let url = recorder.url else { return abandon() }
        let peak = recorder.peak
        let seconds = Date().timeIntervalSince(recorder.startedAt)
        let heard = String(format: "%.1fs, peak %.2f, ", seconds, peak) + recorder.device
        // Nobody spoke: nothing goes to an engine, so nothing can be invented.
        if peak < Dictation.silence {
            note("\(engine): silent (\(heard)), thrown away")
            return abandon()
        }
        phase = .working
        workingSince = now()
        job += 1
        let job = self.job
        pill?.show(.working)
        let engine = self.engine
        // Read only once the microphone has let go of the file, or the end of the phrase is missing.
        recorder.stop {
            Task {
                let (text, failure) = await Dictation.transcribe(url, engine: engine)
                await MainActor.run {
                    guard self.job == job, self.phase == .working else {
                        note("\(engine): \(heard), answered after it was given up, dropped")
                        return
                    }
                    self.phase = .idle
                    if let failure {
                        note("\(engine): \(heard), failed: \(failure)")
                        self.pill?.flashError()
                    } else if text.isEmpty {
                        note("\(engine): \(heard), nothing worth pasting")
                        self.drawIdle()
                    } else {
                        note("\(engine): \(heard), \(text.count) characters")
                        self.drawIdle()
                        self.deliver(text)
                    }
                }
            }
        }
    }

    // MARK: Nothing stays stuck

    /// Twice a second, the states that must not last. Each of these used to leave the pill up and
    /// Control dead until dictation was switched off and on; now each puts it back at rest and says
    /// in the log which one it was.
    func watch() {
        // A release of Control that never reached the tap: the key is up, the app still thinks it is down.
        if controlDown && !CGEventSource.flagsState(.combinedSessionState).contains(.maskControl) {
            note("keyboard: Control was let go without the app hearing it")
            controlDown = false
            controlReleased()
        }
        // The microphone queue stuck inside CoreAudio, opening or closing.
        if phase != .idle, let busy = recorder.busySince, Date().timeIntervalSince(busy) > 6 {
            note("microphone: \(recorder.device) did not answer for 6 s, left behind")
            recorder.reset()
            return fail()
        }
        switch phase {
        case .quick, .handsFree:
            guard let opened = recorder.openedAt else { return }
            if let heardAt = recorder.heardAt {
                if Date().timeIntervalSince(heardAt) > 2 {
                    note("microphone: \(recorder.device) went quiet in the middle of a phrase")
                    recorder.renew()
                    return finish()
                }
            } else if Date().timeIntervalSince(opened) > 1 {
                recorder.renew()
                if !reopened, let url = recorder.url {
                    note("microphone: \(recorder.device) gave no sound, opened again")
                    reopened = true
                    recorder.stop()
                    return open(url)
                }
                note("microphone: \(recorder.device) gave no sound at all")
                return fail()
            }
            if phase == .handsFree && now() - handsFreeSince > 10 * 60_000 {
                note("hands-free: open for ten minutes, closed")
                finish()
            }
        case .working:
            if now() - workingSince > 90_000 {
                note("\(engine): no text after 90 s, given up")
                fail()
            }
        case .idle:
            break
        }
    }

    /// What switching dictation off and on again used to be needed for, done in place: from the
    /// pill's menu, and by itself when the Mac wakes or the screen is unlocked. A phrase being
    /// transcribed is left to finish unless it is asked for by hand.
    func reset(_ why: String, keepWork: Bool = false) {
        note("reset: \(why)")
        menuPanel?.close()
        showTimer?.invalidate()
        if phase == .quick || phase == .handsFree {
            recorder.stop()
            if let url = recorder.url { try? FileManager.default.removeItem(at: url) }
        }
        if !(keepWork && phase == .working) {
            job += 1
            phase = .idle
        }
        recorder.reset()
        dropTap()
        installTap()
        controlDown = false
        spoiled = false
        lastTapAt = 0
        if phase == .idle { drawIdle() }
        pill?.place()
    }

    var microphones: [String] = []

    func observe() {
        let workspace = NSWorkspace.shared.notificationCenter
        workspace.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { _ in
            self.reset("the Mac woke up", keepWork: true)
        }
        workspace.addObserver(forName: NSWorkspace.sessionDidBecomeActiveNotification, object: nil, queue: .main) { _ in
            self.reset("the user session came back", keepWork: true)
        }
        DistributedNotificationCenter.default().addObserver(forName: .init("com.apple.screenIsUnlocked"), object: nil,
                                                            queue: .main) { _ in
            self.reset("the screen was unlocked", keepWork: true)
        }
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification,
                                               object: nil, queue: .main) { _ in
            note("screens changed: \(NSScreen.screens.count) now")
            self.pill?.place()
        }
        // Any engine's: there is only ever the recorder's. Not acted on here — choosing a microphone
        // posts it too — but if the engine really stopped, the guardian sees the sound stop and
        // closes the phrase with what it has.
        NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil,
                                               queue: .main) { _ in
            self.recorder.renew()
            if self.phase == .quick || self.phase == .handsFree {
                note("microphone: \(self.recorder.device) changed in the middle of a phrase")
            }
        }
        // A microphone coming or going does not cut a phrase short — an iPhone wanders in and out
        // of range on its own — but the next phrase gets an engine that knows about it.
        Microphones.watch { what in
            self.recorder.renew()
            let now = Microphones.all().map(\.name)
            let standard = Microphones.name(Microphones.standard()) ?? "none"
            if now != self.microphones || what.hasPrefix("default") {
                note("microphone: \(what); default \(standard); present: \(now.joined(separator: ", "))")
            }
            self.microphones = now
        }
    }

    /// Below this the loudest moment of a phrase was room noise, on the 0…1 scale of the wave.
    static let silence: Float = 0.15

    /// The text, or why there is none. An empty text with no failure is a phrase Whisper is known to
    /// invent over silence, which the server has already thrown away.
    static func transcribe(_ url: URL, engine: String) async -> (String, String?) {
        if engine == "whisper" {
            guard let answer = await ask("/api/dictate/transcribe", ["wav": url.path]) as? [String: Any] else {
                return ("", "k0 did not answer")
            }
            if let error = answer["error"] as? String { return ("", error) }
            return ((answer["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines), nil)
        }
        let (best, _) = await AppleEngine.best(url)
        try? FileManager.default.removeItem(at: url)
        return (best?.text ?? "", nil)
    }

    /// The app that was in front when Control went down, or when the menu opened: where the text
    /// belongs. Never this app itself.
    var target: NSRunningApplication?

    func rememberTarget() {
        let front = NSWorkspace.shared.frontmostApplication
        if front?.bundleIdentifier != Bundle.main.bundleIdentifier { target = front }
    }

    /// Into the last ten first, then pasted: if the paste goes nowhere, the phrase is still there.
    func deliver(_ text: String) {
        Task {
            _ = await ask("/api/dictate/history", ["text": text])
            await MainActor.run { self.paste(text) }
        }
    }

    /// Pasted where the focus is. If the focus has ended up on this app — nothing here takes text —
    /// the app you were in gets it back first, or the paste would land nowhere.
    func paste(_ text: String) {
        let front = NSWorkspace.shared.frontmostApplication
        let lost = front == nil || front?.bundleIdentifier == Bundle.main.bundleIdentifier
        if lost, let target, !target.isTerminated {
            note("paste: the focus was on \(name(front)), giving it back to \(name(target))")
            target.activate()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.press(text) }
            return
        }
        press(text)
    }

    /// The clipboard is borrowed, not taken: whatever was on it goes back a moment later.
    func press(_ text: String) {
        guard AXIsProcessTrusted() else {
            note("paste: refused, k0 Dictate has no Accessibility")
            pill?.flashError()
            return
        }
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
        // keys somebody may still be holding do not mix in.
        let source = CGEventSource(stateID: .privateState)
        source?.userData = 0x6b30
        for (code, down) in [(CGKeyCode(55), true), (9, true), (9, false), (55, false)] {
            let key = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down)
            key?.flags = down || code == 9 ? .maskCommand : []
            key?.post(tap: .cghidEventTap)
            usleep(8_000)
        }
        let into = NSWorkspace.shared.frontmostApplication
        let meant = target.flatMap { $0.processIdentifier == into?.processIdentifier ? nil : $0 }
        note("paste: \(text.count) characters into \(name(into))"
             + (meant.map { " (Control was pressed in \(name($0)))" } ?? ""))
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

    var menuPanel: MenuPanel?

    var menuOpening = false

    /// The list and the microphones are fetched off the main thread, where the keyboard is read: a
    /// server slow to answer used to hold the keys up with it.
    func openMenu() {
        if let open = menuPanel {
            open.close()
            return
        }
        guard !menuOpening else { return }
        menuOpening = true
        rememberTarget()
        Task.detached {
            let history = await Dictation.lastTen()
            let microphones = Microphones.all().map { (uid: $0.uid, name: $0.name) }
            await MainActor.run { self.showMenu(history, microphones) }
        }
    }

    func showMenu(_ history: [(text: String, at: Double)], _ microphones: [(uid: String, name: String)]) {
        menuOpening = false
        let menu = MenuPanel(
            history: history,
            microphones: microphones,
            chosen: UserDefaults.standard.string(forKey: Microphones.key),
            paste: { [weak self] text in
                self?.menuPanel?.close()
                note("menu: paste asked for")
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self?.paste(text) }
            },
            choose: { [weak self] uid in
                if let uid {
                    UserDefaults.standard.set(uid, forKey: Microphones.key)
                } else {
                    UserDefaults.standard.removeObject(forKey: Microphones.key)
                }
                self?.recorder.renew()
                self?.menuPanel?.close()
            },
            reset: { [weak self] in self?.reset("asked for from the menu") })
        menu.onClose = { [weak self] in self?.menuPanel = nil }
        menuPanel = menu
        menu.show(above: pill?.panel.frame ?? .zero)
    }

    static func lastTen() async -> [(text: String, at: Double)] {
        guard let list = await ask("/api/dictate/history", timeout: 3) as? [[String: Any]] else { return [] }
        return list.compactMap { entry in
            guard let text = entry["text"] as? String else { return nil }
            return (text: text, at: (entry["at"] as? NSNumber)?.doubleValue ?? 0)
        }
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
        trialRecording = true
        recorder.start(into: trialDir.appendingPathComponent("\(current).wav")) { failure in
            if failure != nil { self.trialRecording = false }
        }
    }

    func trialEnd() {
        guard trialRecording else { return }
        let releasedAt = now()
        trialRecording = false
        guard let url = recorder.url else { return }
        // Shorter than this is a key brushed, not a phrase — Wispr ignores it too.
        if spoiled || releasedAt - pressedAt < 400 {
            recorder.stop()
            try? FileManager.default.removeItem(at: url)
            return
        }
        let id = current
        let pressedAt = self.pressedAt
        recorder.stop { self.trialSend(id, url, pressedAt: pressedAt, releasedAt: releasedAt) }
    }

    func trialSend(_ id: String, _ url: URL, pressedAt: Double, releasedAt: Double) {
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
