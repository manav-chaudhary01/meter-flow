import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import Tenant from "../src/models/Tenant.js";
import User from "../src/models/User.js";
import Membership from "../src/models/Membership.js";
import TrackedService from "../src/models/TrackedService.js";
import UsageRecord from "../src/models/UsageRecord.js";
import BillingRecord from "../src/models/BillingRecord.js";

describe("P2.1 Workspace Rename Backend API", () => {
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
      organizationName: "Original Workspace Name"
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

  it("1. Owner can rename workspace — 200", async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Acme Production Cloud" });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.workspace.name, "Acme Production Cloud");
    assert.equal(res.body.data.workspace.id, orgId);
    assert.equal(res.body.data.workspace.role, "owner");

    // Verify in database
    const updated = await Tenant.findById(orgId);
    assert.equal(updated.name, "Acme Production Cloud");
  });

  it("2. Admin can rename workspace — 200", async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Renamed By Admin" });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.workspace.name, "Renamed By Admin");
    assert.equal(res.body.data.workspace.role, "admin");

    const updated = await Tenant.findById(orgId);
    assert.equal(updated.name, "Renamed By Admin");
  });

  it("3. Member receives 403 Forbidden", async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "Member Unauthorized Name" });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /only workspace owners and admins/i);

    // Verify name was not modified in DB
    const unchanged = await Tenant.findById(orgId);
    assert.equal(unchanged.name, "Original Workspace Name");
  });

  it("4. Unauthenticated request receives 401 Unauthorized", async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}`)
      .send({ name: "Unauthenticated Rename" });

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  it("5. Invalid/empty/whitespace name receives 400 Bad Request", async () => {
    // Empty string
    const resEmpty = await request(app)
      .patch(`/api/workspaces/${orgId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "" });

    assert.equal(resEmpty.status, 400);
    assert.equal(resEmpty.body.success, false);

    // Whitespace only
    const resWhitespace = await request(app)
      .patch(`/api/workspaces/${orgId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "    " });

    assert.equal(resWhitespace.status, 400);

    // Missing name field
    const resMissing = await request(app)
      .patch(`/api/workspaces/${orgId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({});

    assert.equal(resMissing.status, 400);

    // Non-string name (e.g. number or object)
    const resType = await request(app)
      .patch(`/api/workspaces/${orgId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: 12345 });

    assert.equal(resType.status, 400);
  });

  it("6. Name shorter than 2 characters receives 400 Bad Request", async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "A" });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /between 2 and 100 characters/i);
  });

  it("7. Name longer than 100 characters receives 400 Bad Request", async () => {
    const longName = "A".repeat(101);
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: longName });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /between 2 and 100 characters/i);
  });

  it("8. Cross-tenant workspace cannot be renamed (403)", async () => {
    // Danielle (Tenant B) attempts to rename Alice's org (Tenant A)
    const res = await request(app)
      .patch(`/api/workspaces/${orgId}`)
      .set("Authorization", `Bearer ${userBToken}`)
      .send({ name: "Malicious Cross-Tenant Rename" });

    assert.equal(res.status, 403);
    assert.match(res.body.message, /not an active member/i);

    const unchanged = await Tenant.findById(orgId);
    assert.equal(unchanged.name, "Original Workspace Name");
  });

  it("9. Workspace _id and immutable attributes remain unchanged", async () => {
    const beforeTenant = await Tenant.findById(orgId);
    const beforeId = beforeTenant._id.toString();
    const beforeCreatedBy = beforeTenant.createdBy.toString();
    const beforeType = beforeTenant.type;

    const res = await request(app)
      .patch(`/api/workspaces/${orgId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "  Trimmed Workspace Name  " });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.workspace.name, "Trimmed Workspace Name");

    const afterTenant = await Tenant.findById(orgId);
    assert.equal(afterTenant._id.toString(), beforeId);
    assert.equal(afterTenant.createdBy.toString(), beforeCreatedBy);
    assert.equal(afterTenant.type, beforeType);
    assert.equal(afterTenant.name, "Trimmed Workspace Name");
  });

  it("10. Existing billing records and reconciled usage remain completely unchanged after rename", async () => {
    // Seed service
    const service = await TrackedService.create({
      tenantId: orgId,
      name: "API Gateway Cluster",
      trackingType: "metered",
      unit: "requests",
      unitPrice: "0.005",
      currency: "USD",
      status: "active"
    });

    // Seed usage
    const usage = await UsageRecord.create({
      tenantId: orgId,
      serviceId: service._id,
      quantity: "1000",
      unit: "requests",
      occurredAt: new Date("2026-11-10T10:00:00Z")
    });

    // Generate billing record
    const billRes = await request(app)
      .post("/api/billing/generate")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        billingPeriodStart: "2026-11-01T00:00:00.000Z",
        billingPeriodEnd: "2026-11-30T23:59:59.000Z",
        currency: "USD"
      });

    assert.equal(billRes.status, 201);
    const invoiceId = billRes.body.data.billingRecord.id;
    const invoiceNumber = billRes.body.data.billingRecord.invoiceNumber;
    const initialTotal = billRes.body.data.billingRecord.total;
    const initialLineItems = billRes.body.data.billingRecord.lineItems;

    // Snapshot billing record from database
    const billBefore = await BillingRecord.findById(invoiceId).lean();

    // RENAME WORKSPACE
    const renameRes = await request(app)
      .patch(`/api/workspaces/${orgId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Acme Enterprises" });

    assert.equal(renameRes.status, 200);

    // Re-fetch billing record from database
    const billAfter = await BillingRecord.findById(invoiceId).lean();

    assert.equal(billAfter.invoiceNumber, invoiceNumber);
    assert.equal(billAfter.total.toString(), initialTotal.toString());
    assert.equal(billAfter.subtotal.toString(), billBefore.subtotal.toString());
    assert.equal(billAfter.lineItems.length, initialLineItems.length);
    assert.equal(billAfter.lineItems[0].serviceName, "API Gateway Cluster");
    assert.equal(billAfter.lineItems[0].amount.toString(), billBefore.lineItems[0].amount.toString());
    assert.equal(billAfter.lineItems[0].usageRecordCount, 1);
    assert.equal(billAfter.lineItems[0].usageRecordIds[0].toString(), usage._id.toString());

    // Reconciled usage check
    const usageAfter = await UsageRecord.findById(usage._id);
    assert.equal(usageAfter.billingRecordId.toString(), invoiceId);
    assert.equal(usageAfter.tenantId.toString(), orgId);
  });

  it("11. Existing memberships remain unchanged", async () => {
    const membershipsBefore = await Membership.find({ tenantId: orgId }).sort({ role: 1 }).lean();
    assert.equal(membershipsBefore.length, 3); // owner, admin, member

    await request(app)
      .patch(`/api/workspaces/${orgId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Updated Workspace Brand" });

    const membershipsAfter = await Membership.find({ tenantId: orgId }).sort({ role: 1 }).lean();
    assert.equal(membershipsAfter.length, 3);
    for (let i = 0; i < membershipsBefore.length; i++) {
      assert.equal(membershipsAfter[i]._id.toString(), membershipsBefore[i]._id.toString());
      assert.equal(membershipsAfter[i].userId.toString(), membershipsBefore[i].userId.toString());
      assert.equal(membershipsAfter[i].role, membershipsBefore[i].role);
      assert.equal(membershipsAfter[i].status, membershipsBefore[i].status);
    }
  });

  it("12. Existing User.tenantId remains unchanged", async () => {
    const userBefore = await User.findById(ownerUserId);
    assert.equal(userBefore.tenantId.toString(), orgId);

    await request(app)
      .patch(`/api/workspaces/${orgId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Brand New Org Name" });

    const userAfter = await User.findById(ownerUserId);
    assert.equal(userAfter.tenantId.toString(), orgId);
  });
});
