import type { LatLng } from "../types.js";

export const pois = [
  {
    id: "poi_1",
    name: "Pilot Travel Center",
    category: "truck_stop",
    brand: "Pilot",
    city: "Portland",
    state: "OR",
    lat: 45.53,
    lng: -122.68,
    amenities: ["showers", "parking", "diesel", "food", "wifi"],
    rating: 4.2
  },
  {
    id: "poi_2",
    name: "Love's Travel Stop",
    category: "truck_stop",
    brand: "Love's",
    city: "Portland",
    state: "OR",
    lat: 45.57,
    lng: -122.73,
    amenities: ["parking", "def", "laundry", "food"],
    rating: 4.0
  },
  {
    id: "poi_3",
    name: "TA Truck Service",
    category: "repair",
    brand: "TA",
    city: "Portland",
    state: "OR",
    lat: 45.49,
    lng: -122.61,
    amenities: ["repair", "parking", "fuel"],
    rating: 3.9
  }
];

export const parkingLots = [
  {
    id: "park_1",
    name: "Pilot #221",
    lat: 45.53,
    lng: -122.68,
    status: "LIMITED",
    totalSpaces: 95,
    prediction: "RED",
    history: ["AVAILABLE", "LIMITED", "FULL"]
  },
  {
    id: "park_2",
    name: "Rest Area Mile 143",
    lat: 45.71,
    lng: -122.95,
    status: "AVAILABLE",
    totalSpaces: 48,
    prediction: "YELLOW",
    history: ["AVAILABLE", "AVAILABLE", "LIMITED"]
  }
];

export const fuelStations = [
  { id: "fuel_1", name: "Pilot", lat: 45.53, lng: -122.68, dieselPrice: 4.05, defAvailable: true, truckSafe: true, wexSupported: true },
  { id: "fuel_2", name: "TA", lat: 45.49, lng: -122.61, dieselPrice: 4.12, defAvailable: true, truckSafe: true, wexSupported: true },
  { id: "fuel_3", name: "Independent Truck Stop", lat: 45.60, lng: -122.82, dieselPrice: 3.98, defAvailable: false, truckSafe: true, wexSupported: false }
];

export const weighStations = [
  { id: "scale_1", name: "Northbound Weigh Station", lat: 45.66, lng: -122.84, status: "OPEN", catScale: false },
  { id: "scale_2", name: "CAT Scale - Pilot", lat: 45.53, lng: -122.68, status: "OPEN", catScale: true }
];

export const loads = [
  { id: "load_1", brokerName: "ABC Logistics", originCity: "Portland", originState: "OR", destinationCity: "Reno", destinationState: "NV", equipmentType: "Dry Van", weightLbs: 42000, rateUsd: 1800 },
  { id: "load_2", brokerName: "West Lane Freight", originCity: "Seattle", originState: "WA", destinationCity: "Boise", destinationState: "ID", equipmentType: "Reefer", weightLbs: 36000, rateUsd: 2100 }
];

export const documents = [
  { id: "doc_1", type: "invoice", fileName: "invoice-1001.pdf", fileUrl: "https://example.com/invoice-1001.pdf" },
  { id: "doc_2", type: "pod", fileName: "pod-4021.pdf", fileUrl: "https://example.com/pod-4021.pdf" }
];

export const drivers = [
  { id: "drv_1", name: "John Driver", truckUnit: "102", status: "IN_TRANSIT", lat: 45.5231, lng: -122.6765 },
  { id: "drv_2", name: "Sarah Miles", truckUnit: "109", status: "AT_STOP", lat: 45.6011, lng: -122.8510 }
];

export function distanceMiles(a: LatLng, b: LatLng) {
  const R = 3958.8;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}
