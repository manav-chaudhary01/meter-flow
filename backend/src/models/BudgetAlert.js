import mongoose from "mongoose";

const budgetAlertSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true
    },
    budgetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Budget",
      required: true,
      index: true
    },
    budgetName: {
      type: String,
      required: true,
      trim: true
    },
    periodStart: {
      type: Date,
      required: true
    },
    periodEnd: {
      type: Date,
      required: true
    },
    threshold: {
      type: Number,
      required: true
    },
    actualSpend: {
      type: mongoose.Schema.Types.Decimal128,
      required: true
    },
    budgetAmount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true
    },
    currency: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      minlength: 3,
      maxlength: 3
    },
    percentageUsed: {
      type: Number,
      required: true
    },
    alertType: {
      type: String,
      enum: ["threshold_reached", "threshold_exceeded"],
      default: "threshold_reached",
      required: true
    },
    status: {
      type: String,
      enum: ["active", "acknowledged", "resolved"],
      default: "active",
      required: true,
      index: true
    },
    triggeredAt: {
      type: Date,
      default: Date.now,
      required: true,
      index: true
    }
  },
  {
    timestamps: true
  }
);

// Database-enforced uniqueness: strictly prevent duplicate alerts for the same budget, period, and threshold
budgetAlertSchema.index(
  { budgetId: 1, periodStart: 1, periodEnd: 1, threshold: 1 },
  { unique: true }
);

budgetAlertSchema.index({ tenantId: 1, status: 1 });
budgetAlertSchema.index({ tenantId: 1, triggeredAt: -1 });

const BudgetAlert = mongoose.model("BudgetAlert", budgetAlertSchema);

export default BudgetAlert;
