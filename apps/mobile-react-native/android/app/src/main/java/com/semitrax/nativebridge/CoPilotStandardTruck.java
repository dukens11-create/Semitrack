package com.semitrax.nativebridge;

import com.alk.cpik.route.RouteMgr;
import com.alk.cpik.route.RouteEnums;
import com.alk.cpik.route.VehicleRoutingProfile;
import com.alk.cpik.route.VehicleDimensions;

/** Read-only verification of the existing 11.3 standard semitrailer mode.
 * Does not assert separate overall-length or trailer-count API support. */
final class CoPilotStandardTruck {
  private VehicleRoutingProfile reviewed;
  private String snapshot;
  private boolean accepted;
  void clear() { reviewed = null; snapshot = null; accepted = false; }
  void verify(int height, int width, int length, int weight, int axleWeight,
      int trailers, int axles, boolean avoidTolls) {
    clear();
    if (height < 60 || height > 162 || width < 60 || width > 102 || length != 636
        || weight < 1500 || weight > 80000 || axleWeight < 800 || axleWeight > 34000
        || trailers != 1 || axles != 5)
      throw new IllegalStateException("STANDARD_TRUCK_UNSUPPORTED");
    VehicleRoutingProfile p = RouteMgr.getActiveVehicleRoutingProfile();
    if (!CoPilotFleetProfiles.isFleetTruck(p))
      throw new IllegalStateException("FLEET_PROFILE_REQUIRED");
    VehicleDimensions d = p.getVehicleDimensions();
    if (d == null || d.getHeight().getInches() != height || d.getWidth().getInches() != width
        || d.getLength().getInches() != length || d.getTotalWeight().getPounds() != weight
        || d.getWeightPerAxle().getPounds() != axleWeight)
      throw new IllegalStateException("TRUCK_DIMENSIONS_MISMATCH");
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
    if (reviewed == null || !CoPilotFleetProfiles.isFleetTruck(active)
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
