// Run from the repository root: swift scripts/generate-app-icons.swift
// Native AppKit conversion only. The selected artwork remains in icon-proposals.
import AppKit

let source = "assets/icon-proposals/forge-ignition.png"
guard let image = NSImage(contentsOfFile: source) else { fatalError("Missing \(source)") }
let canvas = NSSize(width: 1024, height: 1024)
let output = NSImage(size: canvas)
output.lockFocusFlipped(false)
NSGraphicsContext.current?.imageInterpolation = .high
// Mask away the presentation backdrop, retaining the tile's outer metallic rim.
// Coordinates are normalized from the 1254px source image.
let scale = 1024.0 / 1254.0
let tile = NSRect(x: 108 * scale, y: (1254 - 1148) * scale,
                  width: 1032 * scale, height: 1040 * scale)
NSBezierPath(roundedRect: tile, xRadius: 248 * scale, yRadius: 248 * scale).addClip()
image.draw(in: NSRect(origin: .zero, size: canvas))
output.unlockFocus()
guard let tiff = output.tiffRepresentation,
      let rendered = NSBitmapImageRep(data: tiff),
      let cgImage = rendered.cgImage,
      let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
      let context = NSGraphicsContext(bitmapImageRep: bitmap) else { fatalError("PNG conversion failed") }
context.cgContext.interpolationQuality = .high
context.cgContext.draw(cgImage, in: CGRect(origin: .zero, size: canvas))
guard let png = bitmap.representation(using: .png, properties: [:]) else { fatalError("PNG encoding failed") }
try png.write(to: URL(fileURLWithPath: "assets/forge-icon.png"))
// SVG is a lossless raster wrapper, not a vector tracing of the generated art.
let svg = """
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <title>Forge ignition icon</title>
  <image width="1024" height="1024" href="data:image/png;base64,\(png.base64EncodedString())" />
</svg>
"""
try svg.write(toFile: "assets/forge-icon.svg", atomically: true, encoding: .utf8)
