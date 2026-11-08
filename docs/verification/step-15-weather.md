# Step 15 — Weather and route risk
Status: Blocked for complete acceptance.
Investigated apps/api/src/services/weatherService.ts and mobile weatherPresentation.ts/WeatherStatus.tsx. Existing OpenWeather area observations validate age and provider coordinates; route points and 50/100-mile intent paths exist. Mobile refresh is bounded and cancels replaced requests. Severe alerts require explicit provider/area evidence; conditions are not converted into road closures.
Remaining: live authorized provider coverage, severe-alert ingestion and a documented validated route-risk model are not verified. No risk score was invented. Android/weather outage and route-ahead acceptance pending.
Tests: existing weather tests are part of the passing mobile suite; no live provider acceptance test performed.
Files changed: this report only. Included with Step 17 PR after explicit blocker.
Next: Step 16 — Authentication and device synchronization.
