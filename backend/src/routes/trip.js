const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const tripPlannerService = require('../services/tripPlannerService');
const Trip = require('../models/Trip');

/**
 * POST /api/trips
 * Plan a new trip.
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { truckId, origin, destination, cargoWeightKg, cargoDescription } = req.body;
    if (!truckId || !origin || !destination) {
      return res.status(400).json({ error: 'truckId, origin, and destination are required' });
    }
    const result = await tripPlannerService.planTrip({
      truckId,
      driverId: req.user._id,
      origin,
      destination,
      cargoWeightKg,
      cargoDescription,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/trips
 * List trips (filtered by driver or truck).
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const filter = {};
    if (req.query.truckId) filter.truck = req.query.truckId;
    if (req.query.status) filter.status = req.query.status;
    if (['driver'].includes(req.user.role)) filter.driver = req.user._id;

    const trips = await Trip.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('truck', 'truckId licensePlate')
      .populate('driver', 'name');

    res.json(trips);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/trips/:id
 * Get a specific trip.
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id)
      .populate('truck', 'truckId licensePlate make model')
      .populate('driver', 'name email phone');
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    res.json(trip);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/trips/:id/start
 * Start a planned trip.
 */
router.patch('/:id/start', authMiddleware, async (req, res) => {
  try {
    const trip = await tripPlannerService.startTrip(req.params.id);
    res.json(trip);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * PATCH /api/trips/:id/complete
 * Complete a trip.
 */
router.patch('/:id/complete', authMiddleware, async (req, res) => {
  try {
    const trip = await tripPlannerService.completeTrip(req.params.id, req.body);
    res.json(trip);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
