# Semitrack Full App Scaffold

This is a **full multi-app scaffold** for a truck GPS platform with:

- **Flutter mobile app** (`apps/mobile`)
- **Node.js + Express + TypeScript API** (`apps/api`)
- **React admin dashboard** (`apps/admin`)
- **Shared docs and environment samples**

## What is included

### Mobile app
- Truck navigation UI
- Trip planner
- POI explorer
- Parking UI
- Fuel prices
- Weigh stations
- Alerts
- Weather
- Offline maps page
- Driver profile and truck settings
- Community page
- Fleet dashboard
- Load board
- Documents page
- Subscription page

### Backend API
- Truck route generation endpoint
- Trip planning endpoint
- POI search endpoint
- Parking report endpoint
- Fuel endpoint
- Weigh station endpoint
- Alerts endpoint
- Weather endpoint
- Fleet endpoint
- Load board endpoint
- Documents endpoint
- Subscriptions endpoint
- Mock in-memory dataset starter

### Admin dashboard
- Fleet stats
- Driver table
- Load board summary
- Parking reports
- Document list

## Honest note

This is a **serious production scaffold**, not a fully licensed commercial navigation product.
To make it truly production-ready, you still need:

- truck-safe routing provider or self-hosted routing graph
- live traffic provider
- live weather provider
- 511 / DOT feeds
- ELD integrations
- WEX or fuel card integrations
- cloud database
- authentication
- payments
- moderation / abuse controls
- app store deployment and testing

## Run locally

### API
```bash
cd apps/api
npm install
npm run dev
```

### Admin
```bash
cd apps/admin
npm install
npm run dev
```

### Mobile
```bash
cd apps/mobile
flutter pub get
flutter run
```
