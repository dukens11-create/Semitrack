# Standard semitrailer routing weight and road preferences

The standard-truck validator previously rejected a null measured axle-group weight even when the installed CoPilot fleet profile could supply the documented routing value. A scale-ticket entry is not a universal CoPilot requirement.

For the existing limited North America standard single 53-foot semitrailer mode, a null measured override now requests 34,000 lb. This is the documented Heavy Duty Semitrailer routing default, not measured cargo data. The saved field remains null. Explicit supplied values remain unchanged. Other equipment, dimensions, verification, and restriction gates remain in force.

The read-only native verifier must still match the requested value against the active fleet profile, alongside its dimensions, gross routing weight, trailer count, routing mode, hazardous-goods state and toll preference. A mismatched value rejects; this change does not overwrite native defaults or fleet settings. Start/Resume retains explicit driver confirmation and a second verification. The profile and trip review explain the source and that the routing value must be appropriate for the vehicle/load.

Residential and dirt-road avoidance have no verified equivalent in this integration. Their enabled state continues to block Start. Turning either off in the form now requires an explicit explanation/choice; cancellation preserves the preference. The subsequent save/review flow still applies. No migration or automatic restriction removal is performed. This is a preference-management correction, not implementation of missing road-class exclusions.

## Evidence

- Official default profile table: https://developer.trimblemaps.com/copilot-navigation/feature-guide/operating-features/vehicle-routing-profile/
- CPIK native dimension/readback API: https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/native-and-dot-net/api-functions/routemgr/
- Focused tests cover null preservation, explicit override preservation, native mismatch propagation, unsupported profile gates, and explicit preference-change consent.
- Java helper regression rejects an active engine axle-group value different from 34,000 lb and invalidates acceptance after the native profile changes.

Android compilation and device guidance acceptance must be recorded separately. Broader truck configurations and the two road-class exclusions remain unsupported in this limited mode. No production deployment or device-data reset is included.
