package com.semitrax.nativebridge;

import com.alk.cpik.route.RouteMgr;
import com.alk.cpik.route.RouteEnums.VehicleType;
import com.alk.cpik.route.VehicleRoutingProfile;
import com.alk.cpik.route.VehicleRoutingProfileSource;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Selects existing fleet profiles intact. Does not certify unsupported restrictions. */
final class CoPilotFleetProfiles {
  static final class Review {
    final String ticket = UUID.randomUUID().toString();
    final VehicleRoutingProfile profile;
    final String snapshot;
    final long created = System.nanoTime();
    Review(VehicleRoutingProfile value) { profile = value; snapshot = value.toString(); }
  }
  private final Map<String, Review> reviews = new HashMap<>();
  static boolean isFleetTruck(VehicleRoutingProfile p) {
    return p != null && p.getVehicleType() == VehicleType.TRUCK_HEAVY_DUTY
        && p.getVehicleRoutingProfileSource() == VehicleRoutingProfileSource.FLEET_PORTAL;
  }
  List<Review> read() {
    reviews.clear();
    List<Review> result = new ArrayList<>();
    List<VehicleRoutingProfile> profiles = RouteMgr.getVehicleRoutingProfiles();
    if (profiles == null) throw new IllegalStateException("FLEET_READ_UNAVAILABLE");
    for (VehicleRoutingProfile profile : profiles) {
      if (!isFleetTruck(profile)) continue;
      Review review = new Review(profile);
      reviews.put(review.ticket, review);
      result.add(review);
    }
    return result;
  }
  VehicleRoutingProfile select(String ticket) throws Exception {
    Review review = reviews.remove(ticket);
    if (review == null || System.nanoTime() - review.created > 120000000000L)
      throw new IllegalStateException("FLEET_REVIEW_EXPIRED");
    if (RouteMgr.hasDestination() || !RouteMgr.getStopList().isEmpty())
      throw new IllegalStateException("FLEET_TRIP_ACTIVE");
    VehicleRoutingProfile fresh = RouteMgr.getVehicleRoutingProfile(review.profile.getName());
    if (!isFleetTruck(fresh) || !review.snapshot.equals(fresh.toString())
        || !review.profile.equals_RoutingFieldsOnly(fresh))
      throw new IllegalStateException("FLEET_PROFILE_CHANGED");
    // Pass the native profile itself; never reconstruct its fields through RN JSON.
    RouteMgr.setActiveVehicleRoutingProfile(fresh);
    VehicleRoutingProfile active = RouteMgr.getActiveVehicleRoutingProfile();
    if (!isFleetTruck(active) || !fresh.getName().equals(active.getName())
        || !fresh.equals_RoutingFieldsOnly(active))
      throw new IllegalStateException("FLEET_SELECTION_UNCONFIRMED");
    reviews.clear();
    return active;
  }
}
