/**
 * Navigation Service
 * Handles route calculation, turn-by-turn directions, and real-time navigation updates.
 */

/**
 * Calculate a route between two coordinates.
 * In production, this would call a mapping API (e.g., Google Maps, HERE, TomTom).
 */
const calculateRoute = async ({ originCoords, destinationCoords, truckProfile = {} }) => {
  const { maxHeightM = 4.1, maxWeightKg = 36000, avoidTolls = false } = truckProfile;

  // Placeholder: return a mock route object
  const distanceKm = _haversineKm(originCoords, destinationCoords);
  const durationMin = Math.round((distanceKm / 80) * 60); // assume 80 km/h avg speed

  return {
    distanceKm: parseFloat(distanceKm.toFixed(2)),
    durationMin,
    avoidTolls,
    truckRestrictions: { maxHeightM, maxWeightKg },
    waypoints: [
      { coordinates: originCoords, label: 'Origin' },
      { coordinates: destinationCoords, label: 'Destination' },
    ],
    polyline: [originCoords, destinationCoords], // simplified
    steps: [
      { instruction: `Head toward destination`, distanceKm, durationMin },
    ],
  };
};

/**
 * Get real-time traffic updates for a route.
 */
const getTrafficUpdates = async (routeId) => {
  // Mock traffic data
  return {
    routeId,
    updatedAt: new Date(),
    incidents: [],
    delayMin: 0,
    trafficLevel: 'moderate',
  };
};

/**
 * Haversine distance between two [lon, lat] coordinate pairs (km).
 */
const _haversineKm = ([lon1, lat1], [lon2, lat2]) => {
  const R = 6371;
  const dLat = _toRad(lat2 - lat1);
  const dLon = _toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(_toRad(lat1)) * Math.cos(_toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const _toRad = (deg) => (deg * Math.PI) / 180;

module.exports = { calculateRoute, getTrafficUpdates };
