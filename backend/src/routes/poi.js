const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth');
const poiService = require('../services/poiService');

/**
 * GET /api/poi/nearby
 * Find POIs near a location.
 * Query params: lat, lon, radiusKm, category, limit
 */
router.get('/nearby', authMiddleware, async (req, res) => {
  try {
    const { lat, lon, radiusKm = 50, category, limit = 20 } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat and lon are required' });

    const pois = await poiService.findNearby({
      coordinates: [parseFloat(lon), parseFloat(lat)],
      radiusKm: parseFloat(radiusKm),
      category,
      limit: parseInt(limit, 10),
    });
    res.json(pois);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/poi/:id
 * Get a single POI by ID.
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const poi = await poiService.getPOIById(req.params.id);
    res.json(poi);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

/**
 * POST /api/poi
 * Create a new POI (manager/admin only).
 */
router.post('/', authMiddleware, requireRole('manager', 'admin'), async (req, res) => {
  try {
    const poi = await poiService.createPOI(req.body);
    res.status(201).json(poi);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * PUT /api/poi/:id
 * Update a POI (manager/admin only).
 */
router.put('/:id', authMiddleware, requireRole('manager', 'admin'), async (req, res) => {
  try {
    const poi = await poiService.updatePOI(req.params.id, req.body);
    res.json(poi);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /api/poi/:id
 * Soft-delete a POI (admin only).
 */
router.delete('/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    await poiService.deletePOI(req.params.id);
    res.json({ message: 'POI deactivated' });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

module.exports = router;
