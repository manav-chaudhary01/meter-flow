import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import Tenant from "../src/models/Tenant.js";
import User from "../src/models/User.js";
import Membership from "../src/models/Membership.js";
import TrackedService from "../src/models/TrackedService.js";
import UsageRecord from "../src/models/UsageRecord.js";
import BillingRecord from "../src/models/BillingRecord.js";
import Budget from "../src/models/Budget.js";

describe("P2.5 Workspace Archive/Deactivation Backend API", () => {
  let ownerToken;
  let ownerUserId;
  let primaryOrgId;

  let secondaryOrgId;

  let adminToken;
  let adminUserId;

  let memberToken;
  let memberUserId;

  before(async () => {
    await connectTestDb();
  });

  after(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();

    // 1. Register Owner (Alice) with Primary Org (Acme Corp)
    const regOwner = await request(app).post("/api/auth/register").send({
      name: "Alice Owner",
      email: "owner@example.com",
      password: "Password123!",
      organizationName: "Acme Corp"
    });
    ownerToken = regOwner.body.data.token;
    ownerUserId = regOwner.body.data.user.id;
    primaryOrgId = regOwner.body.data.tenant.id;

    // 2. Create Secondary Org for Alice (Acme Secondary) so she has >=2 workspaces
    const secRes = await request(app)
      .post("/api/workspaces")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Acme Secondary",
        type: "organization"
      });
    secondaryOrgId = secRes.body.data.workspace.id;

    // 3. Register Admin User (Bob) and add to Acme Corp
    const regAdmin = await request(app).post("/api/auth/register").send({
      name: "Bob Admin",
      email: "bob@example.com",
      password: "Password123!",
      organizationName: "Bob Personal Org"
    });
    adminUserId = regAdmin.body.data.user.id;

    await request(app)
      .post(`/api/workspaces/${primaryOrgId}/members`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        email: "bob@example.com",
        role: "admin"
      });

    const switchAdmin = await request(app)
      .post("/api/workspaces/switch")
      .set("Authorization", `Bearer ${regAdmin.body.data.token}`)
      .send({ workspaceId: primaryOrgId });
    adminToken = switchAdmin.body.data.token;

    // 4. Register Member User (Charlie) and add to Acme Corp
    const regMember = await request(app).post("/api/auth/register").send({
      name: "Charlie Member",
      email: "charlie@example.com",
      password: "Password123!",
      organizationName: "Charlie Personal Org"
    });
    memberUserId = regMember.body.data.user.id;

    await request(app)
      .post(`/api/workspaces/${primaryOrgId}/members`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        email: "charlie@example.com",
        role: "member"
      });

    const switchMember = await request(app)
      .post("/api/workspaces/switch")
      .set("Authorization", `Bearer ${regMember.body.data.token}`)
      .send({ workspaceId: primaryOrgId });
    memberToken = switchMember.body.data.token;
  });

  it("1. owner can archive an active workspace — 200 OK", async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${secondaryOrgId}/archive`)
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.message, "Workspace archived successfully");
    assert.equal(res.body.data.archivedWorkspaceId, secondaryOrgId.toString());
  });

  it("2. admin cannot archive workspace — 403 Forbidden", async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${primaryOrgId}/archive`)
      .set("Authorization", `Bearer ${adminToken}`);

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /only the workspace owner can archive/i);
  });

  it("3. member cannot archive workspace — 403 Forbidden", async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${primaryOrgId}/archive`)
      .set("Authorization", `Bearer ${memberToken}`);

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /only the workspace owner can archive/i);
  });

  it("4. unauthenticated request returns 401 Unauthorized", async () => {
    const res = await request(app).patch(`/api/workspaces/${secondaryOrgId}/archive`);

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  it("5. malformed ID returns 400 Bad Request", async () => {
    const res = await request(app)
      .patch("/api/workspaces/not-a-valid-id/archive")
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /valid workspace ID/i);
  });

  it("6. cross-tenant owner cannot archive another tenant's workspace — 403 Forbidden", async () => {
    // Create an independent third-party user and workspace
    const regOther = await request(app).post("/api/auth/register").send({
      name: "Dave Foreign",
      email: "dave@example.com",
      password: "Password123!",
      organizationName: "Dave Enterprise"
    });
    const foreignTenantId = regOther.body.data.tenant.id;

    // Alice tries to archive Dave's workspace
    const res = await request(app)
      .patch(`/api/workspaces/${foreignTenantId}/archive`)
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /not a member of this workspace/i);
  });

  it("7. archived workspace is marked 'archived' in database", async () => {
    await request(app)
      .patch(`/api/workspaces/${secondaryOrgId}/archive`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const tenant = await Tenant.findById(secondaryOrgId);
    assert.equal(tenant.status, "archived");
  });

  it("8. archivedAt is populated on archived workspace", async () => {
    const beforeTime = new Date(Date.now() - 1000);

    await request(app)
      .patch(`/api/workspaces/${secondaryOrgId}/archive`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const tenant = await Tenant.findById(secondaryOrgId);
    assert.ok(tenant.archivedAt instanceof Date);
    assert.ok(tenant.archivedAt >= beforeTime);
  });

  it("9. archived workspace disappears from active workspace listing", async () => {
    // Initial check: secondaryOrgId appears in list
    const preList = await request(app)
      .get("/api/workspaces")
      .set("Authorization", `Bearer ${ownerToken}`);
    assert.ok(preList.body.data.workspaces.some((w) => w.id === secondaryOrgId.toString()));

    // Archive secondaryOrgId
    await request(app)
      .patch(`/api/workspaces/${secondaryOrgId}/archive`)
      .set("Authorization", `Bearer ${ownerToken}`);

    // Post check: secondaryOrgId is gone from list
    const postList = await request(app)
      .get("/api/workspaces")
      .set("Authorization", `Bearer ${ownerToken}`);
    assert.ok(!postList.body.data.workspaces.some((w) => w.id === secondaryOrgId.toString()));
  });

  it("10. archived workspace cannot be switched into — 403 Forbidden", async () => {
    await request(app)
      .patch(`/api/workspaces/${secondaryOrgId}/archive`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const res = await request(app)
      .post("/api/workspaces/switch")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ workspaceId: secondaryOrgId });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /archived and cannot be activated/i);
  });

  it("11. archived workspace protected endpoints reject access — 403 Forbidden", async () => {
    // Switch to secondaryOrgId first, so owner token is scoped to secondaryOrgId
    const switchRes = await request(app)
      .post("/api/workspaces/switch")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ workspaceId: secondaryOrgId });
    const secondaryToken = switchRes.body.data.token;

    // Archive secondaryOrgId
    await request(app)
      .patch(`/api/workspaces/${secondaryOrgId}/archive`)
      .set("Authorization", `Bearer ${secondaryToken}`);

    // Now try to access /api/services with secondaryToken (scoped to secondaryOrgId)
    const serviceRes = await request(app)
      .get("/api/services")
      .set("Authorization", `Bearer ${secondaryToken}`);

    assert.equal(serviceRes.status, 403);
    assert.equal(serviceRes.body.success, false);
    assert.match(serviceRes.body.message, /workspace is archived or inactive/i);
  });

  it("12. stale JWT scoped to archived workspace is rejected across endpoints", async () => {
    // Generate a stale token directly scoped to secondaryOrgId
    const staleToken = jwt.sign(
      {
        userId: ownerUserId.toString(),
        tenantId: secondaryOrgId.toString()
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    // Archive the workspace
    await request(app)
      .patch(`/api/workspaces/${secondaryOrgId}/archive`)
      .set("Authorization", `Bearer ${ownerToken}`);

    // Verify /api/auth/me rejects stale token
    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${staleToken}`);
    assert.equal(meRes.status, 403);

    // Verify /api/billing rejects stale token
    const billingRes = await request(app)
      .get("/api/billing")
      .set("Authorization", `Bearer ${staleToken}`);
    assert.equal(billingRes.status, 403);

    // Verify /api/usage rejects stale token
    const usageRes = await request(app)
      .get("/api/usage")
      .set("Authorization", `Bearer ${staleToken}`);
    assert.equal(usageRes.status, 403);
  });

  it("13. owner's only active workspace returns 409 Conflict", async () => {
    // Register Solo User (Eve) with exactly one workspace
    const regSolo = await request(app).post("/api/auth/register").send({
      name: "Eve Solo",
      email: "eve@example.com",
      password: "Password123!",
      organizationName: "Eve Only Org"
    });
    const soloToken = regSolo.body.data.token;
    const soloTenantId = regSolo.body.data.tenant.id;

    const res = await request(app)
      .patch(`/api/workspaces/${soloTenantId}/archive`)
      .set("Authorization", `Bearer ${soloToken}`);

    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /cannot archive your only active workspace/i);
  });

  it("14. rejected last-workspace archive leaves state unchanged", async () => {
    const regSolo = await request(app).post("/api/auth/register").send({
      name: "Frank Solo",
      email: "frank@example.com",
      password: "Password123!",
      organizationName: "Frank Only Org"
    });
    const soloToken = regSolo.body.data.token;
    const soloTenantId = regSolo.body.data.tenant.id;

    await request(app)
      .patch(`/api/workspaces/${soloTenantId}/archive`)
      .set("Authorization", `Bearer ${soloToken}`);

    const tenant = await Tenant.findById(soloTenantId);
    assert.equal(tenant.status, "active");
    assert.equal(tenant.archivedAt, null);

    const membership = await Membership.findOne({ tenantId: soloTenantId });
    assert.equal(membership.status, "active");

    const user = await User.findOne({ email: "frank@example.com" });
    assert.equal(user.tenantId.toString(), soloTenantId.toString());
  });

  it("15. archiving current workspace selects an active fallback", async () => {
    // Alice's current workspace is primaryOrgId. Archive primaryOrgId:
    const res = await request(app)
      .patch(`/api/workspaces/${primaryOrgId}/archive`)
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.switched, true);
    assert.ok(res.body.data.token);
    assert.equal(res.body.data.activeWorkspace.id, secondaryOrgId.toString());

    // Verify user record in DB was updated
    const user = await User.findById(ownerUserId);
    assert.equal(user.tenantId.toString(), secondaryOrgId.toString());
  });

  it("16. fallback JWT has the fallback tenant ID", async () => {
    const res = await request(app)
      .patch(`/api/workspaces/${primaryOrgId}/archive`)
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.equal(res.status, 200);
    const decoded = jwt.verify(res.body.data.token, process.env.JWT_SECRET);
    assert.equal(decoded.tenantId, secondaryOrgId.toString());
    assert.equal(decoded.userId, ownerUserId.toString());
  });

  it("17. archiving a non-current workspace preserves current User.tenantId", async () => {
    // Alice's current workspace is primaryOrgId. Archive secondaryOrgId:
    const res = await request(app)
      .patch(`/api/workspaces/${secondaryOrgId}/archive`)
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.switched, false);
    assert.equal(res.body.data.activeWorkspace.id, primaryOrgId.toString());

    const user = await User.findById(ownerUserId);
    assert.equal(user.tenantId.toString(), primaryOrgId.toString());
  });

  it("18. memberships are handled consistently with the authorization model", async () => {
    // Prior to archive, Bob is admin in Acme Corp, Charlie is member
    await request(app)
      .patch(`/api/workspaces/${primaryOrgId}/archive`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const bobMembership = await Membership.findOne({
      userId: adminUserId,
      tenantId: primaryOrgId
    });
    assert.ok(bobMembership);
    assert.equal(bobMembership.role, "admin");

    const charlieMembership = await Membership.findOne({
      userId: memberUserId,
      tenantId: primaryOrgId
    });
    assert.ok(charlieMembership);
    assert.equal(charlieMembership.role, "member");
  });

  it("19. historical BillingRecord documents remain intact after workspace archive", async () => {
    const service = await TrackedService.create({
      tenantId: secondaryOrgId,
      name: "Compute API",
      provider: "AWS",
      category: "compute",
      trackingType: "metered",
      unit: "requests",
      unitPrice: "0.10",
      status: "active"
    });

    // Seed a billing record in secondaryOrgId
    const billingDoc = await BillingRecord.create({
      tenantId: secondaryOrgId,
      invoiceNumber: "INV-2026-TEST-001",
      billingPeriodStart: new Date("2026-01-01"),
      billingPeriodEnd: new Date("2026-02-01"),
      status: "issued",
      currency: "USD",
      subtotal: "100.00",
      total: "100.00",
      lineItems: [
        {
          serviceId: service._id,
          serviceName: service.name,
          description: "Compute API usage",
          chargeType: "usage",
          quantity: "1000",
          unitPrice: "0.10",
          amount: "100.00"
        }
      ]
    });

    await request(app)
      .patch(`/api/workspaces/${secondaryOrgId}/archive`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const billingAfter = await BillingRecord.findById(billingDoc._id);
    assert.ok(billingAfter);
    assert.equal(billingAfter.tenantId.toString(), secondaryOrgId.toString());
    assert.equal(billingAfter.total.toString(), "100.00");
  });

  it("20. historical UsageRecord documents remain intact after workspace archive", async () => {
    const service = await TrackedService.create({
      tenantId: secondaryOrgId,
      name: "Compute Node",
      provider: "AWS",
      category: "compute",
      trackingType: "metered",
      unit: "requests",
      unitPrice: "0.002",
      status: "active"
    });

    const usageDoc = await UsageRecord.create({
      tenantId: secondaryOrgId,
      serviceId: service._id,
      quantity: "500",
      unit: "requests",
      occurredAt: new Date("2026-01-15")
    });

    await request(app)
      .patch(`/api/workspaces/${secondaryOrgId}/archive`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const usageAfter = await UsageRecord.findById(usageDoc._id);
    assert.ok(usageAfter);
    assert.equal(usageAfter.quantity.toString(), "500");
  });

  it("21. services remain intact after workspace archive", async () => {
    const service = await TrackedService.create({
      tenantId: secondaryOrgId,
      name: "Database Cluster",
      provider: "MongoDB Atlas",
      category: "database",
      trackingType: "subscription",
      subscriptionAmount: "50.00",
      currency: "USD",
      status: "active"
    });

    await request(app)
      .patch(`/api/workspaces/${secondaryOrgId}/archive`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const serviceAfter = await TrackedService.findById(service._id);
    assert.ok(serviceAfter);
    assert.equal(serviceAfter.name, "Database Cluster");
  });

  it("22. budgets remain intact after workspace archive", async () => {
    const budget = await Budget.create({
      tenantId: secondaryOrgId,
      name: "Q1 Infrastructure",
      amount: 1000,
      period: "monthly",
      currency: "USD",
      status: "active",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-03-31")
    });

    await request(app)
      .patch(`/api/workspaces/${secondaryOrgId}/archive`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const budgetAfter = await Budget.findById(budget._id);
    assert.ok(budgetAfter);
    assert.equal(budgetAfter.name, "Q1 Infrastructure");
  });

  it("23. repeated archive requests are deterministic and idempotent", async () => {
    // First archive request
    const firstRes = await request(app)
      .patch(`/api/workspaces/${secondaryOrgId}/archive`)
      .set("Authorization", `Bearer ${ownerToken}`);
    assert.equal(firstRes.status, 200);

    const firstArchivedAt = (await Tenant.findById(secondaryOrgId)).archivedAt;

    // Second archive request
    const secondRes = await request(app)
      .patch(`/api/workspaces/${secondaryOrgId}/archive`)
      .set("Authorization", `Bearer ${ownerToken}`);
    assert.equal(secondRes.status, 200);
    assert.equal(secondRes.body.success, true);
    assert.equal(secondRes.body.message, "Workspace is already archived");
    assert.equal(secondRes.body.data.alreadyArchived, true);

    // Verify archivedAt was not overwritten
    const secondArchivedAt = (await Tenant.findById(secondaryOrgId)).archivedAt;
    assert.equal(firstArchivedAt.getTime(), secondArchivedAt.getTime());
  });

  it("24. concurrent archive attempts cannot violate the last-active-workspace invariant", async () => {
    // Register User (Grace) with exactly two workspaces
    const regGrace = await request(app).post("/api/auth/register").send({
      name: "Grace Multi",
      email: "grace@example.com",
      password: "Password123!",
      organizationName: "Grace Org A"
    });
    const graceToken = regGrace.body.data.token;
    const graceOrgA = regGrace.body.data.tenant.id;

    const createB = await request(app)
      .post("/api/workspaces")
      .set("Authorization", `Bearer ${graceToken}`)
      .send({
        name: "Grace Org B",
        type: "organization"
      });
    const graceOrgB = createB.body.data.workspace.id;

    // Fire concurrent archive requests for Org A and Org B
    const [resA, resB] = await Promise.all([
      request(app)
        .patch(`/api/workspaces/${graceOrgA}/archive`)
        .set("Authorization", `Bearer ${graceToken}`),
      request(app)
        .patch(`/api/workspaces/${graceOrgB}/archive`)
        .set("Authorization", `Bearer ${graceToken}`)
    ]);

    const statuses = [resA.status, resB.status].sort();
    // Exactly one must succeed (200) and the other must be rejected (409)
    assert.deepEqual(statuses, [200, 409]);

    // Verify Grace still has exactly one active workspace
    const activeTenants = await Tenant.find({
      _id: { $in: [graceOrgA, graceOrgB] },
      status: "active"
    });
    assert.equal(activeTenants.length, 1);
  });
});
