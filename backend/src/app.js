import express from "express";
import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";
import authRoutes from "./routes/authRoutes.js";
import resourceRoutes from "./routes/resourceRoutes.js";
import workspaceRoutes from "./routes/workspaceRoutes.js";
import serviceRoutes from "./routes/serviceRoutes.js";
import usageRoutes from "./routes/usageRoutes.js";
import billingRoutes from "./routes/billingRoutes.js";
import budgetRoutes from "./routes/budgetRoutes.js";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  const isConnected = mongoose.connection && mongoose.connection.readyState === 1;
  res.status(200).json({
    success: true,
    status: isConnected ? "healthy" : "degraded",
    message: "MeterFlow API is running",
    database: isConnected ? "connected" : "disconnected",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/workspaces", workspaceRoutes);
app.use("/api/resources", resourceRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/usage", usageRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/budgets", budgetRoutes);

// 404 handler for undefined endpoints
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl}`
  });
});

// Centralized error handling middleware with production sanitization
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  console.error("Unhandled server error:", err);
  const status = err.status || 500;
  const isProduction = process.env.NODE_ENV === "production";
  const message =
    isProduction && status === 500
      ? "Internal server error"
      : err.message || "Internal server error";

  res.status(status).json({
    success: false,
    message
  });
}

app.use(errorHandler);

export default app;
