import Foundation
import Vision

struct Line: Encodable {
    let text: String
    let top: Double
    let left: Double
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.minimumTextHeight = 0.023
let supportedLanguages = try request.supportedRecognitionLanguages()
if CommandLine.arguments.contains("--languages") {
    print(supportedLanguages.joined(separator: ", "))
    exit(0)
}

let side = CommandLine.arguments.dropFirst().first
let preferred = side == "id" ? ["id-ID", "en-US"] : ["en-US"]
let available = preferred.filter(supportedLanguages.contains)
if !available.isEmpty {
    request.recognitionLanguages = available
}
request.usesLanguageCorrection = false

let image = FileHandle.standardInput.readDataToEndOfFile()
try VNImageRequestHandler(data: image).perform([request])
let lines = (request.results ?? []).compactMap { observation -> Line? in
    guard let text = observation.topCandidates(1).first?.string else { return nil }
    return Line(text: text,
                top: 1 - Double(observation.boundingBox.maxY),
                left: Double(observation.boundingBox.minX))
}
let encoded = try JSONEncoder().encode(lines)
FileHandle.standardOutput.write(encoded)
