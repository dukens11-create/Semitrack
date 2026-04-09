State Welcome Pack
===================

Files included:
- states_provinces.json  →  deployed to assets/data/states_provinces.json

Integration status: ACTIVE
--------------------------
The data in this pack is fully integrated into the Semitrack app:

1. Asset registration (pubspec.yaml)
   assets/data/states_provinces.json is declared under flutter: assets:
   so Flutter bundles it at build time.

2. Model (lib/models/state_province.dart)
   StateProvince  – typed Dart model with fields:
     code, country, name, capital, main_city,
     became_state_year, population, specialization

3. Service (lib/services/state_province_service.dart)
   StateProvinceService.load()           – reads + parses the JSON asset
   StateProvinceService.filterByCountry()– filter to 'US' or 'CA'
   StateProvinceService.findByCode()     – lookup by two-letter code

4. Trip Planner UI (lib/features/trip_planner/trip_planner_screen.dart)
   Origin and Destination dropdowns are populated from the JSON data.
   A "Region Info" card displays capital, population, and specialization
   for the selected origin and destination states/provinces.

JSON fields:
- code              two-letter abbreviation (e.g. "TX", "ON")
- country           "US" or "CA"
- name              full name
- capital           capital city
- main_city         largest / main city
- became_state_year year of statehood / provincial establishment
- population        approximate population string
- specialization    key industries

Suggested voice message format:
"Welcome to {name}. Capital: {capital}. Population: {population}. Known for {specialization}. Main city: {main_city}."
