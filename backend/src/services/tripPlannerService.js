/**
 * Trip Planner Service
 * Handles trip creation, optimization, and scheduling.
 */
const Trip = require('../models/Trip');
const Truck = require('../models/Truck');
const navigationService = require('./navigationService');

/**
 * Create and persist a new planned trip.
 */
const planTrip = async ({ truckId, driverId, origin, destination, cargoWeightKg, cargoDescription }) => {
  const truck = await Truck.findById(truckId);
  if (!truck) throw new Error('Truck not found');

  const route = await navigationService.calculateRoute({
    originCoords: origin.coordinates,
    destinationCoords: destination.coordinates,
    truckProfile: { maxWeightKg: truck.maxPayloadKg },
  });

  const trip = await Trip.create({
    truck: truckId,
    driver: driverId,
    origin,
    destination,
    distanceKm: route.distanceKm,
    estimatedDuration: route.durationMin,
    cargoWeightKg,
    cargoDescription,
    status: 'planned',
  });

  return { trip, route };
};

/**
 * Start an existing planned trip.
 */
const startTrip = async (tripId) => {
  const trip = await Trip.findByIdAndUpdate(
    tripId,
    { status: 'in_progress', startedAt: new Date() },
    { new: true }
  );
  if (!trip) throw new Error('Trip not found');

  await Truck.findByIdAndUpdate(trip.truck, { status: 'active' });
  return trip;
};

/**
 * Complete a trip and update truck status.
 */
const completeTrip = async (tripId, { fuelUsedL, actualDuration } = {}) => {
  const trip = await Trip.findByIdAndUpdate(
    tripId,
    {
      status: 'completed',
      completedAt: new Date(),
      ...(fuelUsedL !== undefined && { fuelUsedL }),
      ...(actualDuration !== undefined && { actualDuration }),
    },
    { new: true }
  );
  if (!trip) throw new Error('Trip not found');

  await Truck.findByIdAndUpdate(trip.truck, { status: 'idle' });
  return trip;
};

/**
 * Get trip history for a truck.
 */
const getTripHistory = async (truckId, { limit = 20, skip = 0 } = {}) => {
  return Trip.find({ truck: truckId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('driver', 'name email');
};

module.exports = { planTrip, startTrip, completeTrip, getTripHistory };
