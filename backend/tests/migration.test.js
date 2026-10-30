import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import Tenant from "../src/models/Tenant.js";
import User from "../src/models/User.js";
import Membership from "../src/models/Membership.js";
import { backfillWorkspaces } from "../src/utils/migrateWorkspaces.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";

describe("Database Migration & Backfill Verification", () => {
  before(async () => {
    await connectTestDb();
  });

  after(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  it("should backfill missing workspace types and create missing owner memberships", async () => {
    // 1. Manually insert legacy tenant without 'type' field using native MongoDB collection
    const tenantInsert = await Tenant.collection.insertOne({
      name: "Legacy Organization",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const legacyTenantId = tenantInsert.insertedId;

    // 2. Manually insert legacy user without any Membership record
    const userInsert = await User.collection.insertOne({
      tenantId: legacyTenantId,
      name: "Legacy User",
      email: "legacy@example.com",
      passwordHash: "$2a$12$e8p2HjQ1Q...",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const legacyUserId = userInsert.insertedId;

    // Verify initial legacy state
    const preTenant = await Tenant.collection.findOne({ _id: legacyTenantId });
    assert.equal(preTenant.type, undefined);

    const preMembership = await Membership.findOne({ userId: legacyUserId, tenantId: legacyTenantId });
    assert.equal(preMembership, null);

    // 3. Execute backfill migration
    const stats1 = await backfillWorkspaces();
    assert.equal(stats1.tenantsUpdated, 1);
    assert.equal(stats1.membershipsCreated, 1);

    // 4. Verify post-migration state
    const postTenant = await Tenant.findById(legacyTenantId);
    assert.equal(postTenant.type, "organization");

    const postMembership = await Membership.findOne({ userId: legacyUserId, tenantId: legacyTenantId });
    assert.ok(postMembership);
    assert.equal(postMembership.role, "owner");
    assert.equal(postMembership.status, "active");

    // 5. Test idempotency: running migration a second time should make 0 changes
    const stats2 = await backfillWorkspaces();
    assert.equal(stats2.tenantsUpdated, 0);
    assert.equal(stats2.membershipsCreated, 0);
  });
});
