// Render every page of a PDF side by side into one PNG, so the printed result can be looked at.
//   swift pdfpng.swift in.pdf out.png      → prints "pages N"
import PDFKit
import AppKit

let args = CommandLine.arguments
guard args.count == 3, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
  print("usage: swift pdfpng.swift in.pdf out.png"); exit(1)
}
var images: [NSImage] = []
for i in 0..<doc.pageCount {
  let p = doc.page(at: i)!
  let r = p.bounds(for: .mediaBox)
  images.append(p.thumbnail(of: NSSize(width: r.width, height: r.height), for: .mediaBox))
}
let w = images.reduce(0) { $0 + $1.size.width + 20 }, h = images.map { $0.size.height }.max() ?? 1
let out = NSImage(size: NSSize(width: max(w, 1), height: h))
out.lockFocus(); NSColor.gray.setFill(); NSRect(x: 0, y: 0, width: w, height: h).fill()
var x: CGFloat = 0
for im in images { im.draw(in: NSRect(x: x, y: h - im.size.height, width: im.size.width, height: im.size.height)); x += im.size.width + 20 }
out.unlockFocus()
let rep = NSBitmapImageRep(data: out.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
print("pages", doc.pageCount)
