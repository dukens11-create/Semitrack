const mongoose = require('mongoose');

const poiSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    category: {
      type: String,
      enum: ['rest_area', 'fuel_station', 'truck_stop', 'weigh_station', 'repair_shop', 'parking', 'food', 'other'],
      required: true,
    },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: [Number], // [lon, lat]
    },
    address: { type: String },
    phone: { type: String },
    website: { type: String },
    operatingHours: { type: String },
    amenities: [{ type: String }],
    truckAccessible: { type: Boolean, default: true },
    rating: { type: Number, min: 0, max: 5, default: 0 },
    reviewCount: { type: Number, default: 0 },
    notes: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

poiSchema.index({ location: '2dsphere' });
poiSchema.index({ category: 1 });

module.exports = mongoose.model('POI', poiSchema);
