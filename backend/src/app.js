import express from "express";
import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";
import authRoutes from "./routes/authRoutes.js";
import resourceRoutes from "./routes/resourceRoutes.js";
import workspaceRoutes from "./routes/workspaceRoutes.js";
import serviceRoutes from "./routes/serviceRoutes.js";
import usageRoutes from "./routes/usageRoutes.js";
import billingRoutes from "./routes/billingRoutes.js";
import budgetRoutes from "./routes/budgetRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, "../../frontend");

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"]
      }
    },
    frameguard: { action: "deny" }
  })
);
app.use(cors());
app.use(express.json({ limit: "500kb" }));

// Middleware to intercept malformed JSON syntax errors or payload-too-large errors
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      success: false,
      message: "Malformed JSON payload in request body"
    });
  }
  if (err.type === "entity.too.large" || err.status === 413) {
    return res.status(413).json({
      success: false,
      message: "Payload too large (maximum allowed size: 500kb)"
    });
  }
  next(err);
});

// Query parameter sanitization and parameter pollution / operator injection prevention
app.use((req, res, next) => {
  for (const [key, val] of Object.entries(req.query || {})) {
    if (
      key.includes("[") ||
      key.includes("]") ||
      key.startsWith("$") ||
      key === "__proto__" ||
      key === "constructor" ||
      key === "prototype"
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid query parameter: operator injection or bracketed keys are not permitted"
      });
    }

    if (Array.isArray(val)) {
      return res.status(400).json({
        success: false,
        message: `Parameter pollution detected for query parameter: '${key}'`
      });
    }

    if (typeof val === "object" && val !== null) {
      return res.status(400).json({
        success: false,
        message: `Invalid query parameter object for: '${key}'`
      });
    }
  }
  next();
});

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

// Explicit 404 handler for undefined API routes
app.use("/api", (req, res) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl}`
  });
});

// Safely serve static frontend files with dotfiles denied
app.use(express.static(frontendDir, { dotfiles: "deny" }));

// Frontend navigation route shortcuts
app.get("/", (req, res) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});
app.get("/login", (req, res) => {
  res.sendFile(path.join(frontendDir, "login.html"));
});
app.get("/register", (req, res) => {
  res.sendFile(path.join(frontendDir, "register.html"));
});
app.get("/services", (req, res) => {
  res.sendFile(path.join(frontendDir, "services.html"));
});
app.get("/usage", (req, res) => {
  res.sendFile(path.join(frontendDir, "usage.html"));
});
app.get("/billing", (req, res) => {
  res.sendFile(path.join(frontendDir, "billing.html"));
});
app.get("/budgets", (req, res) => {
  res.sendFile(path.join(frontendDir, "budgets.html"));
});

// 404 handler for undefined non-API endpoints
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl}`
  });
});

// Centralized error handling middleware with production sanitization
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }
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
