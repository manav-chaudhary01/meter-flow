import mongoose from "mongoose";

const tenantSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100
    }
  },
  {
    timestamps: true
  }
);

const Tenant = mongoose.model("Tenant", tenantSchema);

export default Tenant;
