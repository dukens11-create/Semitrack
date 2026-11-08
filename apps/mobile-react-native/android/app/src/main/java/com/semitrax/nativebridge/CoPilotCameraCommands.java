package com.semitrax.nativebridge;
import com.alk.cpik.ui.MapDrawer;

/** Uses the documented 2D orientation and chevron-lock contracts. */
final class CoPilotCameraCommands {
  static void northUp(MapDrawer drawer) throws Exception {
    drawer.setMapView(MapDrawer.MapViewType.TWO_DIMENSIONAL_NO_WIDGETS);
    drawer.setMapOrientation(MapDrawer.MapOrientation.NORTH_UP);
  }
  static void recenter(MapDrawer drawer) throws Exception {
    if (!drawer.lockToChevron())
      throw new IllegalStateException("COPILOT_CHEVRON_UNAVAILABLE");
  }
}
