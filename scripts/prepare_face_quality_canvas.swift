// xcrun swiftc -O -parse-as-library scripts/prepare_face_quality_canvas.swift -o <probe>
// <probe> /path/to/face-quality-lab-v2 /path/to/output
import Foundation
import CoreImage
import CoreVideo
import Vision
import ImageIO
import UniformTypeIdentifiers

@main struct CanvasReference {
    static func main() throws {
        let root = URL(fileURLWithPath: CommandLine.arguments[1]), out = URL(fileURLWithPath: CommandLine.arguments[2])
        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        let records = (try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("metrics.json"))) as! [String: Any])["records"] as! [[String: Any]]
        let cs = CGColorSpace(name: CGColorSpace.sRGB)!, context = CIContext(options: [.workingColorSpace: CGColorSpace(name: CGColorSpace.sRGB)!])
        func save(_ image: CIImage, _ name: String) throws {
            try context.writePNGRepresentation(of: image, to: out.appendingPathComponent(name), format: .RGBA8, colorSpace: cs)
        }
        func luma(_ image: CIImage, _ size: Int) throws -> [Float] {
            var pb: CVPixelBuffer?
            guard CVPixelBufferCreate(nil, size, size, kCVPixelFormatType_32BGRA, nil, &pb) == kCVReturnSuccess, let pb else { throw NSError(domain: "buffer", code: 1) }
            context.render(image, to: pb, bounds: CGRect(x: 0, y: 0, width: size, height: size), colorSpace: cs)
            CVPixelBufferLockBaseAddress(pb, .readOnly); defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
            let bytes = CVPixelBufferGetBaseAddress(pb)!.assumingMemoryBound(to: UInt8.self), stride = CVPixelBufferGetBytesPerRow(pb)
            var a = [Float](repeating: 0, count: size * size)
            for y in 0..<size { for x in 0..<size {
                let i = y * stride + x * 4 // CVPixelBuffer rows are top-left.
                a[y * size + x] = 0.2126 * Float(bytes[i + 2]) + 0.7152 * Float(bytes[i + 1]) + 0.0722 * Float(bytes[i])
            } }
            return a
        }
        func write(_ a: [Float], _ name: String) throws { try a.withUnsafeBytes { Data($0) }.write(to: out.appendingPathComponent(name)) }
        func centroid(_ p: [CGPoint]) -> CGPoint { CGPoint(x: p.map(\.x).reduce(0,+) / CGFloat(p.count), y: p.map(\.y).reduce(0,+) / CGFloat(p.count)) }
        func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat { hypot(a.x-b.x, a.y-b.y) }
        func perimeter(_ p: [CGPoint]) -> CGFloat { distance(p[0],p[1])+distance(p[1],p[4])+distance(p[4],p[3])+distance(p[3],p[0]) }
        let ideal = [CGPoint(x:193,y:272),CGPoint(x:319,y:272),CGPoint(x:256,y:198),CGPoint(x:201,y:141),CGPoint(x:311,y:141)], center = centroid(ideal)
        var cases: [[String: Any]] = [], cache: [String: (CIImage, [VNFaceObservation])] = [:]
        for record in records where !(record["id"] as! String).hasSuffix("-actual") {
            let id = record["id"] as! String, path = record["source"] as! String
            if cache[path] == nil {
                let image = CIImage(contentsOf: URL(fileURLWithPath:path), options:[.applyOrientationProperty:true])!
                let request = VNDetectFaceLandmarksRequest(); request.usesCPUOnly = true
                try VNImageRequestHandler(ciImage:image,options:[:]).perform([request])
                cache[path] = (image, (request.results ?? []).sorted { $0.boundingBox.midX < $1.boundingBox.midX })
            }
            let (original, observations) = cache[path]!, index = (record["index"] as! Int) - 1
            guard index < observations.count, let l = observations[index].landmarks, let le = l.leftEye, let re = l.rightEye, let nose = l.nose, let lips = l.outerLips else { throw NSError(domain:"landmarks",code:1) }
            let size = original.extent.size, mouth = lips.pointsInImage(imageSize:size)
            let points = [centroid(le.pointsInImage(imageSize:size)),centroid(re.pointsInImage(imageSize:size)),centroid(nose.pointsInImage(imageSize:size)),mouth[13],mouth[7]]
            let scale = perimeter(ideal) / perimeter(points), angle = -atan2(points[1].y-points[0].y,points[1].x-points[0].x), c = centroid(points)
            let t = CGAffineTransform(translationX:center.x,y:center.y).scaledBy(x:scale,y:scale).rotated(by:angle).translatedBy(x:-c.x,y:-c.y)
            let after = CIImage(contentsOf:root.appendingPathComponent("raw/\(id)-after.png"))!
            try save(after, "\(id)-after.png")
            // The model output is fixed for every scale of this face.
            let afterName = "after-\(id).f32"
            try write(try luma(after, 512), afterName)
            // Bound source memory even when enlarging a tiny face from a group photo.
            let region = CGRect(x:0,y:0,width:512,height:512).applying(t.inverted()).insetBy(dx:-8,dy:-8).integral.intersection(original.extent)
            let bounded = original.cropped(to:region).transformed(by:CGAffineTransform(translationX:-region.minX,y:-region.minY))
            let local = CGAffineTransform(translationX:region.minX,y:region.minY).concatenating(t)
            // Original and scaled sources use one explicit sRGB decode per variant.
            for target in [Double(512 / scale), 600, 800, 1024, 1400, 2000] {
                let factor = target / Double(512 / scale), tag = cases.count
                let source = bounded.transformed(by:CGAffineTransform(scaleX:factor,y:factor))
                let sourceName = "source-\(tag).png"; try save(source, sourceName)
                // Read the very same normalized PNG in Core Image and both browsers.
                let normalized = CIImage(contentsOf:out.appendingPathComponent(sourceName))!
                let transform = CGAffineTransform(scaleX:1/factor,y:1/factor).concatenating(local)
                let before = try luma(normalized.transformed(by:transform),512)
                let native = try luma(normalized.transformed(by:transform.concatenating(CGAffineTransform(scaleX:2,y:2))),1024)
                try write(before,"before-\(tag).f32"); try write(native,"native-\(tag).f32")
                let h = normalized.extent.height
                cases.append(["id":id,"source":sourceName,"after":"\(id)-after.png","referenceBefore":"before-\(tag).f32","referenceNative":"native-\(tag).f32","referenceAfter":afterName,"targetCrop":target,"upscaled":factor>1,"original":abs(factor-1)<0.00001,"interEyePixels":Double(distance(points[0],points[1]))*factor,"transform":[transform.a,-transform.b,-transform.c,transform.d,transform.c*h+transform.tx,512-transform.d*h-transform.ty]])
            }
            print(id); fflush(stdout)
        }
        try JSONSerialization.data(withJSONObject:cases,options:[.prettyPrinted,.sortedKeys]).write(to:out.appendingPathComponent("cases.json"))
    }
}
