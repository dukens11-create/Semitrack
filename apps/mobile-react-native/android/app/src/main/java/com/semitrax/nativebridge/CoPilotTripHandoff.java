package com.semitrax.nativebridge;

import com.alk.cpik.Coordinate;
import com.alk.cpik.GeocodeSearchType;
import com.alk.cpik.Stop;
import com.alk.cpik.StopBuilder;
import com.alk.cpik.StopList;
import com.alk.cpik.route.RouteEnums;
import com.alk.cpik.route.RouteListener;
import com.alk.cpik.route.RouteMgr;
import com.alk.cpik.route.VehicleRoutingProfile;
import java.util.UUID;

/** Transfers stops to the SDK UI. Acceptance is deliberately not navigation-start confirmation. */
final class CoPilotTripHandoff {
  private VehicleRoutingProfile profile;
  private String ticket;
  private volatile String destinationId;
  private volatile boolean awaitingStops;
  private boolean registered;
  private volatile boolean calculating, calculated, failed;
  private final RouteListener listener = new RouteListener() {
    @Override public void onStartRouteCalculation() { if (destinationId != null) { calculating = true; calculated = false; } }
    @Override public void onCompleteRouteCalculation() {
      try {
        if (calculating && ownsDestination()) { calculated = true; calculating = false; }
      } catch (Exception ignored) { failed = true; }
    }
    @Override public void onStopsAdded(StopList stops) {
      // Ignore callbacks from other trips, including late callbacks from an earlier handoff.
      for (Stop stop : stops) {
        if (destinationId != null && destinationId.equals(stop.getID())) awaitingStops = false;
      }
    }
    @Override public void onStopsDeleted(StopList stops) {
      for (Stop stop : stops) {
        if (destinationId != null && destinationId.equals(stop.getID())) awaitingStops = false;
      }
    }
    @Override public void onFailedRouteCalculation(int leg, Stop stop) {
      if (stop != null && destinationId != null && destinationId.equals(stop.getID())) { awaitingStops = false; failed = true; }
    }
  };

  VehicleRoutingProfile review() throws Exception {
    if (awaitingStops || RouteMgr.hasDestination())
      throw new IllegalStateException("Finish or cancel the current engine trip first.");
    VehicleRoutingProfile selected = RouteMgr.getActiveVehicleRoutingProfile();
    if (selected == null || selected.getVehicleType() != RouteEnums.VehicleType.TRUCK_HEAVY_DUTY)
      throw new IllegalStateException("Select a Heavy-Duty Truck profile in engine settings.");
    profile = selected;
    ticket = UUID.randomUUID().toString();
    return selected;
  }
  String ticket() { return ticket; }
  void validate(String expected) throws Exception {
    VehicleRoutingProfile selected = RouteMgr.getActiveVehicleRoutingProfile();
    if (profile == null || ticket == null || !ticket.equals(expected) || selected == null ||
        selected.getVehicleType() != RouteEnums.VehicleType.TRUCK_HEAVY_DUTY ||
        !profile.getName().equals(selected.getName()) || !profile.equals_RoutingFieldsOnly(selected))
      throw new IllegalStateException("The engine truck profile changed. Review it again.");
    if (awaitingStops || RouteMgr.hasDestination() || !RouteMgr.isCopilotReadyToAddStops())
      throw new IllegalStateException("Finish the existing engine trip or engine setup first.");
  }
  StopList geocode(String expected, double[][] points, String[] names) throws Exception {
    if (points.length < 2 || points.length > 27 || points.length != names.length)
      throw new IllegalArgumentException("Invalid trip stop count.");
    StopList result = new StopList();
    for (int i = 0; i < points.length; i++) {
      double lat = points[i][0], lng = points[i][1];
      if (!Double.isFinite(lat) || !Double.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
        throw new IllegalArgumentException("Invalid stop coordinates.");
      StopList matches = StopBuilder.fromLatLon(new Coordinate(lat, lng))
          .setName(names[i]).setID(expected + ":" + i).geocode(GeocodeSearchType.BEST_MATCH);
      if (matches == null || matches.isEmpty() || matches.get(0).isVehicleRestricted())
        throw new IllegalStateException("A trip stop cannot be reached with the selected truck profile.");
      if (!(expected + ":" + i).equals(matches.get(0).getID()))
        throw new IllegalStateException("The engine could not preserve trip stop identity.");
      result.add(matches.get(0));
    }
    return result;
  }
  void submit(String expected, StopList stops) throws Exception {
    validate(expected);
    if (!registered) { RouteListener.registerListener(listener); registered = true; }
    destinationId = stops.get(stops.size() - 1).getID();
    awaitingStops = true;
    calculated = false; calculating = false; failed = false;
    // The first point is the explicit GPS origin, so the SDK cannot consume the first via stop as origin.
    // SemiTraX owns the driving UI; SDK owns calculation and guidance.
    RouteMgr.addStops(RouteEnums.AddStopPurpose.NEW_TRIP, stops, RouteEnums.RoutePreviewMode.NO_PREVIEW);
    ticket = null;
  }
  boolean ownsDestination() throws Exception {
    if (destinationId == null) return false;
    com.alk.cpik.StopList stops = RouteMgr.getStopList();
    return stops != null && !stops.isEmpty() && destinationId.equals(stops.get(stops.size()-1).getID());
  }
  boolean confirmed() throws Exception { return calculated && !failed && !awaitingStops && ownsDestination(); }
  boolean failed() { return failed; }
  boolean pendingStops() { return awaitingStops; }
  void invalidateReview() { ticket = null; profile = null; }
  void stopped() { destinationId = null; awaitingStops = false; calculating = false; calculated = false; failed = false; invalidateReview(); }
  boolean canReturnToPlanner() throws Exception {
    return !awaitingStops && !RouteMgr.hasDestination();
  }
  void close() {
    if (registered) RouteListener.unregisterListener(listener);
    registered = false;
    profile = null; ticket = null;
  }
}
