# Explicit CoPilot truck profile application

Build 150 device diagnostics reported maximum straight length 636/0 inches, minimum overall length 636/0 inches, and total routing weight 34000/80000 lb (requested/read back). The engine and licenses were ready; comparing profiles alone did not write the missing fields. The report does not establish whether the saved 34000 lb is the actual whole-vehicle weight, cargo weight, or an axle-group weight.

The navigation controls now offer **Apply saved truck to CoPilot**. The driver must supply actual bumper-to-bumper combination length and explicitly review whole-vehicle and axle-group routing weights. No overall length is inferred from a 53-foot trailer. Existing saved-profile verification and standard-mode restrictions remain mandatory.

Native application creates a separate API profile without overwriting an existing profile, writes legacy length, maximum straight length, overall length, trailer count, total weight and axle-group weight separately, and verifies the selected native profile. Every SDK modification result must be successful. A rejected or altered readback fails application and attempts to restore the previous active profile; an unconfirmed restoration is separately reported. Fleet-managed profiles and active/pending trips cannot be replaced by this operation. Applying never accepts the profile or starts guidance.

Scope remains the existing single 53-foot dry van/reefer, five-axle standard mode on SDK 11.4.0.2142. Unsupported road avoidance settings are not silently discarded. Other truck configurations still require separate supported integration work.

Validation includes service tests for missing length, whole-vehicle acknowledgment, stale reviews and native failure; UI tests for cancel/no write and explicit confirmation; native tests for separate field mapping, fleet/trip guards, SDK rejection, failed activation, rollback and failed restoration. The APK workflow additionally compiles against the licensed SDK. Device application, persisted readback after restart and real guidance remain device checks, not established by mocks or APK compilation.
