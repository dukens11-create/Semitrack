package com.semitrax.nativebridge;

import com.alk.cpik.CopilotMgr;
import com.alk.cpik.Coordinate;
import com.alk.cpik.Stop;
import com.alk.cpik.guidance.GuidanceListener;
import com.alk.cpik.guidance.GuidanceMgr;
import com.alk.cpik.guidance.PositionInfo;
import com.alk.cpik.guidance.TurnInstruction;
import com.alk.cpik.guidance.UnitsOfMeasure;
import com.alk.cpik.route.RouteMgr;
import com.alk.cpik.route.RouteListener;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import android.os.Handler;
import java.util.Date;
import java.util.function.Consumer;
import java.util.function.BooleanSupplier;

/** Read-only SDK telemetry. A destination or a position callback is not start confirmation. */
final class CoPilotGuidanceTelemetry extends GuidanceListener {
  private final Handler main;
  private final Consumer<WritableMap> sink;
  private final BooleanSupplier available;
  private boolean registered;
  private volatile long generation;
  private long sequence;
  private PositionInfo position;
  private long positionReceivedAt;
  private Integer roadLimit, truckLimit;
  private boolean limitImperial;
  private boolean positionImperial;
  private long routeRevision;
  private String routeStatus = "unknown";
  private final RouteListener routes = new RouteListener() {
    @Override public void onStartRouteCalculation() {
      dispatch(() -> { routeRevision++; routeStatus = "calculating"; });
    }
    @Override public void onCompleteRouteCalculation() {
      dispatch(() -> routeStatus = "ready");
    }
    @Override public void onFailedRouteCalculation(int leg, Stop stop) {
      dispatch(() -> routeStatus = "failed");
    }
  };

  CoPilotGuidanceTelemetry(Handler main, BooleanSupplier available, Consumer<WritableMap> sink) {
    this.main = main; this.available = available; this.sink = sink;
  }
  void start() {
    if (!registered) {
      registered = true; generation++;
      GuidanceListener.registerListener(this);
      RouteListener.registerListener(routes);
    }
  }
  void stop() {
    if (registered) {
      GuidanceListener.unregisterListener(this);
      RouteListener.unregisterListener(routes);
    }
    registered = false; generation++;
    position = null; positionReceivedAt = 0; roadLimit = truckLimit = null;
    routeStatus = "unknown";
  }
  private void dispatch(Runnable action) {
    final long ticket = generation;
    main.post(() -> {
      if (!registered || ticket != generation || !available.getAsBoolean()) return;
      action.run(); sink.accept(snapshot());
    });
  }
  @Override public void onPositionUpdate(PositionInfo value) {
    boolean imperial;
    try { imperial = CopilotMgr.getUnitsOfMeasure() == UnitsOfMeasure.IMPERIAL; }
    catch (Exception e) { imperial = false; }
    final boolean units = imperial;
    dispatch(() -> { position = value; positionImperial = units; positionReceivedAt = System.currentTimeMillis(); });
  }
  @Override public void onSpeedLimitChanged(int road, int truck) {
    // Capture units with the callback; never reinterpret cached limits after a settings change.
    boolean imperial;
    try { imperial = CopilotMgr.getUnitsOfMeasure() == UnitsOfMeasure.IMPERIAL; }
    catch (Exception e) { imperial = false; }
    final boolean units = imperial;
    dispatch(() -> { roadLimit = road; truckLimit = truck; limitImperial = units; });
  }
  @Override public void onETAChanged(Date eta) { dispatch(() -> {}); }
  @Override public void onDistanceToDestinationUpdated(double distance) { dispatch(() -> {}); }
  @Override public void onEstimatedTravelTimeUpdated(int hours, int minutes) { dispatch(() -> {}); }
  @Override public void onTurnInstructionEvent(TurnInstruction instruction) { dispatch(() -> {}); }
  @Override public void onItineraryUpdated() { dispatch(() -> {}); }
  @Override public void onArrivedAtStop(boolean last, Stop stop) {
    dispatch(() -> { if (last) routeStatus = "arrived"; });
  }

  WritableMap snapshot() {
    WritableMap out = Arguments.createMap();
    long now = System.currentTimeMillis();
    out.putDouble("sequence", ++sequence);
    out.putDouble("routeRevision", routeRevision);
    out.putDouble("observedAt", now);
    out.putBoolean("available", available.getAsBoolean());
    if (!available.getAsBoolean()) return out;
    try {
      if (position != null) {
        Coordinate coordinate = position.getPosition();
        String quality = position.getGPSFixQuality().name();
        Date timestamp = position.getTimestamp();
        long fixTime = timestamp == null ? 0 : timestamp.getTime();
        boolean fresh = now - positionReceivedAt <= 15000 && fixTime > 0 &&
            now - fixTime >= -5000 && now - fixTime <= 15000 &&
            ("FIX_2D".equals(quality) || "FIX_3D".equals(quality)) &&
            coordinate != null && coordinate.isValid();
        out.putBoolean("gpsFresh", fresh);
        out.putDouble("fixAt", fixTime);
        if (fresh && coordinate != null && coordinate.isValid()) {
          out.putDouble("latitude", coordinate.getLatitude());
          out.putDouble("longitude", coordinate.getLongitude());
          double speed = position.getSpeed(), heading = position.getHeading();
          if (positionImperial && Double.isFinite(speed) && speed >= 0) out.putDouble("speedMph", speed);
          if (Double.isFinite(heading) && heading >= 0 && heading < 360) out.putDouble("heading", heading);
          if (limitImperial && CopilotMgr.getUnitsOfMeasure() == UnitsOfMeasure.IMPERIAL) {
            if (roadLimit != null && roadLimit > 0 && roadLimit != GuidanceListener.SPEED_LIMIT_NO_DATA && roadLimit != GuidanceListener.UNLIMITED_SPEED)
              out.putInt("roadSpeedLimitMph", roadLimit);
            if (truckLimit != null && truckLimit > 0 && truckLimit != GuidanceListener.SPEED_LIMIT_NO_DATA && truckLimit != GuidanceListener.UNLIMITED_SPEED)
              out.putInt("truckSpeedLimitMph", truckLimit);
          }
        }
      }
    } catch (Exception ignored) { out.putBoolean("gpsFresh", false); }
    try {
      boolean destination = RouteMgr.hasDestination();
      out.putBoolean("hasDestination", destination);
      if (!destination && !"calculating".equals(routeStatus) && !"failed".equals(routeStatus) && !"arrived".equals(routeStatus)) routeStatus = "none";
      out.putString("routeStatus", routeStatus);
      // Never present the previous route's ETA during a new calculation or failure.
      if (destination && "ready".equals(routeStatus)) {
        Date eta = GuidanceMgr.getETA();
        if (eta != null && eta.getTime() >= now) out.putDouble("etaAt", eta.getTime());
        // Imperial distance is documented as miles. Metric contracts differ across SDK versions.
        if (CopilotMgr.getUnitsOfMeasure() == UnitsOfMeasure.IMPERIAL) {
          double miles = GuidanceMgr.getDistanceToDestination();
          if (Double.isFinite(miles) && miles >= 0) out.putDouble("remainingMeters", miles * 1609.344);
        }
        TurnInstruction instruction = GuidanceMgr.getTurnInstruction();
        if (instruction != null) {
          out.putString("instruction", instruction.getGuidanceInstruction());
          out.putString("nextRoad", instruction.getStreetNameForNextTurn());
          out.putString("turnDistance", instruction.getDistanceToNextTurn());
        }
      }
    } catch (Exception ignored) { /* No fabricated route data while calculation is pending. */ }
    return out;
  }
}
