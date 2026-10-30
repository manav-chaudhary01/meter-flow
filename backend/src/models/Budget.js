import mongoose from "mongoose";

const budgetSchema = new mongoose.Schema(
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
    amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true
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
    periodType: {
      type: String,
      enum: ["monthly", "quarterly", "yearly", "custom"],
      default: "monthly",
      required: true
    },
    startDate: {
      type: Date,
      required: true,
      index: true
    },
    endDate: {
      type: Date,
      required: true,
      index: true
    },
    thresholds: {
      type: [Number],
      default: [50, 80, 90, 100],
      validate: {
        validator: function (arr) {
          if (!Array.isArray(arr) || arr.length === 0) return false;
          return arr.every((t) => typeof t === "number" && t > 0 && t <= 200);
        },
        message: "Thresholds must be an array of positive numbers between 1 and 200"
      }
    },
    status: {
      type: String,
      enum: ["active", "inactive", "archived"],
      default: "active",
      required: true,
      index: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    }
  },
  {
    timestamps: true
  }
);

budgetSchema.index({ tenantId: 1, status: 1 });
budgetSchema.index({ tenantId: 1, currency: 1 });
budgetSchema.index({ tenantId: 1, startDate: 1, endDate: 1 });

const Budget = mongoose.model("Budget", budgetSchema);

export default Budget;
