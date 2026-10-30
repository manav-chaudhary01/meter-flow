import mongoose from "mongoose";

const membershipSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true
    },
    role: {
      type: String,
      enum: ["owner", "admin", "member"],
      default: "member",
      required: true
    },
    status: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
      required: true
    }
  },
  {
    timestamps: true
  }
);

// Compound unique index ensuring a user can have at most one membership per workspace
membershipSchema.index({ userId: 1, tenantId: 1 }, { unique: true });
membershipSchema.index({ tenantId: 1, role: 1 });

const Membership = mongoose.model("Membership", membershipSchema);

export default Membership;
