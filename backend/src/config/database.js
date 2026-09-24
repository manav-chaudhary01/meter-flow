import mongoose from "mongoose";
import dns from "node:dns";

export async function connectDatabase() {
  try {
    // Use public DNS resolvers for MongoDB Atlas SRV lookups.
    dns.setServers(["1.1.1.1", "8.8.8.8"]);

    await mongoose.connect(process.env.MONGODB_URI);

    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection failed:");
    console.error(error.message);
    process.exit(1);
  }
}