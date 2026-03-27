const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const weatherService = require('../services/weatherService');

/**
 * GET /api/weather/current
 * Get current weather at a location.
 * Query params: lat, lon
 */
router.get('/current', authMiddleware, async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat and lon are required' });
    const weather = await weatherService.getCurrentWeather({ lat: parseFloat(lat), lon: parseFloat(lon) });
    res.json(weather);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/weather/alerts
 * Get driving condition alerts for a list of route coordinates.
 * Body: { coordinates: [[lon, lat], ...] }
 */
router.post('/alerts', authMiddleware, async (req, res) => {
  try {
    const { coordinates } = req.body;
    if (!Array.isArray(coordinates) || coordinates.length === 0) {
      return res.status(400).json({ error: 'coordinates array is required' });
    }
    const alerts = await weatherService.getDrivingConditionAlerts({ coordinates });
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
