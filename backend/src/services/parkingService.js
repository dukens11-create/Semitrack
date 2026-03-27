/**
 * Parking Service
 * Handles truck parking spot availability and reservations.
 */
const Parking = require('../models/Parking');

/**
 * Find available parking near a coordinate.
 */
const findAvailableParking = async ({ coordinates, radiusKm = 30, limit = 10 }) => {
  return Parking.find({
    isActive: true,
    availableSpots: { $gt: 0 },
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates },
        $maxDistance: radiusKm * 1000,
      },
    },
  }).limit(limit);
};

/**
 * Reserve a parking spot.
 */
const reserveSpot = async ({ parkingId, truckId, driverId, startTime, endTime }) => {
  const parking = await Parking.findById(parkingId);
  if (!parking) throw new Error('Parking facility not found');
  if (parking.availableSpots <= 0) throw new Error('No spots available');

  const reservation = {
    truck: truckId,
    driver: driverId,
    startTime: new Date(startTime),
    endTime: new Date(endTime),
    spotNumber: `S-${parking.reservations.length + 1}`,
    status: 'reserved',
  };

  parking.reservations.push(reservation);
  parking.availableSpots -= 1;
  await parking.save();

  return parking.reservations[parking.reservations.length - 1];
};

/**
 * Cancel a parking reservation.
 */
const cancelReservation = async ({ parkingId, reservationId }) => {
  const parking = await Parking.findById(parkingId);
  if (!parking) throw new Error('Parking facility not found');

  const reservation = parking.reservations.id(reservationId);
  if (!reservation) throw new Error('Reservation not found');

  reservation.status = 'cancelled';
  parking.availableSpots += 1;
  await parking.save();
  return reservation;
};

/**
 * Get details for a parking facility.
 */
const getParkingById = async (id) => {
  const parking = await Parking.findById(id).populate('reservations.truck', 'truckId licensePlate');
  if (!parking) throw new Error('Parking facility not found');
  return parking;
};

module.exports = { findAvailableParking, reserveSpot, cancelReservation, getParkingById };
