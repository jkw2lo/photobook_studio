// Rasterize every page of a PDF to PNG (macOS, no extra installs) so exports can be inspected visually.
//   swift scripts/render-pdf.swift <file.pdf> <out-dir> [dpi=72] [--spreads]
// --spreads also writes facing pages side by side, cropped to the trim box, the way the book opens.
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count >= 3, let doc = CGPDFDocument(URL(fileURLWithPath: args[1]) as CFURL) else {
  FileHandle.standardError.write("usage: render-pdf <file.pdf> <out-dir> [dpi] [--spreads]\n".data(using: .utf8)!)
  exit(1)
}
let outDir = URL(fileURLWithPath: args[2])
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
let dpi = args.count >= 4 ? (Double(args[3]) ?? 72) : 72
let spreads = args.contains("--spreads")
let scale = dpi / 72.0

func render(_ page: CGPDFPage, box: CGPDFBox) -> CGImage? {
  let r = page.getBoxRect(box)
  let w = Int((r.width * scale).rounded()), h = Int((r.height * scale).rounded())
  guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
  ctx.setFillColor(CGColor(gray: 1, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.scaleBy(x: scale, y: scale)
  ctx.translateBy(x: -r.minX, y: -r.minY)
  ctx.drawPDFPage(page)
  return ctx.makeImage()
}

func save(_ img: CGImage, _ name: String) {
  let url = outDir.appendingPathComponent(name)
  guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { return }
  CGImageDestinationAddImage(dest, img, nil)
  CGImageDestinationFinalize(dest)
}

var trimImages: [CGImage] = []
for i in 1...doc.numberOfPages {
  guard let page = doc.page(at: i) else { continue }
  if let img = render(page, box: .mediaBox) { save(img, String(format: "page-%03d.png", i)) }
  if spreads, let t = render(page, box: .trimBox) { trimImages.append(t) }
}

if spreads, let first = trimImages.first {
  // Page 1 is a right-hand page; then pairs (2,3), (4,5) …; the last page is a left-hand page.
  var groups: [[CGImage?]] = [[nil, first]]
  var k = 1
  while k < trimImages.count { groups.append([trimImages[k], k + 1 < trimImages.count ? trimImages[k + 1] : nil]); k += 2 }
  for (gi, g) in groups.enumerated() {
    let pw = first.width, ph = first.height
    guard let ctx = CGContext(data: nil, width: pw * 2 + 2, height: ph, bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { continue }
    ctx.setFillColor(CGColor(gray: 0.82, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: pw * 2 + 2, height: ph))
    if let l = g[0] { ctx.draw(l, in: CGRect(x: 0, y: 0, width: pw, height: ph)) }
    if let r = g[1] { ctx.draw(r, in: CGRect(x: pw + 2, y: 0, width: pw, height: ph)) }
    if let img = ctx.makeImage() { save(img, String(format: "spread-%02d.png", gi)) }
  }
}
print("Rendered \(doc.numberOfPages) pages to \(outDir.path)")
