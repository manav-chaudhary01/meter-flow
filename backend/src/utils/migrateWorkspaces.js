import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import Membership from "../models/Membership.js";

/**
 * Idempotently backfills missing workspace types and memberships for existing records.
 * Safe to run against existing databases without wiping data.
 */
export async function backfillWorkspaces() {
  const stats = {
    tenantsUpdated: 0,
    membershipsCreated: 0
  };

  // 1. Backfill workspace type for tenants that lack one
  const tenantResult = await Tenant.updateMany(
    { $or: [{ type: { $exists: false } }, { type: null }] },
    { $set: { type: "organization" } }
  );
  stats.tenantsUpdated = tenantResult.modifiedCount || 0;

  // 2. Ensure every user has an active 'owner' membership for their primary tenantId
  const users = await User.find({ tenantId: { $exists: true, $ne: null } });

  for (const user of users) {
    const existingMembership = await Membership.findOne({
      userId: user._id,
      tenantId: user.tenantId
    });

    if (!existingMembership) {
      await Membership.create({
        userId: user._id,
        tenantId: user.tenantId,
        role: "owner",
        status: "active"
      });
      stats.membershipsCreated += 1;
    }
  }

  return stats;
}
