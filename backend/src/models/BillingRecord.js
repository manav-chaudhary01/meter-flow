import mongoose from "mongoose";

const lineItemSchema = new mongoose.Schema(
  {
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TrackedService",
      required: true
    },
    serviceName: {
      type: String,
      required: true,
      trim: true
    },
    chargeType: {
      type: String,
      enum: ["subscription", "usage"],
      required: true
    },
    quantity: {
      type: mongoose.Schema.Types.Decimal128,
      default: null
    },
    unit: {
      type: String,
      default: null
    },
    unitPrice: {
      type: mongoose.Schema.Types.Decimal128,
      default: null
    },
    amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true
    },
    usageRecordCount: {
      type: Number,
      default: 0
    },
    usageRecordIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "UsageRecord"
      }
    ],
    description: {
      type: String,
      required: true,
      trim: true
    }
  },
  { _id: true }
);

const billingRecordSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true
    },
    invoiceNumber: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    billingPeriodStart: {
      type: Date,
      required: true,
      index: true
    },
    billingPeriodEnd: {
      type: Date,
      required: true,
      index: true
    },
    currency: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      minlength: 3,
      maxlength: 3,
      default: "USD"
    },
    lineItems: [lineItemSchema],
    subtotal: {
      type: mongoose.Schema.Types.Decimal128,
      required: true
    },
    total: {
      type: mongoose.Schema.Types.Decimal128,
      required: true
    },
    status: {
      type: String,
      enum: ["issued", "finalized", "draft", "void"],
      default: "issued",
      required: true,
      index: true
    },
    generatedAt: {
      type: Date,
      default: Date.now,
      required: true,
      index: true
    },
    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Uniqueness: Exactly ONE bill per workspace for a given period and currency
billingRecordSchema.index(
  { tenantId: 1, billingPeriodStart: 1, billingPeriodEnd: 1, currency: 1 },
  { unique: true }
);

billingRecordSchema.index({ tenantId: 1, generatedAt: -1 });
billingRecordSchema.index({ tenantId: 1, status: 1 });

const BillingRecord = mongoose.model("BillingRecord", billingRecordSchema);

export default BillingRecord;
