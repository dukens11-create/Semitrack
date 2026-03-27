/**
 * Fleet Service
 * Manages the fleet of trucks, their statuses, and assignments.
 */
const Truck = require('../models/Truck');
const User = require('../models/User');

/**
 * Get fleet overview with truck statuses.
 */
const getFleetOverview = async () => {
  const trucks = await Truck.find().populate('assignedDriver', 'name email phone');
  const summary = {
    total: trucks.length,
    active: 0,
    idle: 0,
    maintenance: 0,
    offline: 0,
  };

  trucks.forEach((t) => {
    if (summary[t.status] !== undefined) summary[t.status]++;
  });

  return { summary, trucks };
};

/**
 * Assign a driver to a truck.
 */
const assignDriver = async ({ truckId, driverId }) => {
  const [truck, driver] = await Promise.all([
    Truck.findById(truckId),
    User.findById(driverId),
  ]);

  if (!truck) throw new Error('Truck not found');
  if (!driver) throw new Error('Driver not found');
  if (driver.role !== 'driver') throw new Error('User is not a driver');

  // Remove driver from any previously assigned truck
  await Truck.updateMany({ assignedDriver: driverId }, { $unset: { assignedDriver: '' } });

  truck.assignedDriver = driverId;
  driver.assignedTruck = truckId;
  await Promise.all([truck.save(), driver.save()]);

  return { truck, driver };
};

/**
 * Update truck status.
 */
const updateTruckStatus = async (truckId, status) => {
  const truck = await Truck.findByIdAndUpdate(truckId, { status }, { new: true, runValidators: true });
  if (!truck) throw new Error('Truck not found');
  return truck;
};

/**
 * Get trucks that need service soon (within 5000 km).
 */
const getTrucksNeedingService = async () => {
  return Truck.find({
    $expr: {
      $lte: [{ $subtract: ['$nextServiceDueKm', '$odometer'] }, 5000],
    },
  }).populate('assignedDriver', 'name phone');
};

module.exports = { getFleetOverview, assignDriver, updateTruckStatus, getTrucksNeedingService };
