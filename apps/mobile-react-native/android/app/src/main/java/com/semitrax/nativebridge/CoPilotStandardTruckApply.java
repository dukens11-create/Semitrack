package com.semitrax.nativebridge;

import com.alk.cpik.DistanceUnit;
import com.alk.cpik.WeightUnit;
import com.alk.cpik.route.RouteMgr;
import com.alk.cpik.route.RouteEnums;
import com.alk.cpik.route.VehicleDimensions;
import com.alk.cpik.route.VehicleRoutingProfile;
import com.alk.cpik.route.VehicleRoutingProfileSource;
import java.util.List;
import java.util.UUID;

/** Explicit, driver-reviewed application. Never edits or replaces another profile. */
final class CoPilotStandardTruckApply {
  private static void success(RouteEnums.VehicleProfileModificationResult result) {
    if (result != RouteEnums.VehicleProfileModificationResult.SUCCESS)
      throw new IllegalStateException("PROFILE_APPLY_REJECTED");
  }
  static void apply(int height, int width, int length, int weight, int axleWeight,
      int trailers, int axles, boolean avoidTolls, int bumper) throws Exception {
    CoPilotStandardTruck.validateRequest(height, width, length, weight, axleWeight, trailers, axles);
    // Overall combination length cannot be inferred from trailer length.
    if (bumper <= length) throw new IllegalStateException("OVERALL_LENGTH_REQUIRED");
    if (RouteMgr.hasDestination() || RouteMgr.getStopList() == null || !RouteMgr.getStopList().isEmpty())
      throw new IllegalStateException("PROFILE_APPLY_TRIP_ACTIVE");
    VehicleRoutingProfile previous = RouteMgr.getActiveVehicleRoutingProfile();
    if (previous == null || previous.getVehicleRoutingProfileSource() == null)
      throw new IllegalStateException("PROFILE_APPLY_REJECTED");
    if (previous.getVehicleRoutingProfileSource() == VehicleRoutingProfileSource.FLEET_PORTAL)
      throw new IllegalStateException("FLEET_PROFILE_MANAGED");
    String previousSnapshot = previous.toString();
    VehicleRoutingProfile candidate = VehicleRoutingProfile.createNewProfile(
        "SemiTraX " + UUID.randomUUID().toString().substring(0, 8), RouteEnums.VehicleType.TRUCK_HEAVY_DUTY);
    if (candidate == null) throw new IllegalStateException("PROFILE_APPLY_REJECTED");
    VehicleDimensions dimensions = new VehicleDimensions();
    dimensions.setHeight(DistanceUnit.fromInches(height));
    dimensions.setWidth(DistanceUnit.fromInches(width));
    dimensions.setLength(DistanceUnit.fromInches(length));
    dimensions.setMaximumStraightLength(DistanceUnit.fromInches(length));
    dimensions.setBumperToBumperLength(DistanceUnit.fromInches(bumper));
    dimensions.setTrailerCount(trailers);
    dimensions.setTotalWeight(WeightUnit.fromPounds(weight));
    dimensions.setWeightPerAxle(WeightUnit.fromPounds(axleWeight));
    List<RouteEnums.VehicleProfileModificationResult> results = candidate.setVehicleDimensions(dimensions);
    if (results == null || results.isEmpty()) throw new IllegalStateException("PROFILE_APPLY_REJECTED");
    for (RouteEnums.VehicleProfileModificationResult result : results) success(result);
    success(candidate.setRoutingType(RouteEnums.RoutingType.QUICKEST));
    success(candidate.setHazmatType(RouteEnums.HazmatType.NONE));
    success(candidate.setTollRoadUsage(avoidTolls ? RouteEnums.TollRoads.ALWAYS_AVOID : RouteEnums.TollRoads.NO_RESTRICTION));
    success(candidate.setDiscouragedFerries(false));
    if (RouteMgr.addVehicleRoutingProfile(candidate, false) != RouteEnums.RoutingProfileAdditionResult.SUCCESS)
      throw new IllegalStateException("PROFILE_APPLY_REJECTED");
    try {
      RouteMgr.setActiveVehicleRoutingProfile(candidate);
      VehicleRoutingProfile actual = RouteMgr.getActiveVehicleRoutingProfile();
      if (actual == null || !candidate.getName().equals(actual.getName())
          || actual.getVehicleRoutingProfileSource() != VehicleRoutingProfileSource.API)
        throw new IllegalStateException("PROFILE_APPLY_UNCONFIRMED");
      new CoPilotStandardTruck().verify(height, width, length, weight, axleWeight, trailers, axles, avoidTolls);
      VehicleDimensions readback = actual.getVehicleDimensions();
      if (readback.getBumperToBumperLength().getInches() != bumper || !Boolean.FALSE.equals(actual.getDiscouragedFerries()))
        throw new IllegalStateException("PROFILE_APPLY_UNCONFIRMED");
    } catch (Exception failure) {
      // No trip is running. Restore the previous active profile if activation or readback failed.
      try {
        RouteMgr.setActiveVehicleRoutingProfile(previous);
        VehicleRoutingProfile restored = RouteMgr.getActiveVehicleRoutingProfile();
        if (restored == null || !previous.getName().equals(restored.getName())
            || !previousSnapshot.equals(restored.toString()) || !previous.equals_RoutingFieldsOnly(restored))
          throw new IllegalStateException("PROFILE_RESTORE_UNCONFIRMED");
      } catch (Exception restoreFailure) {
        throw new IllegalStateException("PROFILE_RESTORE_UNCONFIRMED");
      }
      throw new IllegalStateException("PROFILE_APPLY_UNCONFIRMED");
    }
    // Successful application is not driver acceptance and never starts guidance.
  }
}
