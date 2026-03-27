/**
 * POI Service
 * Manages Points of Interest for truck drivers.
 */
const POI = require('../models/POI');

/**
 * Find POIs near a coordinate within a radius.
 */
const findNearby = async ({ coordinates, radiusKm = 50, category, limit = 20 }) => {
  const query = {
    isActive: true,
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates },
        $maxDistance: radiusKm * 1000, // convert km to metres
      },
    },
  };

  if (category) query.category = category;

  return POI.find(query).limit(limit);
};

/**
 * Get a single POI by ID.
 */
const getPOIById = async (id) => {
  const poi = await POI.findById(id);
  if (!poi) throw new Error('POI not found');
  return poi;
};

/**
 * Create a new POI.
 */
const createPOI = async (data) => {
  return POI.create(data);
};

/**
 * Update a POI.
 */
const updatePOI = async (id, data) => {
  const poi = await POI.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (!poi) throw new Error('POI not found');
  return poi;
};

/**
 * Delete (deactivate) a POI.
 */
const deletePOI = async (id) => {
  const poi = await POI.findByIdAndUpdate(id, { isActive: false }, { new: true });
  if (!poi) throw new Error('POI not found');
  return poi;
};

module.exports = { findNearby, getPOIById, createPOI, updatePOI, deletePOI };
