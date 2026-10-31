import mongoose from "mongoose";
import app from "./app.js";
import { validateEnv } from "./config/env.js";
import { connectDatabase } from "./config/database.js";
import { backfillWorkspaces } from "./utils/migrateWorkspaces.js";

const env = validateEnv();

await connectDatabase();

// Idempotent migration: backfill legacy tenants & user memberships
await backfillWorkspaces();

const server = app.listen(env.PORT, () => {
  console.log(`MeterFlow API running on port ${env.PORT}`);
});

// Graceful shutdown handling
export function handleShutdown(signal) {
  return new Promise((resolve) => {
    console.log(`Received ${signal}. Shutting down gracefully...`);
    server.close(async () => {
      console.log("HTTP server closed.");
      try {
        await mongoose.connection.close(false);
        console.log("MongoDB connection closed.");
      } catch (err) {
        console.error("Error closing MongoDB connection:", err);
      }
      resolve();
    });
  });
}

process.on("SIGTERM", () => handleShutdown("SIGTERM").then(() => process.exit(0)));
process.on("SIGINT", () => handleShutdown("SIGINT").then(() => process.exit(0)));

export { server };
