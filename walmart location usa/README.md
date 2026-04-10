# Walmart Location USA

This folder contains the canonical raw address dataset for all US Walmart store locations used by the **Semitrack** application.

---

## File: `walmart-stores.json`

### Purpose

`walmart-stores.json` is the **authoritative reference dataset** for US Walmart store addresses. It is the upstream source from which the application's full POI asset (`assets/walmart-stores.json`) is derived. All address and postal code data for Walmart stores should be maintained here first.

> **Note:** The app loads Walmart POIs at runtime exclusively from `assets/walmart-stores.json` (which includes geocoordinates, categories, and icons). Do **not** load this file directly from the Flutter app.

---

## Schema

Each entry in the JSON array has the following fields:

| Field        | Type   | Required | Description                                              |
|--------------|--------|----------|----------------------------------------------------------|
| `store_id`   | string | ✅        | Walmart's internal store identifier                      |
| `postal_code`| string | ✅        | US ZIP code of the store location                        |
| `address`    | string | ✅        | Full or partial street address of the store              |

### Example Entry

```json
{
  "store_id": "1158",
  "postal_code": "35214",
  "address": "2473 Hackworth Rd, Adamsville, AL 35214"
}
```

---

## Usage

### JavaScript / Node.js

See [`example.js`](./example.js) for a complete loading and filtering example.

```js
import { readFileSync } from 'fs';
const stores = JSON.parse(readFileSync('./walmart-stores.json', 'utf8'));
console.log(`Total stores: ${stores.length}`);
```

### Python

See [`example.py`](./example.py) for a complete loading and filtering example.

```python
import json
with open('walmart-stores.json') as f:
    stores = json.load(f)
print(f"Total stores: {len(stores)}")
```

---

## Validation

A JSON Schema file is provided at [`walmart-stores-schema.json`](./walmart-stores-schema.json) for validating the structure of `walmart-stores.json`. Use any JSON Schema validator (e.g. [ajv](https://ajv.js.org/) for JavaScript, [jsonschema](https://pypi.org/project/jsonschema/) for Python) to verify the data before updating the app's asset file.

---

## Updating Store Data

1. Add, remove, or correct entries in this file (`walmart location usa/walmart-stores.json`).
2. Regenerate or manually update `assets/walmart-stores.json` to keep geocoordinates, `name`, `city`, `stateOrProvince`, and other POI fields in sync.
3. Do **not** add Walmart entries to `assets/locations.json` or hardcode them anywhere in the Dart/Flutter codebase.

---

## Related Files

| Path | Description |
|------|-------------|
| `assets/walmart-stores.json` | Full POI dataset loaded by the Flutter app (single source of truth for the map) |
| `lib/services/poi_service.dart` | Flutter service that loads `assets/walmart-stores.json` at runtime |
| `apps/mobile/lib/services/poi_service.dart` | Mirror of the POI service for the mobile app target |
| `IMPLEMENTATION_NOTES.md` | Architecture notes on the Walmart POI data pipeline |
