const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const parkingService = require('../services/parkingService');

/**
 * GET /api/parking/nearby
 * Find available parking near a coordinate.
 * Query params: lat, lon, radiusKm, limit
 */
router.get('/nearby', authMiddleware, async (req, res) => {
  try {
    const { lat, lon, radiusKm = 30, limit = 10 } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat and lon are required' });

    const spots = await parkingService.findAvailableParking({
      coordinates: [parseFloat(lon), parseFloat(lat)],
      radiusKm: parseFloat(radiusKm),
      limit: parseInt(limit, 10),
    });
    res.json(spots);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/parking/:id
 * Get parking facility details.
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const parking = await parkingService.getParkingById(req.params.id);
    res.json(parking);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

/**
 * POST /api/parking/:id/reserve
 * Reserve a spot at a parking facility.
 */
router.post('/:id/reserve', authMiddleware, async (req, res) => {
  try {
    const { truckId, startTime, endTime } = req.body;
    if (!truckId || !startTime || !endTime) {
      return res.status(400).json({ error: 'truckId, startTime, and endTime are required' });
    }
    const reservation = await parkingService.reserveSpot({
      parkingId: req.params.id,
      truckId,
      driverId: req.user._id,
      startTime,
      endTime,
    });
    res.status(201).json(reservation);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /api/parking/:id/reserve/:reservationId
 * Cancel a parking reservation.
 */
router.delete('/:id/reserve/:reservationId', authMiddleware, async (req, res) => {
  try {
    const reservation = await parkingService.cancelReservation({
      parkingId: req.params.id,
      reservationId: req.params.reservationId,
    });
    res.json(reservation);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
