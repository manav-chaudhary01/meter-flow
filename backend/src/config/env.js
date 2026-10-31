import dotenv from "dotenv";

dotenv.config();

export function validateEnv() {
  const missing = [];

  if (!process.env.MONGODB_URI) {
    missing.push("MONGODB_URI");
  }
  if (!process.env.JWT_SECRET) {
    missing.push("JWT_SECRET");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. Please check your backend/.env file.`
    );
  }

  if (process.env.NODE_ENV === "production" && process.env.JWT_SECRET && process.env.JWT_SECRET.length < 16) {
    throw new Error("JWT_SECRET must be at least 16 characters in production");
  }

  return {
    PORT: process.env.PORT || 5000,
    MONGODB_URI: process.env.MONGODB_URI,
    JWT_SECRET: process.env.JWT_SECRET,
    NODE_ENV: process.env.NODE_ENV || "development"
  };
}
