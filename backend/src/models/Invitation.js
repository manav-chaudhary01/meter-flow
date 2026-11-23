import mongoose from "mongoose";

const invitationSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true
    },
    role: {
      type: String,
      enum: ["admin", "member"],
      default: "member",
      required: true
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined", "expired", "cancelled"],
      default: "pending",
      required: true,
      index: true
    },
    tokenHash: {
      type: String,
      required: true,
      index: true
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true
    },
    acceptedAt: {
      type: Date,
      default: null
    },
    acceptedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    declinedAt: {
      type: Date,
      default: null
    },
    cancelledAt: {
      type: Date,
      default: null
    },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Compound partial unique index: ensures at most one pending invitation exists per (workspace, email)
invitationSchema.index(
  { tenantId: 1, email: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } }
);

// Performance index for token lookups
invitationSchema.index({ tokenHash: 1, status: 1 });

// Performance index for workspace listing
invitationSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

const Invitation = mongoose.model("Invitation", invitationSchema);

export default Invitation;
