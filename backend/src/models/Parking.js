const mongoose = require('mongoose');

const parkingSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: [Number], // [lon, lat]
    },
    address: { type: String, required: true },
    totalSpots: { type: Number, required: true },
    availableSpots: { type: Number, required: true },
    spotTypes: {
      standard: { type: Number, default: 0 },
      oversized: { type: Number, default: 0 },
      handicapped: { type: Number, default: 0 },
    },
    pricePerHour: { type: Number, default: 0 },
    pricePerDay: { type: Number, default: 0 },
    amenities: [{ type: String }], // e.g., ['shower', 'wifi', 'security', 'restaurant']
    operatingHours: { type: String, default: '24/7' },
    contactPhone: { type: String },
    isActive: { type: Boolean, default: true },
    reservations: [
      {
        truck: { type: mongoose.Schema.Types.ObjectId, ref: 'Truck' },
        driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        startTime: { type: Date },
        endTime: { type: Date },
        spotNumber: { type: String },
        status: { type: String, enum: ['reserved', 'active', 'completed', 'cancelled'], default: 'reserved' },
      },
    ],
  },
  { timestamps: true }
);

parkingSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Parking', parkingSchema);
