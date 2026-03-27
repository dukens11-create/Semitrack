const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const navigationService = require('../services/navigationService');

/**
 * POST /api/navigation/route
 * Calculate a route between two points with truck-specific constraints.
 */
router.post('/route', authMiddleware, async (req, res) => {
  try {
    const { originCoords, destinationCoords, truckProfile } = req.body;
    if (!originCoords || !destinationCoords) {
      return res.status(400).json({ error: 'originCoords and destinationCoords are required' });
    }
    const route = await navigationService.calculateRoute({ originCoords, destinationCoords, truckProfile });
    res.json(route);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/navigation/traffic/:routeId
 * Get real-time traffic updates for a route.
 */
router.get('/traffic/:routeId', authMiddleware, async (req, res) => {
  try {
    const updates = await navigationService.getTrafficUpdates(req.params.routeId);
    res.json(updates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
