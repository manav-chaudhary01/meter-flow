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

describe("P2.4 Member Self-Leave Backend API", () => {
  let ownerToken;
  let ownerUserId;
  let orgId;

  let memberToken;
  let memberUserId;
  let memberOrgId;

  let secondaryOrgId;

  before(async () => {
    await connectTestDb();
  });

  after(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();

    // 1. Register Owner (Alice) with Acme Corp
    const regOwner = await request(app).post("/api/auth/register").send({
      name: "Alice Owner",
      email: "owner@example.com",
      password: "Password123!",
      organizationName: "Acme Corp"
    });
    ownerToken = regOwner.body.data.token;
    ownerUserId = regOwner.body.data.user.id;
    orgId = regOwner.body.data.tenant.id;

    // 2. Register Regular Member (Bob) with Bob Personal Org
    const regMember = await request(app).post("/api/auth/register").send({
      name: "Bob Member",
      email: "bob@example.com",
      password: "Password123!",
      organizationName: "Bob Personal Org"
    });
    memberUserId = regMember.body.data.user.id;
    memberOrgId = regMember.body.data.tenant.id;

    // Add Bob to Alice's Acme Corp as regular member
    await request(app)
      .post(`/api/workspaces/${orgId}/members`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        email: "bob@example.com",
        role: "member"
      });

    // Bob switches active context to Acme Corp
    const switchRes = await request(app)
      .post("/api/workspaces/switch")
      .set("Authorization", `Bearer ${regMember.body.data.token}`)
      .send({ workspaceId: orgId });
    memberToken = switchRes.body.data.token;

    // 3. Alice also creates a secondary organization workspace
    const secRes = await request(app)
      .post("/api/workspaces")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Acme Secondary",
        type: "organization"
      });
    secondaryOrgId = secRes.body.data.workspace.id;
  });

  it("1. Member leaves workspace -> 200 OK with valid response payload", async () => {
    const res = await request(app)
      .post(`/api/workspaces/${orgId}/leave`)
      .set("Authorization", `Bearer ${memberToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.message, "Left workspace successfully");
    assert.equal(res.body.data.leftWorkspaceId, orgId);
    assert.equal(res.body.data.switched, true);
    assert.equal(res.body.data.activeWorkspace.id, memberOrgId);
    assert.ok(res.body.data.token, "Should issue a new token");
  });

  it("2. User's membership in the departed workspace is removed from database", async () => {
    const res = await request(app)
      .post(`/api/workspaces/${orgId}/leave`)
      .set("Authorization", `Bearer ${memberToken}`);

    assert.equal(res.status, 200);

    const departedMembership = await Membership.findOne({
      userId: memberUserId,
      tenantId: orgId
    });
    assert.equal(departedMembership, null, "Departed membership should be completely removed");
  });

  it("3. User record remains intact after leaving workspace", async () => {
    const userBefore = await User.findById(memberUserId);
    assert.ok(userBefore);

    const res = await request(app)
      .post(`/api/workspaces/${orgId}/leave`)
      .set("Authorization", `Bearer ${memberToken}`);

    assert.equal(res.status, 200);

    const userAfter = await User.findById(memberUserId);
    assert.ok(userAfter, "User must not be deleted");
    assert.equal(userAfter.name, userBefore.name);
    assert.equal(userAfter.email, userBefore.email);
    assert.equal(userAfter.passwordHash, userBefore.passwordHash);
  });

  it("4. Workspace owner cannot leave -> 403 Forbidden", async () => {
    // Alice has 2 workspaces (Acme Corp and Acme Secondary), but is owner of Acme Corp
    const res = await request(app)
      .post(`/api/workspaces/${orgId}/leave`)
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /owner/i);

    // Verify owner membership remains active
    const ownerMembership = await Membership.findOne({
      userId: ownerUserId,
      tenantId: orgId
    });
    assert.ok(ownerMembership);
    assert.equal(ownerMembership.role, "owner");
    assert.equal(ownerMembership.status, "active");
  });

  it("5. Only active workspace cannot be left -> 409 Conflict", async () => {
    // Register Charlie who belongs only to Charlie Org
    const regCharlie = await request(app).post("/api/auth/register").send({
      name: "Charlie Solo",
      email: "charlie@example.com",
      password: "Password123!",
      organizationName: "Charlie Org"
    });
    const charlieToken = regCharlie.body.data.token;
    const charlieOrgId = regCharlie.body.data.tenant.id;
    const charlieUserId = regCharlie.body.data.user.id;

    // Charlie attempts to leave his only active workspace
    const res = await request(app)
      .post(`/api/workspaces/${charlieOrgId}/leave`)
      .set("Authorization", `Bearer ${charlieToken}`);

    // Since Charlie is owner of Charlie Org, it will hit owner 403 or last-workspace 409.
    // Let's also test when Charlie is made a regular member of someone else's workspace,
    // but has deleted or left all others, so only 1 active membership remains as non-owner.
    // For this test, Charlie is owner of Charlie Org -> 403.
    // Now let's test a non-owner with exactly 1 workspace:
    // Create David, add David to Alice's org, then remove David's initial org membership
    const regDavid = await request(app).post("/api/auth/register").send({
      name: "David OneOrg",
      email: "david@example.com",
      password: "Password123!",
      organizationName: "David Temp Org"
    });
    const davidUserId = regDavid.body.data.user.id;
    const davidTempOrgId = regDavid.body.data.tenant.id;

    // Add David to Acme Corp as member
    await request(app)
      .post(`/api/workspaces/${orgId}/members`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "david@example.com", role: "member" });

    // Switch David to Acme Corp
    const davidSwitch = await request(app)
      .post("/api/workspaces/switch")
      .set("Authorization", `Bearer ${regDavid.body.data.token}`)
      .send({ workspaceId: orgId });
    const davidTokenAcme = davidSwitch.body.data.token;

    // Remove David's temp org membership so David has ONLY Acme Corp as active membership
    await Membership.deleteOne({ userId: davidUserId, tenantId: davidTempOrgId });
    await Tenant.deleteOne({ _id: davidTempOrgId });

    // Verify David has exactly 1 active membership
    const davidMemberships = await Membership.find({ userId: davidUserId, status: "active" });
    assert.equal(davidMemberships.length, 1);

    // David attempts self-leave on Acme Corp (his only active workspace)
    const leaveRes = await request(app)
      .post(`/api/workspaces/${orgId}/leave`)
      .set("Authorization", `Bearer ${davidTokenAcme}`);

    assert.equal(leaveRes.status, 409);
    assert.equal(leaveRes.body.success, false);
    assert.match(leaveRes.body.message, /only active workspace/i);

    // Verify David's membership remains
    const davidAfter = await Membership.findOne({ userId: davidUserId, tenantId: orgId });
    assert.ok(davidAfter);
    assert.equal(davidAfter.status, "active");

    // Verify David's tenantId pointer remains intact
    const davidUserAfter = await User.findById(davidUserId);
    assert.equal(davidUserAfter.tenantId.toString(), orgId.toString());
  });

  it("6. User with two workspaces can leave current workspace", async () => {
    // Bob has Bob Personal Org and Acme Corp. Currently in Acme Corp.
    const res = await request(app)
      .post(`/api/workspaces/${orgId}/leave`)
      .set("Authorization", `Bearer ${memberToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.switched, true);
  });

  it("7. Leaving current workspace updates User.tenantId to valid fallback", async () => {
    const userBefore = await User.findById(memberUserId);
    assert.equal(userBefore.tenantId.toString(), orgId.toString());

    const res = await request(app)
      .post(`/api/workspaces/${orgId}/leave`)
      .set("Authorization", `Bearer ${memberToken}`);

    assert.equal(res.status, 200);

    const userAfter = await User.findById(memberUserId);
    assert.equal(userAfter.tenantId.toString(), memberOrgId.toString());
    assert.notEqual(userAfter.tenantId, null);
  });

  it("8. Fresh authentication/session context points to fallback workspace", async () => {
    const res = await request(app)
      .post(`/api/workspaces/${orgId}/leave`)
      .set("Authorization", `Bearer ${memberToken}`);

    assert.equal(res.status, 200);
    const newToken = res.body.data.token;
    assert.ok(newToken);

    // Decode token and verify tenantId
    const decoded = jwt.verify(newToken, process.env.JWT_SECRET);
    assert.equal(decoded.userId, memberUserId.toString());
    assert.equal(decoded.tenantId, memberOrgId.toString());

    // Use token to call /api/auth/me
    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${newToken}`);

    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.data.tenantId, memberOrgId.toString());
  });

  it("9. Leaving non-current workspace preserves current User.tenantId", async () => {
    // Bob switches back to Bob Personal Org
    const switchBack = await request(app)
      .post("/api/workspaces/switch")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ workspaceId: memberOrgId });

    const bobPersonalToken = switchBack.body.data.token;
    const userBefore = await User.findById(memberUserId);
    assert.equal(userBefore.tenantId.toString(), memberOrgId.toString());

    // Bob leaves Acme Corp (which is NOT his current active workspace)
    const res = await request(app)
      .post(`/api/workspaces/${orgId}/leave`)
      .set("Authorization", `Bearer ${bobPersonalToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.switched, false);
    assert.equal(res.body.data.activeWorkspace.id, memberOrgId.toString());

    // User.tenantId must remain memberOrgId
    const userAfter = await User.findById(memberUserId);
    assert.equal(userAfter.tenantId.toString(), memberOrgId.toString());
  });

  it("10. Other memberships remain completely unchanged", async () => {
    const memberOrgMembershipBefore = await Membership.findOne({
      userId: memberUserId,
      tenantId: memberOrgId
    });
    assert.ok(memberOrgMembershipBefore);

    const res = await request(app)
      .post(`/api/workspaces/${orgId}/leave`)
      .set("Authorization", `Bearer ${memberToken}`);

    assert.equal(res.status, 200);

    const memberOrgMembershipAfter = await Membership.findOne({
      userId: memberUserId,
      tenantId: memberOrgId
    });
    assert.ok(memberOrgMembershipAfter);
    assert.equal(memberOrgMembershipAfter.role, memberOrgMembershipBefore.role);
    assert.equal(memberOrgMembershipAfter.status, memberOrgMembershipBefore.status);
    assert.equal(
      memberOrgMembershipAfter.createdAt.toISOString(),
      memberOrgMembershipBefore.createdAt.toISOString()
    );
  });

  it("11. Cross-tenant attempt is rejected -> 403 Forbidden", async () => {
    // Create random nonexistent/unjoined tenant
    const foreignTenant = await Tenant.create({
      name: "Foreign Corp",
      type: "organization",
      createdBy: new mongoose.Types.ObjectId()
    });

    const res = await request(app)
      .post(`/api/workspaces/${foreignTenant._id}/leave`)
      .set("Authorization", `Bearer ${memberToken}`);

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /not a member/i);
  });

  it("12. Unauthenticated request -> 401 Unauthorized", async () => {
    const res = await request(app).post(`/api/workspaces/${orgId}/leave`);

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  it("13. Suspended user cannot bypass suspension to leave", async () => {
    // Suspend Bob in Acme Corp
    await request(app)
      .patch(`/api/workspaces/${orgId}/members/${memberUserId}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "suspended" });

    // Attempt to leave using Acme Corp token -> blocked by authMiddleware (403)
    const resWithAcmeToken = await request(app)
      .post(`/api/workspaces/${orgId}/leave`)
      .set("Authorization", `Bearer ${memberToken}`);

    assert.equal(resWithAcmeToken.status, 403);
    assert.match(resWithAcmeToken.body.message, /suspended|inactive/i);

    // Switch Bob's token context using Bob's personal org (not suspended there)
    const bobPersonalLogin = await request(app).post("/api/auth/login").send({
      email: "bob@example.com",
      password: "Password123!"
    });
    const bobPersonalToken = bobPersonalLogin.body.data.token;

    // Attempt to leave suspended Acme Corp using personal token -> rejected by leave endpoint (403)
    const resWithPersonalToken = await request(app)
      .post(`/api/workspaces/${orgId}/leave`)
      .set("Authorization", `Bearer ${bobPersonalToken}`);

    assert.equal(resWithPersonalToken.status, 403);
    assert.match(resWithPersonalToken.body.message, /suspended|inactive/i);
  });

  it("14. Billing records remain unchanged after member leaves", async () => {
    // Create service & bill in Acme Corp
    const srv = await TrackedService.create({
      tenantId: orgId,
      name: "Compute Node",
      category: "compute",
      trackingType: "metered",
      unit: "hours",
      unitPrice: "0.10",
      status: "active"
    });

    const bill = await BillingRecord.create({
      tenantId: orgId,
      invoiceNumber: "INV-SELF-LEAVE-001",
      billingPeriodStart: new Date("2026-01-01"),
      billingPeriodEnd: new Date("2026-01-31"),
      currency: "USD",
      lineItems: [
        {
          serviceId: srv._id,
          serviceName: "Compute Node",
          chargeType: "usage",
          description: "Compute Node usage",
          quantity: 100,
          unitPrice: "0.10",
          amount: "10.00"
        }
      ],
      subtotal: "10.00",
      total: "10.00",
      status: "issued",
      generatedAt: new Date(),
      generatedBy: ownerUserId
    });

    // Bob leaves
    const res = await request(app)
      .post(`/api/workspaces/${orgId}/leave`)
      .set("Authorization", `Bearer ${memberToken}`);

    assert.equal(res.status, 200);

    const billAfter = await BillingRecord.findById(bill._id);
    assert.ok(billAfter);
    assert.equal(billAfter.invoiceNumber, "INV-SELF-LEAVE-001");
    assert.equal(billAfter.total.toString(), "10.00");
  });

  it("15. Usage records remain unchanged after member leaves", async () => {
    const srv = await TrackedService.create({
      tenantId: orgId,
      name: "API Calls",
      category: "api",
      trackingType: "metered",
      unit: "requests",
      unitPrice: "0.001",
      status: "active"
    });

    const usage = await UsageRecord.create({
      tenantId: orgId,
      serviceId: srv._id,
      quantity: 500,
      unit: "requests",
      occurredAt: new Date(),
      idempotencyKey: "usage-bob-leave-001",
      source: "api"
    });

    const res = await request(app)
      .post(`/api/workspaces/${orgId}/leave`)
      .set("Authorization", `Bearer ${memberToken}`);

    assert.equal(res.status, 200);

    const usageAfter = await UsageRecord.findById(usage._id);
    assert.ok(usageAfter);
    assert.equal(usageAfter.quantity.toString(), "500");
    assert.equal(usageAfter.idempotencyKey, "usage-bob-leave-001");
  });

  it("16. Services remain unchanged after member leaves", async () => {
    const srv = await TrackedService.create({
      tenantId: orgId,
      name: "Database Storage",
      category: "storage",
      trackingType: "metered",
      unit: "GB",
      unitPrice: "0.05",
      status: "active"
    });

    const res = await request(app)
      .post(`/api/workspaces/${orgId}/leave`)
      .set("Authorization", `Bearer ${memberToken}`);

    assert.equal(res.status, 200);

    const srvAfter = await TrackedService.findById(srv._id);
    assert.ok(srvAfter);
    assert.equal(srvAfter.status, "active");
    assert.equal(srvAfter.name, "Database Storage");
  });

  it("17. Budgets remain unchanged after member leaves", async () => {
    const budget = await Budget.create({
      tenantId: orgId,
      name: "Q1 Operations Budget",
      amount: "5000.00",
      currency: "USD",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-03-31"),
      thresholds: [50, 80, 100],
      status: "active",
      createdBy: ownerUserId
    });

    const res = await request(app)
      .post(`/api/workspaces/${orgId}/leave`)
      .set("Authorization", `Bearer ${memberToken}`);

    assert.equal(res.status, 200);

    const budgetAfter = await Budget.findById(budget._id);
    assert.ok(budgetAfter);
    assert.equal(budgetAfter.name, "Q1 Operations Budget");
    assert.equal(budgetAfter.status, "active");
  });

  it("18. Historical membership-independent data remains intact", async () => {
    const tenantBefore = await Tenant.findById(orgId);
    assert.ok(tenantBefore);

    const res = await request(app)
      .post(`/api/workspaces/${orgId}/leave`)
      .set("Authorization", `Bearer ${memberToken}`);

    assert.equal(res.status, 200);

    const tenantAfter = await Tenant.findById(orgId);
    assert.ok(tenantAfter, "Tenant must never be deleted by self-leave");
    assert.equal(tenantAfter.name, tenantBefore.name);
    assert.equal(tenantAfter.type, tenantBefore.type);
    assert.equal(tenantAfter.createdBy.toString(), tenantBefore.createdBy.toString());
  });

  it("19. Concurrent leave requests cannot violate the last-active-workspace invariant", async () => {
    // Frank has exactly 2 workspaces: frankWs1 and frankWs2
    const regFrank = await request(app).post("/api/auth/register").send({
      name: "Frank Concurrency",
      email: "frank@example.com",
      password: "Password123!",
      organizationName: "Frank WS 1"
    });
    const frankUserId = regFrank.body.data.user.id;
    const frankWs1Id = regFrank.body.data.tenant.id;

    // Add Frank to Alice's Acme Corp as member (Frank's 2nd workspace)
    await request(app)
      .post(`/api/workspaces/${orgId}/members`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "frank@example.com", role: "member" });

    // Frank also creates a 2nd organization where he is member
    const frankWs2Res = await request(app)
      .post("/api/workspaces")
      .set("Authorization", `Bearer ${regFrank.body.data.token}`)
      .send({ name: "Frank WS 2", type: "organization" });
    const frankWs2Id = frankWs2Res.body.data.workspace.id;

    // Demote Frank in frankWs1 & frankWs2 or remove temp so Frank is regular member of Acme Corp and another org
    // To test non-owner self-leave concurrency cleanly:
    // Create 2 shared workspaces owned by Alice, add Frank to both as member, remove Frank from his created orgs
    const wsA = await Tenant.create({ name: "Shared WS A", type: "organization", createdBy: ownerUserId });
    const wsB = await Tenant.create({ name: "Shared WS B", type: "organization", createdBy: ownerUserId });

    await Membership.deleteMany({ userId: frankUserId });
    await Membership.create({ userId: frankUserId, tenantId: wsA._id, role: "member", status: "active" });
    await Membership.create({ userId: frankUserId, tenantId: wsB._id, role: "member", status: "active" });

    // Set Frank's active tenant to wsA
    await User.findByIdAndUpdate(frankUserId, { tenantId: wsA._id });

    // Frank token scoped to wsA
    const frankTokenA = jwt.sign(
      { userId: frankUserId.toString(), tenantId: wsA._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    // Issue two simultaneous leave requests for wsA and wsB
    const [resA, resB] = await Promise.all([
      request(app).post(`/api/workspaces/${wsA._id}/leave`).set("Authorization", `Bearer ${frankTokenA}`),
      request(app).post(`/api/workspaces/${wsB._id}/leave`).set("Authorization", `Bearer ${frankTokenA}`)
    ]);

    const statuses = [resA.status, resB.status];
    // Exactly one should succeed (200), and the other must be rejected with 409 Conflict
    assert.ok(statuses.includes(200), "One concurrent leave request should succeed (200)");
    assert.ok(statuses.includes(409), "The other concurrent request must be rejected (409)");

    // Invariant: Frank must retain exactly 1 active membership
    const frankRemainingMemberships = await Membership.find({ userId: frankUserId, status: "active" });
    assert.equal(
      frankRemainingMemberships.length,
      1,
      "Frank must have exactly 1 active membership remaining"
    );

    // User.tenantId must not be null and must match the remaining membership
    const frankUser = await User.findById(frankUserId);
    assert.ok(frankUser.tenantId);
    assert.equal(frankUser.tenantId.toString(), frankRemainingMemberships[0].tenantId.toString());
  });

  it("20. Fallback workspace is active and fully accessible with newly issued token", async () => {
    const res = await request(app)
      .post(`/api/workspaces/${orgId}/leave`)
      .set("Authorization", `Bearer ${memberToken}`);

    assert.equal(res.status, 200);
    const newToken = res.body.data.token;

    // Call /api/workspaces with new token
    const wsRes = await request(app)
      .get("/api/workspaces")
      .set("Authorization", `Bearer ${newToken}`);

    assert.equal(wsRes.status, 200);
    const activeWs = wsRes.body.data.workspaces.find((w) => w.isCurrent);
    assert.ok(activeWs);
    assert.equal(activeWs.id, memberOrgId.toString());

    // Verify left workspace is NOT in user's workspace list
    const leftWs = wsRes.body.data.workspaces.find((w) => w.id === orgId.toString());
    assert.equal(leftWs, undefined, "Left workspace should no longer be accessible");
  });
});
