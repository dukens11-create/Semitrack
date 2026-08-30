#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const states = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

const stationTypes = new Set([
  "FIXED_WEIGH_STATION", "PORT_OF_ENTRY", "COMMERCIAL_VEHICLE_ENFORCEMENT",
  "INSPECTION_STATION", "ENFORCEMENT_WIM", "VIRTUAL_WEIGH_STATION",
  "OTHER_ENFORCEMENT",
]);
const statuses = new Set(["OPEN", "CLOSED", "INSPECTION", "UNKNOWN"]);
const directions = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW", "NB", "SB", "EB", "WB"]);
const officialDirectory = "https://www.fhwa.dot.gov/about/webstate.cfm";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function required(name) {
  const value = option(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

export function parseCsv(text) {
  const rows = [];
  let row = [], value = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(value); value = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value); value = "";
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
    } else value += char;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  const headers = (rows.shift() ?? []).map((cell) => cell.trim());
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index]?.trim() ?? ""])));
}

export function unpackJson(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.stations)) return data.stations;
  if (Array.isArray(data.features)) {
    return data.features.map((feature) => {
      const properties = feature.properties ?? feature.attributes ?? {};
      const coordinates = feature.geometry?.coordinates;
      const x = feature.geometry?.x;
      const y = feature.geometry?.y;
      return {
        ...properties,
        ...(Array.isArray(coordinates) ? { longitude: coordinates[0], latitude: coordinates[1] } : {}),
        ...(typeof x === "number" && typeof y === "number" ? { longitude: x, latitude: y } : {}),
      };
    });
  }
  throw new Error("JSON must be an array, FeatureCollection, ArcGIS feature set, or station export");
}

