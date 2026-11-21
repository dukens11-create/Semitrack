package com.semitrax.nativebridge;

import com.alk.cpik.route.RouteMgr;
import com.alk.cpik.route.RouteEnums;
import com.alk.cpik.route.VehicleRoutingProfile;
import com.alk.cpik.route.VehicleDimensions;
import com.alk.cpik.route.VehicleRoutingProfileSource;

/** Read-only verification of the limited standard semitrailer mode against CPIK 11.4. */
final class CoPilotStandardTruck {
  private VehicleRoutingProfile reviewed;
  private String snapshot;
  private boolean accepted;
  // Source describes provenance, not whether a profile is a valid truck profile.
  // Keep fleet-only selection separate; never rewrite an assigned profile.
  private static boolean isHeavyTruck(VehicleRoutingProfile p) {
    if (p == null || p.getVehicleType() != RouteEnums.VehicleType.TRUCK_HEAVY_DUTY)
      return false;
    VehicleRoutingProfileSource source = p.getVehicleRoutingProfileSource();
    return source == VehicleRoutingProfileSource.DEFAULT
        || source == VehicleRoutingProfileSource.MANUAL
        || source == VehicleRoutingProfileSource.API
        || source == VehicleRoutingProfileSource.FLEET_PORTAL;
  }
  static final class Difference {
    final String field;
    final int expected;
    final Integer actual;
    final boolean minimum;
    Difference(String field, int expected, Integer actual, boolean minimum) {
      this.field = field; this.expected = expected; this.actual = actual; this.minimum = minimum;
    }
  }
  static final class DimensionsMismatch extends IllegalStateException {
    final java.util.List<Difference> differences;
    DimensionsMismatch(java.util.List<Difference> differences) {
      super("TRUCK_DIMENSIONS_MISMATCH");
      this.differences = java.util.Collections.unmodifiableList(new java.util.ArrayList<>(differences));
    }
  }
  private static Integer inches(com.alk.cpik.DistanceUnit value) {
    return value == null ? null : value.getInches();
  }
  private static Integer pounds(com.alk.cpik.WeightUnit value) {
    return value == null ? null : value.getPounds();
  }
  private static void compare(java.util.List<Difference> rows, String field,
      int expected, Integer actual, boolean minimum) {
    if (actual == null || (minimum ? actual < expected : actual != expected))
      rows.add(new Difference(field, expected, actual, minimum));
  }
  void clear() { reviewed = null; snapshot = null; accepted = false; }
  void verify(int height, int width, int length, int weight, int axleWeight,
      int trailers, int axles, boolean avoidTolls) {
    clear();
    if (height < 60 || height > 162 || width < 60 || width > 102 || length != 636
        || weight < 1500 || weight > 80000 || axleWeight < 800 || axleWeight > 34000
        || trailers != 1 || axles != 5)
      throw new IllegalStateException("STANDARD_TRUCK_UNSUPPORTED");
    VehicleRoutingProfile p = RouteMgr.getActiveVehicleRoutingProfile();
    if (!isHeavyTruck(p))
      throw new IllegalStateException("HEAVY_TRUCK_PROFILE_REQUIRED");
    VehicleDimensions d = p.getVehicleDimensions();
    java.util.List<Difference> differences = new java.util.ArrayList<>();
    compare(differences, "heightInches", height, d == null ? null : inches(d.getHeight()), false);
    compare(differences, "widthInches", width, d == null ? null : inches(d.getWidth()), false);
    compare(differences, "lengthInches", length, d == null ? null : inches(d.getLength()), false);
    compare(differences, "maximumStraightLengthInches", length, d == null ? null : inches(d.getMaximumStraightLength()), false);
    compare(differences, "trailerCount", trailers, d == null ? null : d.getTrailerCount(), false);
    compare(differences, "bumperToBumperLengthInches", length, d == null ? null : inches(d.getBumperToBumperLength()), true);
    compare(differences, "totalWeightLbs", weight, d == null ? null : pounds(d.getTotalWeight()), false);
    compare(differences, "axleGroupWeightLbs", axleWeight, d == null ? null : pounds(d.getWeightPerAxle()), false);
    if (!differences.isEmpty()) throw new DimensionsMismatch(differences);
    // The supplied sample maps QUICKEST to its PRACTICAL label.
    if (p.getRoutingType() != RouteEnums.RoutingType.QUICKEST
        || p.getHazmatType() != RouteEnums.HazmatType.NONE
        || p.getTollRoadUsage() != (avoidTolls ? RouteEnums.TollRoads.ALWAYS_AVOID : RouteEnums.TollRoads.NO_RESTRICTION))
      throw new IllegalStateException("TRUCK_PREFERENCES_MISMATCH");
    reviewed = p;
    snapshot = p.toString();
  }
  void requireVerified() {
    VehicleRoutingProfile active = RouteMgr.getActiveVehicleRoutingProfile();
    if (reviewed == null || !isHeavyTruck(active)
        || !reviewed.getName().equals(active.getName())
        || !snapshot.equals(active.toString()) || !reviewed.equals_RoutingFieldsOnly(active)) {
      clear();
      throw new IllegalStateException("STANDARD_TRUCK_RECHECK_REQUIRED");
    }
  }
  void accept() { requireVerified(); accepted = true; }
  void requireAccepted() {
    requireVerified();
    if (!accepted) throw new IllegalStateException("STANDARD_TRUCK_CONFIRMATION_REQUIRED");
  }
}
