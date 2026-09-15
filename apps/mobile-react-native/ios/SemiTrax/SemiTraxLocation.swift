import Foundation
import CoreLocation
import UIKit
@objcMembers public final class SemiTraxLocation: NSObject, CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  private var permissionReply: ((String) -> Void)?
  private var wantsBackground = false
  private var foregroundOnly = true
  public var onFix: ((String) -> Void)?
  public var onError: ((String) -> Void)?
  private let guidance: GuidanceBoundary = UnconfiguredGuidanceBoundary()
  public override init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
    manager.distanceFilter = 1
    NotificationCenter.default.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
  }
  public func guidanceCommand(_ command: String, payload: String) -> String? { try? guidance.command(command, payload: payload) }
  public func permissionStatus() -> String {
    let status = manager.authorizationStatus
    guard CLLocationManager.locationServicesEnabled(), (status == .authorizedAlways || status == .authorizedWhenInUse), manager.accuracyAuthorization == .fullAccuracy else { return "denied" }
    return "granted"
  }
  public func permission(_ background: Bool, reply: @escaping (String) -> Void) {
    guard permissionReply == nil else { reply("pending"); return }
    guard CLLocationManager.locationServicesEnabled() else { reply("denied"); return }
    wantsBackground = background
    let status = manager.authorizationStatus
    if status == .denied || status == .restricted { reply("denied"); return }
    if status == .notDetermined {
      permissionReply = reply
      manager.requestWhenInUseAuthorization()
      return
    }
    if background && status != .authorizedAlways {
      // The staged Always upgrade may be deferred by iOS. Return an explicit state.
      manager.requestAlwaysAuthorization()
      reply("backgroundPermissionRequired")
      return
    }
    reply(manager.accuracyAuthorization == .fullAccuracy ? "granted" : "precisePermissionRequired")
  }
  public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    guard manager.authorizationStatus != .notDetermined, let reply = permissionReply else { return }
    permissionReply = nil
    let granted = manager.authorizationStatus == .authorizedAlways || manager.authorizationStatus == .authorizedWhenInUse
    reply(granted && manager.accuracyAuthorization == .fullAccuracy ? (wantsBackground && manager.authorizationStatus != .authorizedAlways ? "backgroundPermissionRequired" : "granted") : "denied")
  }
  public func start(_ background: Bool) -> String? {
    guard UIApplication.shared.applicationState == .active else { return "Start location while SemiTraX is visible." }
    let status = manager.authorizationStatus
    guard (status == .authorizedAlways || status == .authorizedWhenInUse), manager.accuracyAuthorization == .fullAccuracy else { return "Precise location permission required." }
    guard !background || status == .authorizedAlways else { return "Always location permission is required for background tracking." }
    foregroundOnly = !background
    manager.allowsBackgroundLocationUpdates = background
    manager.showsBackgroundLocationIndicator = background
    manager.pausesLocationUpdatesAutomatically = !background
    manager.startUpdatingLocation()
    return nil
  }
  public func stop() { manager.stopUpdatingLocation(); manager.allowsBackgroundLocationUpdates = false }
  @objc private func didEnterBackground() { if foregroundOnly { stop(); onError?("Foreground location paused. Enable location when returning to the planner.") } }
  public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last, location.horizontalAccuracy >= 0 else { return }
    if #available(iOS 15.0, *), location.sourceInformation?.isSimulatedBySoftware == true { onError?("Simulated location is not accepted for truck routing."); return }
    let value: [String: Any] = ["latitude": location.coordinate.latitude, "longitude": location.coordinate.longitude, "accuracy": location.horizontalAccuracy, "timestamp": location.timestamp.timeIntervalSince1970 * 1000, "heading": location.course >= 0 ? location.course as Any : NSNull(), "speed": location.speed >= 0 ? location.speed as Any : NSNull()]
    if let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) { onFix?(text) }
  }
  public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { onError?("Location unavailable: " + error.localizedDescription) }
  public func invalidate() { stop(); onFix = nil; onError = nil; permissionReply?("cancelled"); permissionReply = nil; NotificationCenter.default.removeObserver(self) }
}

