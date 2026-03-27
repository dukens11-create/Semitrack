import { eldRouter } from "./modules/integrations/eld/eld.routes.js";
import { messagingRouter } from "./modules/messaging/messaging.routes.js";
import { maintenanceRouter } from "./modules/maintenance/maintenance.routes.js";
import { complianceRouter } from "./modules/compliance/compliance.routes.js";
import { stripeWebhookRouter } from "./modules/billing/stripe-webhook.routes.js";

app.use("/integrations/eld", eldRouter);
app.use("/messages", messagingRouter);
app.use("/maintenance", maintenanceRouter);
app.use("/compliance", complianceRouter);
app.use("/billing/stripe", stripeWebhookRouter);
