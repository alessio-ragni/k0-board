// k0 Dictate — dictation that stays on this Mac.
//
// For now it does one thing: the trial that decides which engine k0's dictation will use. While
// you hold Control to dictate with Wispr Flow, this listens to the same microphone at the same
// moment, and when you let go it hands the recording to two offline engines — Apple's, here, and
// Whisper, through the server — and tells the server how long each one took. The trial page on
// the board puts the three texts side by side.
//
// It is an app of its own, apart from the menu bar icon, because macOS ties the Microphone and
// Accessibility permissions to the app's signature, and this one is meant to change almost never.
// See build.sh.

import AppKit
import AVFoundation
import Speech
import ApplicationServices

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

    func start(into url: URL) throws {
        let input = engine.inputNode
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

// MARK: - Control, held

/// Control held on its own, as Wispr Flow uses it. Any other key pressed meanwhile — Control+C in a
/// terminal, Control+Space for Wispr's hands-free mode — throws the recording away: that was not
/// somebody dictating.
final class Trial: NSObject, NSApplicationDelegate {
    let recorder = Recorder()
    var folder: URL?
    var pressedAt: Double = 0
    var recording = false
    var spoiled = false
    var current = ""
    var appleReady = false

    func applicationDidFinishLaunching(_ n: Notification) {
        // Asks once; System Settings lists the app afterwards whatever the answer was.
        let prompt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        _ = AXIsProcessTrustedWithOptions([prompt: true] as CFDictionary)
        AVCaptureDevice.requestAccess(for: .audio) { _ in }

        NSEvent.addGlobalMonitorForEvents(matching: [.flagsChanged, .keyDown]) { event in
            self.handle(event)
        }

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

    /// Tells the board this app is alive and what it is allowed to do, and learns where to put the
    /// recordings — the server owns that folder, so the two never disagree about it.
    func hello() {
        let body: [String: Any] = [
            "accessibility": AXIsProcessTrusted(),
            "microphone": AVCaptureDevice.authorizationStatus(for: .audio) == .authorized,
            "apple": appleReady,
        ]
        post("/api/dictate/hello", body) { answer in
            if let dir = answer["dir"] as? String { self.folder = URL(fileURLWithPath: dir) }
        }
    }

    func handle(_ event: NSEvent) {
        if event.type == .keyDown {
            if recording { spoiled = true }
            return
        }
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let controlOnly = flags == .control
        if controlOnly && !recording {
            begin()
        } else if recording && !flags.contains(.control) {
            end()
        } else if recording && !controlOnly {
            spoiled = true
        }
    }

    func begin() {
        guard let folder else { return }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        current = String(Int(now()))
        do {
            try recorder.start(into: folder.appendingPathComponent("\(current).wav"))
            recording = true
            spoiled = false
            pressedAt = now()
        } catch {
            recording = false
        }
    }

    func end() {
        let releasedAt = now()
        recorder.stop()
        recording = false
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
let delegate = Trial()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
