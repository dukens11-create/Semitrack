# Weigh-station import pipeline

This tool accepts official CSV, JSON, GeoJSON, and ArcGIS REST feature JSON. It normalizes fields, validates coordinates/schema/source URLs, flags generic non-enforcement sensors, detects likely duplicates by distance/highway/direction/name, and exports versioned Flutter assets.

Initialize truthful empty state files:

```powershell
node tools/weigh_station_import/index.mjs init assets/data/weigh_stations
```

Import a downloaded official dataset:

```powershell
node tools/weigh_station_import/index.mjs import `
  --input C:\data\official-stations.geojson `
  --state OR `
  --source-name "Oregon Department of Transportation" `
  --source-url "https://official.example.gov/dataset-page" `
  --default-type FIXED_WEIGH_STATION `
  --output assets/data/weigh_stations/OR.json `
  --report build/weigh_station_validation_OR.json
```

Review every duplicate and warning. A WIM/virtual record must only be retained when the official source documents an enforcement purpose. After an import, update `docs/WEIGH_STATION_DATA_SOURCES.md`; never mark a state imported merely because an empty file exists.

The importer updates `us_weigh_stations_manifest.json` automatically when it
is next to the state output. To combine separately normalized official files:

```powershell
node tools/weigh_station_import/index.mjs merge `
  --inputs C:\data\OR_dot.json,C:\data\OR_cve.json `
  --state OR `
  --output assets/data/weigh_stations/OR.json `
  --report build/weigh_station_validation_OR.json
```

Run the importer validation suite with:

```powershell
node --test tools/weigh_station_import/index.test.mjs
```
