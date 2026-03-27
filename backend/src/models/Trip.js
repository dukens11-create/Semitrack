const mongoose = require('mongoose');

const waypointSchema = new mongoose.Schema({
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: [Number], // [lon, lat]
  },
  address: { type: String },
  arrivedAt: { type: Date },
  departedAt: { type: Date },
  notes: { type: String },
});

const tripSchema = new mongoose.Schema(
  {
    truck: { type: mongoose.Schema.Types.ObjectId, ref: 'Truck', required: true },
    driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    origin: {
      address: { type: String, required: true },
      coordinates: [Number], // [lon, lat]
    },
    destination: {
      address: { type: String, required: true },
      coordinates: [Number],
    },
    waypoints: [waypointSchema],
    status: {
      type: String,
      enum: ['planned', 'in_progress', 'completed', 'cancelled'],
      default: 'planned',
    },
    startedAt: { type: Date },
    completedAt: { type: Date },
    estimatedDuration: { type: Number }, // minutes
    actualDuration: { type: Number }, // minutes
    distanceKm: { type: Number },
    fuelUsedL: { type: Number },
    cargoDescription: { type: String },
    cargoWeightKg: { type: Number },
    notes: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Trip', tripSchema);
