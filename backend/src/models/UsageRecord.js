import mongoose from "mongoose";

const usageRecordSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TrackedService",
      required: true,
      index: true
    },
    quantity: {
      type: mongoose.Schema.Types.Decimal128,
      required: true
    },
    unit: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 50
    },
    occurredAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true
    },
    source: {
      type: String,
      trim: true,
      maxlength: 100,
      default: "api"
    },
    idempotencyKey: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null
    },
    externalEventId: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    billingRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BillingRecord",
      default: null,
      index: true
    },
    billedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Idempotency: Unique per tenant for idempotencyKey when string is present
usageRecordSchema.index(
  { tenantId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } }
  }
);

// Idempotency: Unique per tenant + service for externalEventId when string is present
usageRecordSchema.index(
  { tenantId: 1, serviceId: 1, externalEventId: 1 },
  {
    unique: true,
    partialFilterExpression: { externalEventId: { $type: "string" } }
  }
);

// Query & Aggregation indexes
usageRecordSchema.index({ tenantId: 1, serviceId: 1, occurredAt: -1 });
usageRecordSchema.index({ tenantId: 1, occurredAt: -1 });
usageRecordSchema.index({ tenantId: 1, billingRecordId: 1, occurredAt: 1 });

const UsageRecord = mongoose.model("UsageRecord", usageRecordSchema);

export default UsageRecord;
