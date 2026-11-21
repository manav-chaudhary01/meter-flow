import mongoose from "mongoose";
import dns from "node:dns";

export async function connectDatabase() {
  try {
    // Attempt to set public DNS resolvers for MongoDB Atlas SRV lookups if host allows
    try {
      dns.setServers(["1.1.1.1", "8.8.8.8"]);
    } catch (dnsErr) {
      console.warn("Custom DNS resolver configuration skipped, using system DNS:", dnsErr.message);
    }

    // Conservative connection pooling for cloud hosting (Render + Atlas free/shared tiers)
    const mongooseOptions = {
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      heartbeatFrequencyMS: 10000
    };

    await mongoose.connect(process.env.MONGODB_URI, mongooseOptions);

    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection failed:");
    console.error(error.message);
    process.exit(1);
  }
}