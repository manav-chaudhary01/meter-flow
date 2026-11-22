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

describe("P2.3 Member Suspension & Reactivation Backend API", () => {
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

  it("1. Owner suspends member -> 200", async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "suspended" });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.member.status, "suspended");
    assert.equal(res.body.data.member.userId, memberUserId);

    const m = await Membership.findOne({ tenantId: orgId, userId: memberUserId });
    assert.equal(m.status, "suspended");
  });

  it("2. Owner reactivates member -> 200", async () => {
    // First suspend
    await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "suspended" });

    // Reactivate
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "active" });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.member.status, "active");

    const m = await Membership.findOne({ tenantId: orgId, userId: memberUserId });
    assert.equal(m.status, "active");
  });

  it("3. Admin suspends regular member -> 200", async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "suspended" });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.member.status, "suspended");

    const m = await Membership.findOne({ tenantId: orgId, userId: memberUserId });
    assert.equal(m.status, "suspended");
  });

  it("4. Admin reactivates regular member -> 200", async () => {
    // Suspend
    await Membership.updateOne({ tenantId: orgId, userId: memberUserId }, { status: "suspended" });

    const res = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.member.status, "active");

    const m = await Membership.findOne({ tenantId: orgId, userId: memberUserId });
    assert.equal(m.status, "active");
  });

  it("5. Member attempts suspension -> 403 Forbidden", async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${adminUserId}/status`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ status: "suspended" });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /only workspace owners and admins/i);

    const m = await Membership.findOne({ tenantId: orgId, userId: adminUserId });
    assert.equal(m.status, "active");
  });

  it("6. Member attempts reactivation -> 403 Forbidden", async () => {
    await Membership.updateOne({ tenantId: orgId, userId: adminUserId }, { status: "suspended" });

    const res = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${adminUserId}/status`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ status: "active" });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /only workspace owners and admins/i);
  });

  it("7. Unauthenticated request -> 401 Unauthorized", async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/status`)
      .send({ status: "suspended" });

    assert.equal(res.status, 401);
  });

  it("8. Cross-tenant suspension -> 403 Forbidden", async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/status`)
      .set("Authorization", `Bearer ${userBToken}`)
      .send({ status: "suspended" });

    assert.equal(res.status, 403);
  });

  it("9. Nonexistent member -> 404 Not Found", async () => {
    const randomId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${randomId}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "suspended" });

    assert.equal(res.status, 404);
    assert.match(res.body.message, /membership not found/i);
  });

  it("10. Invalid status -> 400 Bad Request", async () => {
    const emptyRes = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "" });
    assert.equal(emptyRes.status, 400);

    const invalidRes = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "archived" });
    assert.equal(invalidRes.status, 400);

    const roleRes = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "admin" });
    assert.equal(roleRes.status, 400);

    const nonStringRes = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: 123 });
    assert.equal(nonStringRes.status, 400);
  });

  it("11. Owner suspension attempt -> 403 Forbidden", async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${ownerUserId}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "suspended" });

    assert.equal(res.status, 403);
    assert.match(res.body.message, /owner cannot be suspended/i);

    const ownerM = await Membership.findOne({ tenantId: orgId, userId: ownerUserId });
    assert.equal(ownerM.status, "active");
  });

  it("12. Owner reactivation attempt through this endpoint -> 403 Forbidden", async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${ownerUserId}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "active" });

    assert.equal(res.status, 403);
    assert.match(res.body.message, /owner cannot be suspended/i);
  });

  it("13. Self-suspension -> 403 Forbidden", async () => {
    // Admin trying to suspend self
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${adminUserId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "suspended" });

    assert.equal(res.status, 403);
    assert.match(res.body.message, /cannot modify their own/i);

    const adminM = await Membership.findOne({ tenantId: orgId, userId: adminUserId });
    assert.equal(adminM.status, "active");
  });

  it("14. Suspension preserves role", async () => {
    // Member suspension preserves 'member' role
    const resMember = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "suspended" });

    assert.equal(resMember.status, 200);
    assert.equal(resMember.body.data.member.role, "member");
    assert.equal(resMember.body.data.member.status, "suspended");

    const mMember = await Membership.findOne({ tenantId: orgId, userId: memberUserId });
    assert.equal(mMember.role, "member");
    assert.equal(mMember.status, "suspended");

    // Admin suspension preserves 'admin' role
    const resAdmin = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${adminUserId}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "suspended" });

    assert.equal(resAdmin.status, 200);
    assert.equal(resAdmin.body.data.member.role, "admin");
    assert.equal(resAdmin.body.data.member.status, "suspended");

    const mAdmin = await Membership.findOne({ tenantId: orgId, userId: adminUserId });
    assert.equal(mAdmin.role, "admin");
    assert.equal(mAdmin.status, "suspended");
  });

  it("15. Reactivation restores the same role", async () => {
    await Membership.updateOne({ tenantId: orgId, userId: memberUserId }, { status: "suspended", role: "member" });
    await Membership.updateOne({ tenantId: orgId, userId: adminUserId }, { status: "suspended", role: "admin" });

    const resMember = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "active" });
    assert.equal(resMember.status, 200);
    assert.equal(resMember.body.data.member.role, "member");
    assert.equal(resMember.body.data.member.status, "active");

    const resAdmin = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${adminUserId}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "active" });
    assert.equal(resAdmin.status, 200);
    assert.equal(resAdmin.body.data.member.role, "admin");
    assert.equal(resAdmin.body.data.member.status, "active");
  });

  it("16. Suspended member cannot access protected workspace API with existing JWT", async () => {
    // Before suspension, member has working access
    const beforeRes = await request(app)
      .get("/api/services")
      .set("Authorization", `Bearer ${memberToken}`);
    assert.equal(beforeRes.status, 200);

    // Owner suspends member
    const suspendRes = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "suspended" });
    assert.equal(suspendRes.status, 200);

    // Immediate attempt by member using existing JWT must be denied
    const afterRes = await request(app)
      .get("/api/services")
      .set("Authorization", `Bearer ${memberToken}`);
    assert.equal(afterRes.status, 403);
    assert.match(afterRes.body.message, /suspended or inactive/i);
  });

  it("17. Reactivated member can access protected workspace API again", async () => {
    // Suspend member
    await Membership.updateOne({ tenantId: orgId, userId: memberUserId }, { status: "suspended" });

    // Verify denied
    const deniedRes = await request(app)
      .get("/api/services")
      .set("Authorization", `Bearer ${memberToken}`);
    assert.equal(deniedRes.status, 403);

    // Owner reactivates member
    const reactivateRes = await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "active" });
    assert.equal(reactivateRes.status, 200);

    // Access restored with same JWT
    const restoredRes = await request(app)
      .get("/api/services")
      .set("Authorization", `Bearer ${memberToken}`);
    assert.equal(restoredRes.status, 200);
  });

  it("18. User record remains intact", async () => {
    const userBefore = await User.findById(memberUserId).lean();

    await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "suspended" });

    const userAfter = await User.findById(memberUserId).lean();
    assert.equal(userAfter.email, userBefore.email);
    assert.equal(userAfter.name, userBefore.name);
    assert.equal(userAfter.tenantId ? userAfter.tenantId.toString() : null, userBefore.tenantId ? userBefore.tenantId.toString() : null);
  });

  it("19. Billing and usage records remain unchanged after suspension/reactivation", async () => {
    const service = await TrackedService.create({
      tenantId: orgId,
      name: "Compute Node",
      provider: "Cloud",
      category: "compute",
      trackingType: "metered",
      unit: "hours",
      unitPrice: "0.10",
      status: "active"
    });

    const usage = await UsageRecord.create({
      tenantId: orgId,
      serviceId: service._id,
      quantity: 50,
      unit: "hours",
      occurredAt: new Date("2026-11-12T10:00:00Z"),
      source: "manual"
    });

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

    const invoiceBefore = await BillingRecord.findById(invoiceId);
    const usageBefore = await UsageRecord.findById(usage._id);

    // Suspend member
    await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "suspended" });

    // Reactivate member
    await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "active" });

    const invoiceAfter = await BillingRecord.findById(invoiceId);
    const usageAfter = await UsageRecord.findById(usage._id);

    assert.equal(invoiceAfter.total.toString(), invoiceBefore.total.toString());
    assert.equal(invoiceAfter.invoiceNumber, invoiceBefore.invoiceNumber);
    assert.equal(invoiceAfter.tenantId.toString(), orgId.toString());
    assert.equal(invoiceAfter.lineItems.length, invoiceBefore.lineItems.length);
    assert.equal(usageAfter.billingRecordId.toString(), usageBefore.billingRecordId.toString());
  });

  it("20. Other memberships remain unchanged", async () => {
    const bobBefore = await Membership.findOne({ tenantId: orgId, userId: adminUserId });
    const ownerBefore = await Membership.findOne({ tenantId: orgId, userId: ownerUserId });

    await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "suspended" });

    const bobAfter = await Membership.findOne({ tenantId: orgId, userId: adminUserId });
    const ownerAfter = await Membership.findOne({ tenantId: orgId, userId: ownerUserId });

    assert.equal(bobAfter.status, bobBefore.status);
    assert.equal(bobAfter.role, bobBefore.role);
    assert.equal(ownerAfter.status, ownerBefore.status);
    assert.equal(ownerAfter.role, ownerBefore.role);
  });
});
