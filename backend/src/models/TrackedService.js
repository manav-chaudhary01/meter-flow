import mongoose from "mongoose";

const trackedServiceSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100
    },
    provider: {
      type: String,
      trim: true,
      maxlength: 100,
      default: ""
    },
    category: {
      type: String,
      trim: true,
      maxlength: 100,
      default: "general"
    },
    trackingType: {
      type: String,
      enum: ["metered", "subscription", "hybrid"],
      required: true
    },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      default: "USD",
      minlength: 3,
      maxlength: 3,
      required: true
    },
    unit: {
      type: String,
      trim: true,
      maxlength: 50,
      default: ""
    },
    unitPrice: {
      type: mongoose.Schema.Types.Decimal128,
      default: null
    },
    subscriptionAmount: {
      type: mongoose.Schema.Types.Decimal128,
      default: null
    },
    billingInterval: {
      type: String,
      enum: ["daily", "monthly", "quarterly", "yearly", null],
      default: null
    },
    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
      required: true,
      index: true
    }
  },
  {
    timestamps: true
  }
);

// Compound indexes for workspace queries
trackedServiceSchema.index({ tenantId: 1, status: 1 });
trackedServiceSchema.index({ tenantId: 1, name: 1 });

const TrackedService = mongoose.model("TrackedService", trackedServiceSchema);

export default TrackedService;
