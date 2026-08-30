import CoreLocation
import Flutter
import UIKit

final class NativeNavigationModule: NSObject, FlutterStreamHandler, CLLocationManagerDelegate {
  private static let methodsName = "com.semitrack/navigation/methods"
  private static let locationsName = "com.semitrack/navigation/locations"

  private let manager = CLLocationManager()
  private var eventSink: FlutterEventSink?
  private var running = false
  private var phase = "idle"
  private var voiceMuted = false
  private var hasTruckProfile = false
  private var hasDestination = false
  private var waypointIds = Set<String>()

  init(messenger: FlutterBinaryMessenger) {
    super.init()
    manager.delegate = self
    manager.activityType = .automotiveNavigation
    manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
    manager.distanceFilter = 1
    manager.pausesLocationUpdatesAutomatically = false

    let methods = FlutterMethodChannel(name: Self.methodsName, binaryMessenger: messenger)
    methods.setMethodCallHandler { [weak self] call, result in
      self?.handle(call, result: result)
    }
    FlutterEventChannel(name: Self.locationsName, binaryMessenger: messenger)
      .setStreamHandler(self)
  }

  private func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "start":
      guard CLLocationManager.locationServicesEnabled() else {
        result(FlutterError(code: "LOCATION_SERVICES_DISABLED", message: "Enable Location Services before starting navigation", details: nil))
        return
      }
      if let arguments = call.arguments as? [String: Any],
         let distance = arguments["distanceFilterMeters"] as? NSNumber {
        manager.distanceFilter = min(100, max(0, distance.doubleValue))
      }
      let authorization = authorizationStatus
      if authorization == .denied || authorization == .restricted {
        result(FlutterError(code: "LOCATION_PERMISSION_REQUIRED", message: "Grant Always location access before starting navigation", details: nil))
        return
      }
      if authorization == .notDetermined {
        manager.requestAlwaysAuthorization()
      }
      startUpdates()
      result(nil)
    case "stop":
      manager.stopUpdatingLocation()
      manager.allowsBackgroundLocationUpdates = false
      running = false
      result(nil)
    case "stopNavigation":
      phase = "idle"
      emitState()
      result(nil)
    case "cancelRoute":
      phase = "idle"
      hasDestination = false
      waypointIds.removeAll()
      emitState()
      result(nil)
    case "muteVoice":
      voiceMuted = true
      emitState()
      result(nil)
    case "unmuteVoice":
      voiceMuted = false
      emitState()
      result(nil)
    case "setTruckProfile":
      guard validTruckProfile(call.arguments) else {
        invalidArgument("A complete, valid commercial truck profile is required", result: result)
        return
      }
      hasTruckProfile = true
      result(nil)
    case "updateDestination":
      guard validCoordinate(call.arguments) else {
        invalidArgument("A valid destination is required", result: result)
        return
      }
      hasDestination = true
      result(nil)
    case "addWaypoint":
      guard let values = call.arguments as? [String: Any],
            let id = values["id"] as? String,
            !id.isEmpty,
            waypointIds.count < 25 || waypointIds.contains(id),
            validCoordinate(values) else {
        invalidArgument("A waypoint id and valid coordinate are required", result: result)
        return
      }
      waypointIds.insert(id)
      result(nil)
    case "removeWaypoint":
      guard let values = call.arguments as? [String: Any],
            let id = values["id"] as? String,
            waypointIds.remove(id) != nil else {
        invalidArgument("Waypoint not found", result: result)
        return
      }
      result(nil)
    case "previewRoute", "startNavigation", "recalculateRoute":
      failTruckSafeGuidance(result)
    case "status":
      result(statusPayload())
    case "openBatterySettings":
      guard let url = URL(string: UIApplication.openSettingsURLString) else {
        result(FlutterError(code: "SETTINGS_UNAVAILABLE", message: "Settings URL is unavailable", details: nil))
        return
      }
      UIApplication.shared.open(url)
      result(nil)
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  private func startUpdates() {
    manager.allowsBackgroundLocationUpdates = true
    manager.showsBackgroundLocationIndicator = true
    manager.startUpdatingLocation()
    running = true
  }

