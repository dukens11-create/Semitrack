/**
 * Fuel Service
 * Tracks fuel usage, finds fuel stations, and calculates fuel efficiency.
 */
const POI = require('../models/POI');
const Truck = require('../models/Truck');

/**
 * Find nearby fuel stations (diesel-first).
 */
const findFuelStations = async ({ coordinates, radiusKm = 50, limit = 10 }) => {
  return POI.find({
    isActive: true,
    category: 'fuel_station',
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates },
        $maxDistance: radiusKm * 1000,
      },
    },
  }).limit(limit);
};

/**
 * Log a fuel fill-up event for a truck.
 */
const logFuelFillUp = async ({ truckId, litres, pricePerLitre, odometer, stationName }) => {
  const truck = await Truck.findById(truckId);
  if (!truck) throw new Error('Truck not found');

  const totalCost = parseFloat((litres * pricePerLitre).toFixed(2));
  truck.currentFuelL = Math.min(truck.fuelCapacityL, truck.currentFuelL + litres);
  truck.odometer = odometer || truck.odometer;
  await truck.save();

  return {
    truckId,
    litres,
    pricePerLitre,
    totalCost,
    odometer: truck.odometer,
    stationName,
    filledAt: new Date(),
  };
};

/**
 * Estimate remaining range for a truck based on current fuel and average consumption.
 * @param {number} avgConsumptionLPer100km - Average litres per 100 km.
 */
const estimateRange = async ({ truckId, avgConsumptionLPer100km = 35 }) => {
  const truck = await Truck.findById(truckId);
  if (!truck) throw new Error('Truck not found');

  const rangeKm = parseFloat(((truck.currentFuelL / avgConsumptionLPer100km) * 100).toFixed(1));
  return {
    truckId,
    currentFuelL: truck.currentFuelL,
    fuelCapacityL: truck.fuelCapacityL,
    fuelPercent: parseFloat(((truck.currentFuelL / truck.fuelCapacityL) * 100).toFixed(1)),
    avgConsumptionLPer100km,
    estimatedRangeKm: rangeKm,
  };
};

module.exports = { findFuelStations, logFuelFillUp, estimateRange };
