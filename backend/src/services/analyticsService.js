/**
 * Analytics Service
 * Provides fleet performance metrics and reporting.
 */
const Trip = require('../models/Trip');
const Truck = require('../models/Truck');

/**
 * Get aggregate trip statistics for a given date range.
 */
const getTripStats = async ({ startDate, endDate } = {}) => {
  const match = { status: 'completed' };
  if (startDate || endDate) {
    match.completedAt = {};
    if (startDate) match.completedAt.$gte = new Date(startDate);
    if (endDate) match.completedAt.$lte = new Date(endDate);
  }

  const [result] = await Trip.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalTrips: { $sum: 1 },
        totalDistanceKm: { $sum: '$distanceKm' },
        totalFuelL: { $sum: '$fuelUsedL' },
        avgDurationMin: { $avg: '$actualDuration' },
        avgDistanceKm: { $avg: '$distanceKm' },
      },
    },
  ]);

  return result || { totalTrips: 0, totalDistanceKm: 0, totalFuelL: 0, avgDurationMin: 0, avgDistanceKm: 0 };
};

/**
 * Get per-truck performance metrics.
 */
const getTruckPerformance = async (truckId) => {
  const [stats] = await Trip.aggregate([
    { $match: { truck: truckId, status: 'completed' } },
    {
      $group: {
        _id: '$truck',
        totalTrips: { $sum: 1 },
        totalDistanceKm: { $sum: '$distanceKm' },
        totalFuelL: { $sum: '$fuelUsedL' },
        avgFuelEfficiency: {
          $avg: {
            $cond: [
              { $and: [{ $gt: ['$distanceKm', 0] }, { $gt: ['$fuelUsedL', 0] }] },
              { $divide: [{ $multiply: ['$fuelUsedL', 100] }, '$distanceKm'] },
              null,
            ],
          },
        },
      },
    },
  ]);

  return stats || { totalTrips: 0, totalDistanceKm: 0, totalFuelL: 0, avgFuelEfficiency: null };
};

/**
 * Get daily trip counts for charting.
 */
const getDailyTripCounts = async ({ days = 30 } = {}) => {
  const since = new Date();
  since.setDate(since.getDate() - days);

  return Trip.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
};

module.exports = { getTripStats, getTruckPerformance, getDailyTripCounts };
