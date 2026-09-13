import AppKit
import MetalKit
import SwiftUI

/// A state describes actual work or playback. Preparing never impersonates an open microphone.
enum GenieOrbMode: String, CaseIterable {
    case idle, preparing, listening, thinking, speaking
    var animated: Bool { self == .thinking || self == .listening || self == .speaking }
    var usesAudio: Bool { self == .listening || self == .speaking }
}

struct LiquidOrbMotion {
    private(set) var mode: GenieOrbMode = .idle
    private(set) var values = LiquidOrbAssets.idle
    private var from = LiquidOrbAssets.idle
    private var target = LiquidOrbAssets.idle
    private var changedAt: Double = 0
    private var lastTime: Double?
    private var phase: Double = 0
    private var envelope: Float = 0

    static func clampedLevel(_ level: Float) -> Float { level.isFinite ? min(1, max(0, level)) : 0 }
    static func shouldAnimate(mode: GenieOrbMode, visible: Bool, reduceMotion: Bool) -> Bool {
        visible && !reduceMotion && mode.animated
    }

    mutating func setMode(_ next: GenieOrbMode, now: Double) {
        guard next != mode else { return }
        from = values
        target = next.animated ? LiquidOrbAssets.active : LiquidOrbAssets.idle
        changedAt = now
        mode = next
    }

    mutating func sample(now: Double, level: Float, reduced: Bool = false) -> [Float] {
        let dt = min(0.1, max(0, now - (lastTime ?? now)))
        lastTime = now
        let raw = min(1, max(0, (now - changedAt) / (mode.animated ? LiquidOrbAssets.activation : LiquidOrbAssets.settle)))
        let t = Float(reduced ? 1 : mode.animated ? 1 - pow(1 - raw, 3) : raw * raw * (3 - 2 * raw))
        for i in 3..<values.count {
            // Linear-light color interpolation, matching the upstream native export.
            if i >= 40 && (i - 40) % 4 < 3 {
                func linear(_ v: Float) -> Float { v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
                let c = linear(from[i]) + (linear(target[i]) - linear(from[i])) * t
                values[i] = c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1 / 2.4) - 0.055
            } else { values[i] = from[i] + (target[i] - from[i]) * t }
        }
        if reduced { envelope = 0 }
        let input = mode.usesAudio && !reduced ? Self.clampedLevel(level) : 0
        envelope += (input - envelope) * Float(1 - exp(-dt / (input > envelope ? 0.045 : 0.18)))
        var result = values
        result[4] += envelope * 0.055  // bounded silhouette, preserving the spherical shell
        result[6] *= 1 + envelope * 0.16
        result[14] *= 1 + envelope * 0.15
        if !reduced && mode.animated { phase += dt * Double(result[3]) * (mode == .speaking ? 1.15 : 1) }
        result[2] = Float((reduced ? 1.5 : phase) / Double(max(0.001, result[3])))
        return result
    }
}

/// Compile once per process; the selected Siri shader needs only one pass/three vertices.
final class LiquidOrbGPU {
    static let shared: LiquidOrbGPU? = {
        do { return try LiquidOrbGPU() }
        catch { NSLog("Genie liquid orb uses static fallback: %@", error.localizedDescription); return nil }
    }()
    let device: MTLDevice
    let queue: MTLCommandQueue
    let pipeline: MTLRenderPipelineState
    init() throws {
        guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
            throw NSError(domain: "GenieOrb", code: 1)
        }
        self.device = device; self.queue = queue
        // Upstream's unused ribbon entry calls discard_fragment without the Metal namespace.
        // Keep the vendored export unchanged and provide the missing using declaration.
        let source = "#include <metal_stdlib>\nusing metal::discard_fragment;\n" + LiquidOrbAssets.metal
        let library = try device.makeLibrary(source: source, options: nil)
        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = library.makeFunction(name: "vs_main")
        descriptor.fragmentFunction = library.makeFunction(name: "fs_main")
        descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm
        // The upstream shader emits premultiplied alpha.
        pipeline = try device.makeRenderPipelineState(descriptor: descriptor)
    }

    func encode(_ buffer: MTLCommandBuffer, pass: MTLRenderPassDescriptor, values: [Float]) {
        guard let encoder = buffer.makeRenderCommandEncoder(descriptor: pass) else { return }
        encoder.setRenderPipelineState(pipeline)
        values.withUnsafeBytes { encoder.setFragmentBytes($0.baseAddress!, length: $0.count, index: 0) }
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        encoder.endEncoding()
    }

    /// The real Metal pipeline, also used by the deterministic visual/alpha regression test.
    func image(mode: GenieOrbMode, size: Int = 192, time: Double = 2, level: Float = 0) -> NSImage? {
        guard size > 0 && size <= 1024 else { return nil }
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: size, height: size, mipmapped: false)
        descriptor.usage = [.renderTarget]; descriptor.storageMode = .shared
        guard let texture = device.makeTexture(descriptor: descriptor), let buffer = queue.makeCommandBuffer() else { return nil }
        var motion = LiquidOrbMotion(); motion.setMode(mode, now: 0)
        var values = motion.sample(now: time, level: level, reduced: true)
        values[2] = Float(time); values[4] += LiquidOrbMotion.clampedLevel(level) * 0.055
        values[0] = Float(size); values[1] = Float(size)
        let pass = MTLRenderPassDescriptor(); pass.colorAttachments[0].texture = texture
        pass.colorAttachments[0].loadAction = .clear; pass.colorAttachments[0].storeAction = .store
        encode(buffer, pass: pass, values: values); buffer.commit(); buffer.waitUntilCompleted()
        guard buffer.status == .completed,
              let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
                bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                colorSpaceName: .deviceRGB, bytesPerRow: size * 4, bitsPerPixel: 32), let bytes = bitmap.bitmapData else { return nil }
        texture.getBytes(bytes, bytesPerRow: size * 4, from: MTLRegionMake2D(0, 0, size, size), mipmapLevel: 0)
        for i in stride(from: 0, to: size * size * 4, by: 4) { let b = bytes[i]; bytes[i] = bytes[i + 2]; bytes[i + 2] = b }
        let image = NSImage(size: NSSize(width: size, height: size)); image.addRepresentation(bitmap); return image
    }
}

