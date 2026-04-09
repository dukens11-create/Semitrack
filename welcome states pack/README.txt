State Welcome Pack

Files included:
- assets/data/states_provinces.json

How to use:
1. Copy the assets folder into your Flutter project root.
2. Add this to pubspec.yaml under flutter:

  assets:
    - assets/data/states_provinces.json

3. Run:
   flutter pub get

Suggested JSON fields:
- code
- country
- name
- capital
- main_city
- became_state_year
- population
- specialization

Suggested voice message format:
"Welcome to {name}. Capital: {capital}. Population: {population}. Known for {specialization}. Main city: {main_city}."
