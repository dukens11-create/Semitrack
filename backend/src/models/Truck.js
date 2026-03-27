const mongoose = require('mongoose');

const truckSchema = new mongoose.Schema(
  {
    truckId: { type: String, required: true, unique: true },
    licensePlate: { type: String, required: true, unique: true },
    make: { type: String, required: true },
    model: { type: String, required: true },
    year: { type: Number, required: true },
    vin: { type: String, required: true, unique: true },
    type: {
      type: String,
      enum: ['semi', 'box', 'flatbed', 'tanker', 'refrigerated', 'other'],
      default: 'semi',
    },
    status: {
      type: String,
      enum: ['active', 'idle', 'maintenance', 'offline'],
      default: 'idle',
    },
    currentLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: { type: [Number], default: [0, 0] }, // [longitude, latitude]
    },
    assignedDriver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    maxPayloadKg: { type: Number, default: 0 },
    fuelType: { type: String, enum: ['diesel', 'gasoline', 'electric', 'hybrid'], default: 'diesel' },
    fuelCapacityL: { type: Number, default: 0 },
    currentFuelL: { type: Number, default: 0 },
    odometer: { type: Number, default: 0 }, // km
    lastServiceDate: { type: Date },
    nextServiceDueKm: { type: Number },
    notes: { type: String },
  },
  { timestamps: true }
);

truckSchema.index({ currentLocation: '2dsphere' });

module.exports = mongoose.model('Truck', truckSchema);