function first(record, aliases) {
  for (const alias of aliases) {
    const value = record[alias];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

function slug(value) {
  return String(value).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function normalize(record, context) {
  const latitude = Number(first(record, ["latitude", "lat", "LATITUDE", "Y", "y"]));
  const longitude = Number(first(record, ["longitude", "lng", "lon", "LONGITUDE", "X", "x"]));
  const name = String(first(record, ["name", "facility_name", "station_name", "SITE_NAME", "Name"]) ?? "").trim();
  const highway = first(record, ["highway", "route", "roadway", "ROAD", "Route"]);
  const direction = String(first(record, ["direction", "dir", "DIRECTION", "Direction"]) ?? "").trim().toUpperCase() || null;
  const type = String(first(record, ["type", "station_type", "facility_type"]) ?? context.defaultType).trim().toUpperCase();
  const status = String(first(record, ["status", "operational_status"]) ?? "UNKNOWN").trim().toUpperCase().replace("INSPECTION_ACTIVE", "INSPECTION");
  const sourceId = String(first(record, ["id", "objectid", "OBJECTID", "station_id", "site_id"]) ?? "").trim();
  const id = `${context.state.toLowerCase()}-${slug(sourceId || name)}-${slug(highway ?? "facility")}`;
  const now = context.verifiedAt;
  return {
    id,
    name,
    state: context.state,
    latitude,
    longitude,
    highway: highway == null ? null : String(highway).trim(),
    direction,
    mileMarker: Number.isFinite(Number(first(record, ["mileMarker", "mile_marker", "milepost", "MP"])))
      ? Number(first(record, ["mileMarker", "mile_marker", "milepost", "MP"])) : null,
    type,
    status,
    statusSource: status === "UNKNOWN" ? null : context.sourceName,
    officialSourceName: context.sourceName,
    officialSourceUrl: context.sourceUrl,
    isOfficial: true,
    isActive: !["INACTIVE", "REMOVED", "DECOMMISSIONED"].includes(String(record.active_status ?? "").toUpperCase()),
    lastOfficialVerification: now,
    lastStatusUpdate: status === "UNKNOWN" ? null : now,
    createdAt: now,
    updatedAt: now,
  };
}

function validUrl(value) {
  try { const parsed = new URL(value); return parsed.protocol === "https:" || parsed.protocol === "http:"; }
  catch { return false; }
}

export function validate(stations, expectedState, stateBounds) {
  const errors = [], warnings = [], ids = new Set();
  stations.forEach((station, index) => {
    const at = `${expectedState}[${index}]`;
    if (!station.id || ids.has(station.id)) errors.push(`${at}: missing or duplicate id '${station.id}'`);
    ids.add(station.id);
    if (!station.name) errors.push(`${at}: missing name`);
    if (station.state !== expectedState) errors.push(`${at}: state '${station.state}' does not match ${expectedState}`);
    if (!Number.isFinite(station.latitude) || station.latitude < 18 || station.latitude > 72) errors.push(`${at}: invalid U.S. latitude`);
    if (!Number.isFinite(station.longitude) || station.longitude < -180 || station.longitude > -65) errors.push(`${at}: invalid U.S. longitude`);
    if (stateBounds && (station.latitude < stateBounds.minLat || station.latitude > stateBounds.maxLat || station.longitude < stateBounds.minLng || station.longitude > stateBounds.maxLng)) {
      errors.push(`${at}: coordinates fall outside configured ${expectedState} bounds`);
    }
    if (!stationTypes.has(station.type)) errors.push(`${at}: invalid facility type '${station.type}'`);
    if (!statuses.has(station.status)) errors.push(`${at}: invalid status '${station.status}'`);
    if (station.direction && !directions.has(station.direction)) errors.push(`${at}: invalid direction '${station.direction}'`);
    if (!validUrl(station.officialSourceUrl)) errors.push(`${at}: invalid official source URL`);
    if (/sensor|traffic counter/i.test(station.name) && !/enforcement|weigh|inspection|port of entry/i.test(station.name)) {
      warnings.push(`${at}: generic sensor requires proof that it is used for enforcement`);
    }
  });
  return { valid: errors.length === 0, errors, warnings };
}

export function distanceMeters(a, b) {
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLng = radians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 12_742_017.6 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function similarity(a, b) {
  const left = new Set(slug(a).split("-").filter(Boolean));
  const right = new Set(slug(b).split("-").filter(Boolean));
  if (!left.size || !right.size) return 0;
  const common = [...left].filter((part) => right.has(part)).length;
  return common / Math.max(left.size, right.size);
}

function directionCompatible(a, b) {
  return !a || !b || a === b;
}

export function deduplicate(stations) {
  const kept = [], duplicates = [];
  for (const station of stations) {
    const match = kept.find((candidate) =>
      candidate.state === station.state
      && distanceMeters(candidate, station) <= 300
      && directionCompatible(candidate.direction, station.direction)
      && (similarity(candidate.name, station.name) >= 0.4
        || (candidate.highway && station.highway && slug(candidate.highway) === slug(station.highway))));
    if (match) duplicates.push({ keptId: match.id, duplicateId: station.id, distanceMeters: Math.round(distanceMeters(match, station)) });
    else kept.push(station);
  }
  return { stations: kept, duplicates };
}

async function init(output) {
  await fs.mkdir(output, { recursive: true });
  const generatedAt = new Date().toISOString();
  const manifest = {
    datasetVersion: "0.1.0-pending",
    generatedAt,
    sourcePolicy: "Only authoritative government/FHWA/FMCSA sources. Empty states are intentionally PENDING.",
    officialSourceDirectory: officialDirectory,
    states: states.map((state) => ({
      state,
      stationCount: 0,
      source: "PENDING — authoritative state dataset not imported",
      sourceUrl: officialDirectory,
      lastVerified: null,
      datasetVersion: "0.1.0-pending",
      imported: false,
    })),
  };
  await Promise.all(states.map((state) => fs.writeFile(path.join(output, `${state}.json`), `${JSON.stringify({
    state,
    datasetVersion: "0.1.0-pending",
    generatedAt,
    imported: false,
    source: { name: "PENDING — authoritative state dataset not imported", url: officialDirectory },
    stations: [],
  }, null, 2)}\n`)));
  await fs.writeFile(path.join(output, "us_weigh_stations_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function updateManifest(output, stateDataset) {
  const manifestPath = path.join(path.dirname(output), "us_weigh_stations_manifest.json");
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    const entry = {
      state: stateDataset.state,
      stationCount: stateDataset.stations.length,
      source: stateDataset.source.name,
      sourceUrl: stateDataset.source.url,
      lastVerified: stateDataset.stations
        .map((station) => station.lastOfficialVerification)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null,
      datasetVersion: stateDataset.datasetVersion,
      imported: true,
    };
    const index = manifest.states.findIndex((candidate) => candidate.state === stateDataset.state);
    if (index >= 0) manifest.states[index] = entry;
    else manifest.states.push(entry);
    manifest.generatedAt = new Date().toISOString();
    manifest.datasetVersion = option("version", stateDataset.datasetVersion);
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function writeStateDataset(output, state, stations, source, version) {
  const dataset = {
    state,
    datasetVersion: version,
    generatedAt: new Date().toISOString(),
    imported: true,
    source,
    stations,
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(dataset, null, 2)}\n`);
  await updateManifest(output, dataset);
}

async function importData() {
  const inputPath = required("input");
  const state = required("state").toUpperCase();
  if (!states.includes(state)) throw new Error(`Unsupported state '${state}'`);
  const sourceName = required("source-name");
  const sourceUrl = required("source-url");
  if (!validUrl(sourceUrl)) throw new Error("--source-url must be an HTTP(S) official source URL");
  const output = required("output");
  const defaultType = option("default-type", "OTHER_ENFORCEMENT");
  const verifiedAt = option("verified-at", new Date().toISOString());
  const extension = path.extname(inputPath).toLowerCase();
  const text = await fs.readFile(inputPath, "utf8");
  const raw = extension === ".csv" ? parseCsv(text) : unpackJson(JSON.parse(text));
  const stations = raw.map((record) => normalize(record, { state, sourceName, sourceUrl, defaultType, verifiedAt }));
  const stateBoundsPath = option("state-bounds");
  const stateBounds = stateBoundsPath ? JSON.parse(await fs.readFile(stateBoundsPath, "utf8"))[state] : null;
  const report = validate(stations, state, stateBounds);
  const deduped = deduplicate(stations);
  report.duplicates = deduped.duplicates;
  report.inputCount = stations.length;
  report.outputCount = deduped.stations.length;
  const reportPath = option("report", `${output}.validation.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (!report.valid) throw new Error(`Validation failed; see ${reportPath}`);
  await writeStateDataset(
    output,
    state,
    deduped.stations,
    { name: sourceName, url: sourceUrl },
    option("version", verifiedAt.slice(0, 10)),
  );
  process.stdout.write(`Imported ${deduped.stations.length} ${state} enforcement locations; ${deduped.duplicates.length} duplicate(s) removed.\n`);
}

async function mergeData() {
  const inputs = required("inputs").split(",").map((value) => value.trim()).filter(Boolean);
  const state = required("state").toUpperCase();
  const output = required("output");
  if (!states.includes(state)) throw new Error(`Unsupported state '${state}'`);
  if (inputs.length < 2) throw new Error("--inputs must contain at least two comma-separated normalized files");
  const datasets = await Promise.all(inputs.map(async (input) => JSON.parse(await fs.readFile(input, "utf8"))));
  const stations = datasets.flatMap((dataset) => unpackJson(dataset));
  const report = validate(stations, state);
  const deduped = deduplicate(stations);
  report.duplicates = deduped.duplicates;
  report.inputCount = stations.length;
  report.outputCount = deduped.stations.length;
  const reportPath = option("report", `${output}.validation.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (!report.valid) throw new Error(`Validation failed; see ${reportPath}`);
  const sourceUrls = [...new Set(deduped.stations.map((station) => station.officialSourceUrl))];
  await writeStateDataset(
    output,
    state,
    deduped.stations,
    {
      name: `Merged ${datasets.length} authoritative source datasets`,
      url: sourceUrls[0] ?? officialDirectory,
      urls: sourceUrls,
    },
    option("version", new Date().toISOString().slice(0, 10)),
  );
  process.stdout.write(`Merged ${stations.length} records into ${deduped.stations.length} ${state} enforcement locations.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  try {
    if (command === "init") await init(process.argv[3] ?? "assets/data/weigh_stations");
    else if (command === "import") await importData();
    else if (command === "merge") await mergeData();
    else throw new Error("Usage: node index.mjs init [output-dir] | import --input FILE --state XX --source-name NAME --source-url URL --output FILE | merge --inputs A.json,B.json --state XX --output FILE");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
