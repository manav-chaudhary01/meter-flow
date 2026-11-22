import mongoose from "mongoose";

const tenantSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100
    },
    type: {
      type: String,
      enum: ["personal", "organization"],
      default: "organization",
      required: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
      required: true,
      index: true
    },
    archivedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

const Tenant = mongoose.model("Tenant", tenantSchema);

export default Tenant;
