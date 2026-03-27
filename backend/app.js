const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./src/routes/auth');
const navigationRoutes = require('./src/routes/navigation');
const tripRoutes = require('./src/routes/trip');
const poiRoutes = require('./src/routes/poi');
const parkingRoutes = require('./src/routes/parking');
const fuelRoutes = require('./src/routes/fuel');
const weatherRoutes = require('./src/routes/weather');
const fleetRoutes = require('./src/routes/fleet');

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// General API rate limiter: 200 requests per 15 minutes per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Strict limiter for auth endpoints: 20 requests per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later.' },
});

// Health check (no rate limit needed)
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'Semitrack API' }));

// API routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/navigation', apiLimiter, navigationRoutes);
app.use('/api/trips', apiLimiter, tripRoutes);
app.use('/api/poi', apiLimiter, poiRoutes);
app.use('/api/parking', apiLimiter, parkingRoutes);
app.use('/api/fuel', apiLimiter, fuelRoutes);
app.use('/api/weather', apiLimiter, weatherRoutes);
app.use('/api/fleet', apiLimiter, fleetRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
