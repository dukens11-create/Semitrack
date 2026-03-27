const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth');
const fleetService = require('../services/fleetService');
const analyticsService = require('../services/analyticsService');
const Truck = require('../models/Truck');

/**
 * GET /api/fleet
 * Fleet overview with statuses and summary.
 */
router.get('/', authMiddleware, requireRole('dispatcher', 'manager', 'admin'), async (req, res) => {
  try {
    const overview = await fleetService.getFleetOverview();
    res.json(overview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/fleet/trucks
 * Add a new truck to the fleet (manager/admin only).
 */
router.post('/trucks', authMiddleware, requireRole('manager', 'admin'), async (req, res) => {
  try {
    const truck = await Truck.create(req.body);
    res.status(201).json(truck);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/fleet/trucks/:id
 * Get truck details.
 */
router.get('/trucks/:id', authMiddleware, async (req, res) => {
  try {
    const truck = await Truck.findById(req.params.id).populate('assignedDriver', 'name email phone');
    if (!truck) return res.status(404).json({ error: 'Truck not found' });
    res.json(truck);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/fleet/trucks/:id/status
 * Update truck status.
 */
router.patch('/trucks/:id/status', authMiddleware, requireRole('dispatcher', 'manager', 'admin'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });
    const truck = await fleetService.updateTruckStatus(req.params.id, status);
    res.json(truck);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/fleet/trucks/:id/assign
 * Assign a driver to a truck.
 */
router.post('/trucks/:id/assign', authMiddleware, requireRole('dispatcher', 'manager', 'admin'), async (req, res) => {
  try {
    const { driverId } = req.body;
    if (!driverId) return res.status(400).json({ error: 'driverId is required' });
    const result = await fleetService.assignDriver({ truckId: req.params.id, driverId });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/fleet/maintenance
 * Trucks due for service.
 */
router.get('/maintenance', authMiddleware, requireRole('dispatcher', 'manager', 'admin'), async (req, res) => {
  try {
    const trucks = await fleetService.getTrucksNeedingService();
    res.json(trucks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/fleet/analytics
 * Fleet analytics and trip statistics.
 */
router.get('/analytics', authMiddleware, requireRole('manager', 'admin'), async (req, res) => {
  try {
    const { startDate, endDate, days } = req.query;
    const [tripStats, dailyCounts] = await Promise.all([
      analyticsService.getTripStats({ startDate, endDate }),
      analyticsService.getDailyTripCounts({ days: days ? parseInt(days, 10) : 30 }),
    ]);
    res.json({ tripStats, dailyCounts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
