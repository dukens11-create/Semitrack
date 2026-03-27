/**
 * Weather Service
 * Retrieves weather data and driving condition alerts for routes.
 * Integrates with OpenWeatherMap API in production.
 */
const https = require('https');

const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const BASE_URL = 'api.openweathermap.org';

/**
 * Fetch current weather for a coordinate.
 */
const getCurrentWeather = async ({ lat, lon }) => {
  if (!WEATHER_API_KEY) {
    // Return mock data when API key is not configured
    return _mockWeather(lat, lon);
  }

  return new Promise((resolve, reject) => {
    const path = `/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${WEATHER_API_KEY}&units=metric`;
    https.get({ hostname: BASE_URL, path }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Failed to parse weather response'));
        }
      });
    }).on('error', reject);
  });
};

/**
 * Assess driving conditions and return alerts for a route.
 */
const getDrivingConditionAlerts = async ({ coordinates }) => {
  const alerts = [];

  for (const [lon, lat] of coordinates) {
    const weather = await getCurrentWeather({ lat, lon });
    const condition = weather.weather?.[0]?.main || weather.condition;

    if (['Snow', 'Thunderstorm', 'Tornado'].includes(condition)) {
      alerts.push({
        severity: 'high',
        type: condition,
        message: `Severe weather: ${condition} near [${lat}, ${lon}]`,
        coordinates: [lon, lat],
      });
    } else if (['Rain', 'Drizzle', 'Fog', 'Mist'].includes(condition)) {
      alerts.push({
        severity: 'moderate',
        type: condition,
        message: `Reduced visibility: ${condition} near [${lat}, ${lon}]`,
        coordinates: [lon, lat],
      });
    }
  }

  return alerts;
};

/**
 * Mock weather data for development / missing API key.
 */
const _mockWeather = (lat, lon) => ({
  coord: { lat, lon },
  weather: [{ id: 800, main: 'Clear', description: 'clear sky' }],
  main: { temp: 18, feels_like: 17, humidity: 60 },
  wind: { speed: 5 },
  condition: 'Clear',
  mock: true,
});

module.exports = { getCurrentWeather, getDrivingConditionAlerts };
