// Rendering a QR locally with CoreImage.
//
// The backend returns the PAYLOAD, not a picture — deliberately, because the
// payload is what has to be correct and an image generated server-side would be
// one more thing to keep in step. Rendering here also means the projection view
// works with no further network round-trip once the string is in hand.
import CoreImage
import CoreImage.CIFilterBuiltins
import CoreGraphics

enum QRRenderer {
    private static let context = CIContext()

    /// A crisp QR at projection size. Nil when the payload cannot be encoded —
    /// the caller shows the failure rather than a blank square, because a blank
    /// square on a wall looks like a working code that nobody can scan.
    static func image(from payload: String, scale: CGFloat = 12) -> CGImage? {
        guard !payload.isEmpty, let data = payload.data(using: .utf8) else { return nil }
        let filter = CIFilter.qrCodeGenerator()
        filter.message = data
        // High correction: this is photographed across a room, at an angle,
        // sometimes partly obscured by a head.
        filter.correctionLevel = "H"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        return context.createCGImage(scaled, from: scaled.extent)
    }
}
