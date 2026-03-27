# Semitrack GPS Truck App

A full-stack GPS tracking and fleet management application for semi-trucks.

## Project Structure

```
Semitrack/
├── backend/          # Node.js / Express REST API
│   ├── app.js        # Express app setup
│   ├── index.js      # Server entry point
│   └── src/
│       ├── models/   # Mongoose data models
│       ├── services/ # Business logic
│       ├── routes/   # API route handlers
│       ├── middleware/
│       └── utils/
└── mobile/           # React Native app
    ├── App.js        # App root
    └── src/
        ├── screens/
        ├── components/
        ├── navigation/
        ├── context/
        └── api/
```

## Backend

### Tech Stack
- Node.js + Express
- MongoDB + Mongoose
- JWT Authentication
- Winston logging

### Getting Started

```bash
cd backend
npm install
cp .env.example .env      # fill in your values
npm run dev               # start with nodemon
```

### Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 5000) |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret key for JWT signing |
| `JWT_EXPIRES_IN` | JWT expiry (default: 7d) |
| `WEATHER_API_KEY` | OpenWeatherMap API key (optional) |

### API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Register a user |
| POST | `/api/auth/login` | Login and get JWT |
| POST | `/api/navigation/route` | Calculate a truck route |
| GET | `/api/navigation/traffic/:routeId` | Get traffic updates |
| GET | `/api/trips` | List trips |
| POST | `/api/trips` | Plan a new trip |
| PATCH | `/api/trips/:id/start` | Start a trip |
| PATCH | `/api/trips/:id/complete` | Complete a trip |
| GET | `/api/poi/nearby` | Find nearby POIs |
| GET | `/api/parking/nearby` | Find available parking |
| POST | `/api/parking/:id/reserve` | Reserve a parking spot |
| GET | `/api/fuel/stations` | Find nearby fuel stations |
| POST | `/api/fuel/fillup` | Log a fuel fill-up |
| GET | `/api/fuel/range/:truckId` | Estimate fuel range |
| GET | `/api/weather/current` | Current weather |
| POST | `/api/weather/alerts` | Driving condition alerts |
| GET | `/api/fleet` | Fleet overview |
| POST | `/api/fleet/trucks` | Add a truck |
| GET | `/api/fleet/trucks/:id` | Get truck details |
| PATCH | `/api/fleet/trucks/:id/status` | Update truck status |
| POST | `/api/fleet/trucks/:id/assign` | Assign driver to truck |
| GET | `/api/fleet/maintenance` | Trucks needing service |
| GET | `/api/fleet/analytics` | Fleet analytics |

### Models
- **Truck** – Vehicle info, status, location, fuel level
- **User** – Drivers, dispatchers, managers (roles)
- **Trip** – Origin/destination, route, cargo, status
- **POI** – Points of interest (fuel stations, rest areas, etc.)
- **Parking** – Truck parking facilities and reservations

### Services
- `navigationService` – Route calculation, traffic updates
- `tripPlannerService` – Trip lifecycle management
- `poiService` – POI search and management
- `parkingService` – Parking search and reservations
- `fuelService` – Fuel station finder, fill-up logging, range estimation
- `weatherService` – Current weather and driving condition alerts
- `fleetService` – Fleet overview, driver assignment, maintenance tracking
- `analyticsService` – Trip stats, truck performance, daily counts

---

## Mobile App (React Native)

### Tech Stack
- React Native 0.72
- React Navigation (bottom tabs + native stack)
- Axios for API calls
- AsyncStorage for token persistence

### Getting Started

```bash
cd mobile
npm install
cp .env.example .env      # set API_BASE_URL to your backend
npx react-native run-android
# or
npx react-native run-ios
```

### Screens
- **HomeScreen** – Dashboard with quick actions and fleet overview
- **TruckDetailScreen** – Individual truck info, fuel level, driver
- **NavigationScreen** – Route planning with truck constraints
- **TripPlannerScreen** – Create and track trips
- **ParkingScreen** – Find and reserve truck parking
- **FuelScreen** – Find diesel stations and log fill-ups
- **FleetDashboardScreen** – Fleet management for dispatchers/managers
- **WeatherAlertsScreen** – Real-time weather and driving safety alerts

### Components
- **TruckList** – Reusable truck list with status indicators

---

## Features

1. GPS-based real-time truck tracking
2. Turn-by-turn navigation with truck-specific routing
3. Trip planning and management
4. Points of Interest (fuel, rest areas, weigh stations)
5. Truck parking finder and reservation
6. Fuel management and efficiency tracking
7. Weather alerts and driving conditions
8. Fleet management dashboard
9. Driver assignment and management
10. JWT-based authentication and role-based access control
11. Maintenance scheduling alerts
12. Fleet analytics and reporting

## License

MIT