  private func statusPayload() -> [String: Any] {
    let permission: String
    switch authorizationStatus {
    case .authorizedAlways: permission = "always"
    case .authorizedWhenInUse: permission = "whenInUse"
    case .denied: permission = "denied"
    case .restricted: permission = "restricted"
    case .notDetermined: permission = "notDetermined"
    @unknown default: permission = "unknown"
    }
    return [
      "running": running,
      "permission": permission,
      "locationServicesEnabled": CLLocationManager.locationServicesEnabled(),
      "phase": phase,
      "guidanceProvider": "unavailable",
      "truckSafeGuidanceAvailable": false,
      "hasTruckProfile": hasTruckProfile,
      "hasDestination": hasDestination,
      "waypointCount": waypointIds.count,
      "voiceMuted": voiceMuted,
    ]
  }

  func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
    eventSink = events
    if let location = manager.location { emit(location) }
    emitState()
    return nil
  }

  func onCancel(withArguments arguments: Any?) -> FlutterError? {
    eventSink = nil
    return nil
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    if authorizationStatus == .authorizedAlways && running {
      startUpdates()
    }
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last else { return }
    emit(location)
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    eventSink?(FlutterError(code: "LOCATION_ERROR", message: error.localizedDescription, details: nil))
  }

  private func emit(_ location: CLLocation) {
    var mocked = false
    var headingAccuracy = -1.0
    if #available(iOS 13.4, *) {
      headingAccuracy = location.courseAccuracy
    }
    if #available(iOS 15.0, *) {
      mocked = location.sourceInformation?.isSimulatedBySoftware ?? false
    }
    eventSink?([
      "latitude": location.coordinate.latitude,
      "longitude": location.coordinate.longitude,
      "timestampMs": Int(location.timestamp.timeIntervalSince1970 * 1000),
      "accuracy": location.horizontalAccuracy,
      "altitude": location.altitude,
      "altitudeAccuracy": location.verticalAccuracy,
      "heading": location.course,
      "headingAccuracy": headingAccuracy,
      "speed": location.speed,
      "speedAccuracy": location.speedAccuracy,
      "isMocked": mocked,
    ])
  }

  private func emitState(errorCode: String? = nil, errorMessage: String? = nil) {
    var data: [String: Any] = [
      "phase": phase,
      "voiceMuted": voiceMuted,
    ]
    if let errorCode { data["errorCode"] = errorCode }
    if let errorMessage { data["errorMessage"] = errorMessage }
    eventSink?(["type": "state", "data": data])
  }

  private func failTruckSafeGuidance(_ result: @escaping FlutterResult) {
    let code = "TRUCK_SAFE_NATIVE_ROUTING_UNAVAILABLE"
    let message = "Truck-safe native guidance is unavailable until HERE SDK Navigate is licensed and configured."
    phase = "error"
    emitState(errorCode: code, errorMessage: message)
    result(FlutterError(code: code, message: message, details: nil))
  }

  private func invalidArgument(_ message: String, result: @escaping FlutterResult) {
    result(FlutterError(code: "INVALID_ARGUMENT", message: message, details: nil))
  }

  private func validCoordinate(_ arguments: Any?) -> Bool {
    guard let values = arguments as? [String: Any],
          let latitude = values["latitude"] as? NSNumber,
          let longitude = values["longitude"] as? NSNumber else { return false }
    return (-90.0...90.0).contains(latitude.doubleValue) &&
      (-180.0...180.0).contains(longitude.doubleValue)
  }

  private func validTruckProfile(_ arguments: Any?) -> Bool {
    guard let values = arguments as? [String: Any],
          validPositive(values["heightMeters"], maximum: 6.1),
          validPositive(values["widthMeters"], maximum: 6.1),
          validPositive(values["lengthMeters"], maximum: 61.0),
          validPositive(values["grossWeightKg"], maximum: 113_400),
          let axleCount = (values["axleCount"] as? NSNumber)?.intValue,
          (2...20).contains(axleCount),
          let axleWeights = values["axleWeightsKg"] as? [NSNumber],
          axleWeights.isEmpty || axleWeights.count == axleCount,
          axleWeights.allSatisfy({ $0.doubleValue >= 0 }),
          let hazmatEnabled = values["hazmatEnabled"] as? Bool,
          let hazmatClasses = values["hazmatClasses"] as? [String],
          hazmatEnabled || hazmatClasses.isEmpty else { return false }
    return true
  }

  private func validPositive(_ value: Any?, maximum: Double) -> Bool {
    guard let number = value as? NSNumber else { return false }
    return number.doubleValue > 0 && number.doubleValue <= maximum
  }

  private var authorizationStatus: CLAuthorizationStatus {
    if #available(iOS 14.0, *) {
      return manager.authorizationStatus
    }
    return CLLocationManager.authorizationStatus()
  }
}