final class LiquidOrbMetalView: MTKView, MTKViewDelegate {
    private var motion = LiquidOrbMotion()
    private var mode: GenieOrbMode = .idle
    private var level: Float = 0
    private var reduced = false
    private var observers: [NSObjectProtocol] = []
    private var visibilityObservation: NSKeyValueObservation?
    private let gpu: LiquidOrbGPU?
    private(set) var renderedFrames = 0

    init() {
        gpu = LiquidOrbGPU.shared
        super.init(frame: .zero, device: gpu?.device)
        colorPixelFormat = .bgra8Unorm; clearColor = MTLClearColorMake(0, 0, 0, 0)
        layer?.isOpaque = false; preferredFramesPerSecond = 30
        enableSetNeedsDisplay = false; isPaused = true; delegate = self
        setAccessibilityElement(false)
    }
    required init(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
    override var isOpaque: Bool { false }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow(); removeObservers()
        visibilityObservation = window?.observe(\.isVisible, options: [.initial, .new]) { [weak self] _, _ in
            self?.refreshPlayback()
        }
        for name in [NSWindow.didChangeOcclusionStateNotification, NSWindow.didMiniaturizeNotification,
                     NSWindow.didDeminiaturizeNotification, NSApplication.didHideNotification,
                     NSApplication.didUnhideNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in self?.refreshPlayback() })
        }
        refreshPlayback()
    }
    override func viewDidHide() { super.viewDidHide(); refreshPlayback() }
    override func viewDidUnhide() { super.viewDidUnhide(); refreshPlayback() }
    func configure(mode: GenieOrbMode, level: Float, reduced: Bool) {
        let changed = self.mode != mode || self.reduced != reduced
        self.mode = mode; self.level = level; self.reduced = reduced
        motion.setMode(mode, now: CACurrentMediaTime())
        refreshPlayback()
        if changed && isPaused && window?.isVisible == true && !isHiddenOrHasHiddenAncestor { draw() }
    }
    func refreshPlayback() {
        // isVisible also covers captured/background windows. In remote desktop capture,
        // occlusionState can remain empty even while this surface is being viewed.
        // Hidden, miniaturized and detached views still stop their display link completely.
        let visible = window?.isVisible == true && window?.isMiniaturized == false && !isHiddenOrHasHiddenAncestor && !NSApp.isHidden
        isPaused = gpu == nil || !LiquidOrbMotion.shouldAnimate(mode: mode, visible: visible, reduceMotion: reduced)
    }
    private func removeObservers() {
        visibilityObservation = nil
        observers.forEach(NotificationCenter.default.removeObserver); observers.removeAll()
    }
    func stop() { isPaused = true; delegate = nil; removeObservers() }
    deinit { removeObservers() }
    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) { if isPaused { draw() } }
    func draw(in view: MTKView) {
        guard let gpu, drawableSize.width > 0, drawableSize.height > 0,
              let pass = currentRenderPassDescriptor, let drawable = currentDrawable,
              let buffer = gpu.queue.makeCommandBuffer() else { return }
        var values = motion.sample(now: CACurrentMediaTime(), level: level, reduced: reduced || !mode.animated)
        values[0] = Float(drawableSize.width); values[1] = Float(drawableSize.height)
        gpu.encode(buffer, pass: pass, values: values)
        buffer.present(drawable); buffer.commit(); renderedFrames += 1
    }
}

struct LiquidOrbSurface: NSViewRepresentable {
    var mode: GenieOrbMode
    var level: Float
    var reduced: Bool
    func makeNSView(context: Context) -> LiquidOrbMetalView { LiquidOrbMetalView() }
    func updateNSView(_ view: LiquidOrbMetalView, context: Context) { view.configure(mode: mode, level: level, reduced: reduced) }
    static func dismantleNSView(_ view: LiquidOrbMetalView, coordinator: ()) { view.stop() }
}
