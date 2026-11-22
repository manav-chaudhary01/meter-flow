import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import app from "../src/app.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import Tenant from "../src/models/Tenant.js";
import User from "../src/models/User.js";
import Membership from "../src/models/Membership.js";
import TrackedService from "../src/models/TrackedService.js";
import UsageRecord from "../src/models/UsageRecord.js";
import BillingRecord from "../src/models/BillingRecord.js";

describe("P2.2 Member Role Modification Backend API", () => {
  let ownerToken;
  let ownerUserId;
  let orgId;

  let adminToken;
  let adminUserId;

  let memberToken;
  let memberUserId;

  let userBToken;
  let userBOrgId;

  before(async () => {
    await connectTestDb();
  });

  after(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();

    // 1. Register Owner
    const regOwner = await request(app).post("/api/auth/register").send({
      name: "Alice Owner",
      email: "owner@example.com",
      password: "Password123!",
      organizationName: "Acme Corp"
    });
    ownerToken = regOwner.body.data.token;
    ownerUserId = regOwner.body.data.user.id;
    orgId = regOwner.body.data.tenant.id;

    // 2. Register Admin User
    const regAdmin = await request(app).post("/api/auth/register").send({
      name: "Bob Admin",
      email: "admin@example.com",
      password: "Password123!",
      organizationName: "Bob Personal Org"
    });
    adminUserId = regAdmin.body.data.user.id;

    // Add Bob to Alice's org as admin
    await request(app)
      .post(`/api/workspaces/${orgId}/members`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "admin@example.com", role: "admin" });

    // Switch Bob to Alice's org to get admin token
    const switchAdmin = await request(app)
      .post("/api/workspaces/switch")
      .set("Authorization", `Bearer ${regAdmin.body.data.token}`)
      .send({ workspaceId: orgId });
    adminToken = switchAdmin.body.data.token;

    // 3. Register Regular Member User
    const regMember = await request(app).post("/api/auth/register").send({
      name: "Charlie Member",
      email: "member@example.com",
      password: "Password123!",
      organizationName: "Charlie Personal Org"
    });
    memberUserId = regMember.body.data.user.id;

    // Add Charlie to Alice's org as regular member
    await request(app)
      .post(`/api/workspaces/${orgId}/members`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "member@example.com", role: "member" });

    // Switch Charlie to Alice's org to get member token
    const switchMember = await request(app)
      .post("/api/workspaces/switch")
      .set("Authorization", `Bearer ${regMember.body.data.token}`)
      .send({ workspaceId: orgId });
    memberToken = switchMember.body.data.token;

    // 4. Register Tenant B (Unrelated Workspace)
    const regUserB = await request(app).post("/api/auth/register").send({
      name: "Danielle Outsider",
      email: "danielle@example.com",
      password: "Password123!",
      organizationName: "Danielle Org"
    });
    userBToken = regUserB.body.data.token;
    userBOrgId = regUserB.body.data.tenant.id;
  });

  it("1. Owner promotes member -> admin, HTTP 200", async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "admin" });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.member.role, "admin");
    assert.equal(res.body.data.member.userId, memberUserId);

    // Verify in database
    const m = await Membership.findOne({ tenantId: orgId, userId: memberUserId });
    assert.equal(m.role, "admin");
  });

  it("2. Owner demotes admin -> member, HTTP 200", async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${adminUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "member" });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.member.role, "member");
    assert.equal(res.body.data.member.userId, adminUserId);

    // Verify in database
    const m = await Membership.findOne({ tenantId: orgId, userId: adminUserId });
    assert.equal(m.role, "member");
  });

  it("3. Admin attempts role change -> 403 Forbidden", async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/role`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role: "admin" });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /only workspace owners/i);

    // Verify role in database was unchanged
    const m = await Membership.findOne({ tenantId: orgId, userId: memberUserId });
    assert.equal(m.role, "member");
  });

  it("4. Member attempts role change -> 403 Forbidden", async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${adminUserId}/role`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ role: "member" });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /only workspace owners/i);

    // Verify role in database was unchanged
    const m = await Membership.findOne({ tenantId: orgId, userId: adminUserId });
    assert.equal(m.role, "admin");
  });

  it("5. Unauthenticated request -> 401 Unauthorized", async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/role`)
      .send({ role: "admin" });

    assert.equal(res.status, 401);
  });

  it("6. Cross-tenant role modification -> 403 Forbidden", async () => {
    // Outsider trying to modify member in Alice's org
    const res1 = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/role`)
      .set("Authorization", `Bearer ${userBToken}`)
      .send({ role: "admin" });

    assert.equal(res1.status, 403);

    // Owner trying to modify a member in Danielle's org
    const res2 = await request(app)
      .patch(`/api/workspaces/${userBOrgId}/members/${memberUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "admin" });

    assert.equal(res2.status, 403);
  });

  it("7. Nonexistent member -> 404 Not Found", async () => {
    const randomId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${randomId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "admin" });

    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /membership not found/i);
  });

  it("8. Invalid role -> 400 Bad Request", async () => {
    const emptyRes = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "" });
    assert.equal(emptyRes.status, 400);

    const invalidRes = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "superadmin" });
    assert.equal(invalidRes.status, 400);

    const nonStringRes = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: 123 });
    assert.equal(nonStringRes.status, 400);

    const missingRes = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({});
    assert.equal(missingRes.status, 400);
  });

  it("9. 'owner' role assignment -> 400 Bad Request", async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "owner" });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /cannot assign owner/i);

    // Verify member is not owner
    const m = await Membership.findOne({ tenantId: orgId, userId: memberUserId });
    assert.equal(m.role, "member");
  });

  it("10. Owner cannot be demoted", async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${ownerUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "admin" });

    assert.equal(res.status, 403);
    assert.match(res.body.message, /owner role cannot be modified/i);

    // Verify owner's role in database remains 'owner'
    const m = await Membership.findOne({ tenantId: orgId, userId: ownerUserId });
    assert.equal(m.role, "owner");
  });

  it("11. Existing workspace owner remains unchanged", async () => {
    // Perform multiple valid role modifications
    await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "admin" });

    await request(app)
      .patch(`/api/workspaces/${orgId}/members/${adminUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "member" });

    const ownerM = await Membership.findOne({ tenantId: orgId, userId: ownerUserId });
    assert.equal(ownerM.role, "owner");
    assert.equal(ownerM.status, "active");

    const tenant = await Tenant.findById(orgId);
    assert.equal(tenant.createdBy.toString(), ownerUserId.toString());
  });

  it("12. Existing User.tenantId remains unchanged", async () => {
    const userBefore = await User.findById(memberUserId);
    const originalTenantId = userBefore.tenantId ? userBefore.tenantId.toString() : null;

    await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "admin" });

    const userAfter = await User.findById(memberUserId);
    const afterTenantId = userAfter.tenantId ? userAfter.tenantId.toString() : null;
    assert.equal(afterTenantId, originalTenantId);
  });

  it("13. Existing memberships other than target remain unchanged", async () => {
    const bobBefore = await Membership.findOne({ tenantId: orgId, userId: adminUserId });
    assert.equal(bobBefore.role, "admin");

    // Modify Charlie's role
    await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "admin" });

    // Verify Bob's membership is completely unchanged
    const bobAfter = await Membership.findOne({ tenantId: orgId, userId: adminUserId });
    assert.equal(bobAfter.role, "admin");
    assert.equal(bobAfter.status, "active");
    assert.equal(bobAfter.createdAt.toISOString(), bobBefore.createdAt.toISOString());
  });

  it("14. Billing and usage data remains completely unchanged after role modification", async () => {
    // Create service
    const service = await TrackedService.create({
      tenantId: orgId,
      name: "API Requests",
      provider: "Cloud",
      category: "compute",
      trackingType: "metered",
      unit: "requests",
      unitPrice: "0.05",
      status: "active"
    });

    // Ingest usage
    const usage = await UsageRecord.create({
      tenantId: orgId,
      serviceId: service._id,
      quantity: 1000,
      unit: "requests",
      occurredAt: new Date("2026-11-10T12:00:00Z"),
      source: "manual"
    });

    // Generate invoice
    const genRes = await request(app)
      .post("/api/billing/generate")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        billingPeriodStart: "2026-11-01T00:00:00.000Z",
        billingPeriodEnd: "2026-11-30T23:59:59.000Z",
        currency: "USD"
      });

    assert.equal(genRes.status, 201);
    const invoiceId = genRes.body.data.billingRecord.id;
    const invoiceNumber = genRes.body.data.billingRecord.invoiceNumber;

    const invoiceBefore = await BillingRecord.findById(invoiceId);
    const usageBefore = await UsageRecord.findById(usage._id);

    // Modify member's role
    const patchRes = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "admin" });
    assert.equal(patchRes.status, 200);

    const invoiceAfter = await BillingRecord.findById(invoiceId);
    const usageAfter = await UsageRecord.findById(usage._id);

    assert.equal(invoiceAfter.total.toString(), invoiceBefore.total.toString());
    assert.equal(invoiceAfter.invoiceNumber, invoiceBefore.invoiceNumber);
    assert.equal(invoiceAfter.tenantId.toString(), orgId.toString());
    assert.equal(invoiceAfter.lineItems.length, invoiceBefore.lineItems.length);
    assert.equal(usageAfter.billingRecordId.toString(), usageBefore.billingRecordId.toString());
  });
});
