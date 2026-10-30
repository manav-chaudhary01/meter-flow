import app from "./app.js";
import { validateEnv } from "./config/env.js";
import { connectDatabase } from "./config/database.js";
import { backfillWorkspaces } from "./utils/migrateWorkspaces.js";

const env = validateEnv();

await connectDatabase();

// Idempotent migration: backfill legacy tenants & user memberships
await backfillWorkspaces();

app.listen(env.PORT, () => {
  console.log(`MeterFlow API running on port ${env.PORT}`);
});
