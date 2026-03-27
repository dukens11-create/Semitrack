const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const fuelService = require('../services/fuelService');

/**
 * GET /api/fuel/stations
 * Find nearby fuel stations.
 * Query params: lat, lon, radiusKm, limit
 */
router.get('/stations', authMiddleware, async (req, res) => {
  try {
    const { lat, lon, radiusKm = 50, limit = 10 } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat and lon are required' });

    const stations = await fuelService.findFuelStations({
      coordinates: [parseFloat(lon), parseFloat(lat)],
      radiusKm: parseFloat(radiusKm),
      limit: parseInt(limit, 10),
    });
    res.json(stations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/fuel/fillup
 * Log a fuel fill-up.
 */
router.post('/fillup', authMiddleware, async (req, res) => {
  try {
    const { truckId, litres, pricePerLitre, odometer, stationName } = req.body;
    if (!truckId || !litres || !pricePerLitre) {
      return res.status(400).json({ error: 'truckId, litres, and pricePerLitre are required' });
    }
    const record = await fuelService.logFuelFillUp({ truckId, litres, pricePerLitre, odometer, stationName });
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/fuel/range/:truckId
 * Get estimated fuel range for a truck.
 */
router.get('/range/:truckId', authMiddleware, async (req, res) => {
  try {
    const { avgConsumptionLPer100km } = req.query;
    const range = await fuelService.estimateRange({
      truckId: req.params.truckId,
      ...(avgConsumptionLPer100km && { avgConsumptionLPer100km: parseFloat(avgConsumptionLPer100km) }),
    });
    res.json(range);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
