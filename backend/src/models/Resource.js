import mongoose from "mongoose";

const resourceSchema = new mongoose.Schema(
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

    unit: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 50
    },

    price: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      min: 0
    }
  },
  {
    timestamps: true
  }
);

const Resource = mongoose.model("Resource", resourceSchema);

export default Resource;