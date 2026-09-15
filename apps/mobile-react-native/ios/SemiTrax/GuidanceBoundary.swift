import Foundation
protocol GuidanceBoundary {
  func command(_ command: String, payload: String) throws -> String
}
enum GuidanceFailure: Error { case notConfigured }
final class UnconfiguredGuidanceBoundary: GuidanceBoundary {
  func command(_ command: String, payload: String) throws -> String {
    if command == "stopNavigation" { return "{\"phase\":\"unavailable\"}" }
    throw GuidanceFailure.notConfigured
  }
}

