// Put screenshots side by side (scaled) in one image, e.g. the phone screenfuls of a document.
//   swift montage.swift out.png 0.5 a.png b.png c.png
import AppKit

let a = CommandLine.arguments
guard a.count >= 4, let scale = Double(a[2]) else { print("usage: swift montage.swift out.png scale in.png…"); exit(1) }
let ims = a[3...].map { NSImage(contentsOfFile: $0)! }
let reps = ims.map { $0.representations[0] }
let sizes = reps.map { NSSize(width: CGFloat($0.pixelsWide) * scale, height: CGFloat($0.pixelsHigh) * scale) }
let w = sizes.reduce(0) { $0 + $1.width + 12 }, h = sizes.map { $0.height }.max()!
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(w), pixelsHigh: Int(h), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSColor.darkGray.setFill(); NSRect(x: 0, y: 0, width: w, height: h).fill()
var x: CGFloat = 0
for (i, im) in ims.enumerated() { im.draw(in: NSRect(x: x, y: h - sizes[i].height, width: sizes[i].width, height: sizes[i].height)); x += sizes[i].width + 12 }
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: a[1]))
