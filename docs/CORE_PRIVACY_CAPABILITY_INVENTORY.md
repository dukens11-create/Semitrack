# Core privacy and external capability inventory

Engineering inventory for F018/F100/F101/F102/F114/F115/F118/F143. Not a published privacy policy, store declaration, legal determination or provider acceptance. No real provider requests were made.

| Component/source | Current data flow / evidence | Unresolved gate |
|---|---|---|
| React Native 0.85.0 / application API client | Account HTTPS requests; refresh/access tokens kept in Keychain, session-generation isolation | Android/iOS exact-build lifecycle acceptance |
| react-native-keychain 10.0.0 | Separate protected services for tokens, appearance and bounded offline preferences; logout clears tokens/offline snapshot | Device lock/restart/backup behavior |
| @rnmapbox/maps 10.3.5 / TruckMap | Display maps, user position, route/alternative/POI layers; no approved live traffic source/layer; no passenger router | Vendor disclosure/attribution and licensed traffic-source approval (F018) |
| Trimble backend provider | Truck dimensions, restrictions and requested stops sent for commercial routing; exact provider code unchanged | Existing provider/licensing/runtime acceptance; no provider request in this pass |
| CPIK 10.28.2-497 | Existing provisioning capability gates; no fake guidance | License/maps/runtime and vendor SDK data disclosure review |
| Native location bridge / DriverSetup | Foreground permission explicitly requested, onboarding review is not legal consent; route origin/search uses location only through existing paths | Published consent and device permission/revocation acceptance |
| OpenWeather / weatherService | Current area observation endpoint, age/location validation; not official severe-weather alerts | Approved US/Canada/Mexico official feeds, attribution, freshness/severity/delivery policy (F100) |
| DriverIntent / acceptDriverTranscript | Deterministic text dispatcher and foreground/final/user-initiated transcript validation only | Approved AI architecture/privacy/confirmation policy; actual wake-word/STT/TTS integration and hardware acceptance (F101/F102) |
| Push and local reminders | No push SDK dependency/FCM/APNS registration or authoritative route/weather/HOS/account reminder delivery path in current source | Approved platform channel, credentials, consent, authoritative events and cold/warm delivery acceptance (F114/F115) |
| Settings privacy page / onboarding | Truthful information and native location boundary; no unimplemented notification toggle or consent claim | Published policy, notification subsystem/preferences enforcement and real acceptance (F118) |
| API schema / deletion service | Profile minimization, session revocation, personal preferences/favorites removal, selected document removal, retained business/safety records and deletion ledger | Approved duration/minimization rules, independent ledger replication, production restore exercise, complete export and vendor/store disclosures (F143/F006) |
| Password recovery outbox (previous repair) | Encrypted recovery jobs; disabled/missing users are not delivered; bounded jobs and used-token suppression | Delivery credentials and real email acceptance remain separate |
| ELD connections | Encrypted credentials cleared on deletion; local disconnected state and late-write sanitization | External provider-side token revocation and real HOS acceptance |

Absence of these provider/platform paths is still missing implementation. BLOCKED means the prior audit already identified an external prerequisite that prevents complete acceptance; it does not mean the feature is implemented. Existing synthetic tests prove safe contracts only, never real traffic, weather alerts, AI, notification delivery or licensed CoPilot operation.

Required owner decisions remain: approved providers/SDK channels, published consent text and telemetry/location purpose inventory, retention durations and holds, independent backup ledger/recovery ownership, export format/delivery controls, vendor subprocessors/regions and store privacy declarations. No durations, credentials, legal claims, data feeds or successful provider responses have been invented.
