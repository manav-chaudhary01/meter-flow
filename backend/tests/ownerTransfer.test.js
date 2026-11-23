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

describe("P3.2 Workspace Owner Transfer Backend API", () => {
  let ownerToken;
  let ownerUserId;
  let tenantId;

  let adminToken;
  let adminUserId;

  let memberToken;
  let memberUserId;

  let suspendedMemberUserId;

  let foreignTenantId;
  let foreignOwnerToken;
  let foreignUserId;

  let testService;

  before(async () => {
    await connectTestDb();
  });

  after(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();

    // 1. Register Owner (Alice) with primary organization workspace
    const regOwner = await request(app).post("/api/auth/register").send({
      name: "Alice Owner",
      email: "owner@example.com",
      password: "Password123!",
      organizationName: "Acme Corp"
    });
    ownerToken = regOwner.body.data.token;
    ownerUserId = regOwner.body.data.user.id;
    tenantId = regOwner.body.data.tenant.id;

    // 2. Register Bob (Admin in Acme Corp)
    const regBob = await request(app).post("/api/auth/register").send({
      name: "Bob Admin",
      email: "bob@example.com",
      password: "Password123!",
      organizationName: "Bob Corp"
    });
    adminUserId = regBob.body.data.user.id;

    await request(app)
      .post(`/api/workspaces/${tenantId}/members`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "bob@example.com", role: "admin" });

    const bobSwitch = await request(app)
      .post("/api/workspaces/switch")
      .set("Authorization", `Bearer ${regBob.body.data.token}`)
      .send({ workspaceId: tenantId });
    adminToken = bobSwitch.body.data.token;

    // 3. Register Charlie (Member in Acme Corp)
    const regCharlie = await request(app).post("/api/auth/register").send({
      name: "Charlie Member",
      email: "charlie@example.com",
      password: "Password123!",
      organizationName: "Charlie Corp"
    });
    memberUserId = regCharlie.body.data.user.id;

    await request(app)
      .post(`/api/workspaces/${tenantId}/members`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "charlie@example.com", role: "member" });

    const charlieSwitch = await request(app)
      .post("/api/workspaces/switch")
      .set("Authorization", `Bearer ${regCharlie.body.data.token}`)
      .send({ workspaceId: tenantId });
    memberToken = charlieSwitch.body.data.token;

    // 4. Register Dan (Suspended member in Acme Corp)
    const regDan = await request(app).post("/api/auth/register").send({
      name: "Dan Suspended",
      email: "dan@example.com",
      password: "Password123!",
      organizationName: "Dan Corp"
    });
    suspendedMemberUserId = regDan.body.data.user.id;

    await request(app)
      .post(`/api/workspaces/${tenantId}/members`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "dan@example.com", role: "member" });

    await request(app)
      .patch(`/api/workspaces/${tenantId}/members/${suspendedMemberUserId}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "suspended" });

    // 5. Register Foreign Owner (Mallory) in Foreign Tenant
    const regForeign = await request(app).post("/api/auth/register").send({
      name: "Mallory Foreign",
      email: "mallory@example.com",
      password: "Password123!",
      organizationName: "Foreign Corp"
    });
    foreignOwnerToken = regForeign.body.data.token;
    foreignTenantId = regForeign.body.data.tenant.id;
    foreignUserId = regForeign.body.data.user.id;

    // 6. Seed a tracked service, usage record, and billing record in Acme Corp to verify data preservation
    testService = await TrackedService.create({
      tenantId,
      name: "Data Pipelines API",
      serviceType: "custom",
      trackingType: "metered",
      chargeType: "usage",
      unit: "event",
      unitPrice: mongoose.Types.Decimal128.fromString("0.01"),
      currency: "USD",
      status: "active"
    });

    const usage = await UsageRecord.create({
      tenantId,
      serviceId: testService._id,
      quantity: mongoose.Types.Decimal128.fromString("500"),
      unit: "event",
      occurredAt: new Date("2026-02-10T12:00:00Z")
    });

    await BillingRecord.create({
      tenantId,
      invoiceNumber: "INV-PRE-TRANSFER",
      billingPeriodStart: new Date("2026-02-01T00:00:00Z"),
      billingPeriodEnd: new Date("2026-02-28T23:59:59Z"),
      status: "issued",
      currency: "USD",
      subtotal: mongoose.Types.Decimal128.fromString("5.00"),
      total: mongoose.Types.Decimal128.fromString("5.00"),
      lineItems: [
        {
          serviceId: testService._id,
          serviceName: testService.name,
          description: "Data events",
          chargeType: "usage",
          quantity: mongoose.Types.Decimal128.fromString("500"),
          unitPrice: mongoose.Types.Decimal128.fromString("0.01"),
          amount: mongoose.Types.Decimal128.fromString("5.00"),
          usageRecordCount: 1,
          usageRecordIds: [usage._id]
        }
      ]
    });
  });

  // ==========================================
  // SECTION 1: Authorization
  // ==========================================

  it("1. unauthenticated transfer request returns 401 Unauthorized", async () => {
    const res = await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .send({ memberUserId });

    assert.equal(res.status, 401);
  });

  it("2. active workspace owner can transfer ownership -> 200 OK", async () => {
    const res = await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.previousOwner.role, "admin");
    assert.equal(res.body.data.newOwner.role, "owner");
  });

  it("3. admin attempting transfer returns 403 Forbidden", async () => {
    const res = await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ memberUserId });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /only the workspace owner/i);
  });

  it("4. member attempting transfer returns 403 Forbidden", async () => {
    const res = await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ memberUserId: adminUserId });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /only the workspace owner/i);
  });

  it("5. suspended actor is rejected with 403 Forbidden", async () => {
    // Suspend Alice's membership directly in DB
    await Membership.updateOne({ userId: ownerUserId, tenantId }, { $set: { status: "suspended" } });

    const res = await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId });

    assert.equal(res.status, 403);
    assert.match(res.body.message, /suspended or inactive/i);
  });

  it("6. cross-tenant owner attempting transfer on another workspace returns 403", async () => {
    const res = await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${foreignOwnerToken}`)
      .send({ memberUserId });

    assert.equal(res.status, 403);
  });

  it("7. archived workspace rejects transfer with 403 Forbidden", async () => {
    // Create secondary workspace for Alice so she can archive Acme Corp
    const secRes = await request(app)
      .post("/api/workspaces")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Acme Secondary", type: "organization" });

    await request(app)
      .patch(`/api/workspaces/${tenantId}/archive`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const res = await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId });

    assert.equal(res.status, 403);
    assert.match(res.body.message, /archived/i);
  });

  // ==========================================
  // SECTION 2: Target Validation
  // ==========================================

  it("8. active regular member is eligible and transfer succeeds", async () => {
    const res = await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId });

    assert.equal(res.status, 200);
    const newOwnerMembership = await Membership.findOne({ userId: memberUserId, tenantId });
    assert.equal(newOwnerMembership.role, "owner");
  });

  it("9. active admin member is eligible and transfer succeeds", async () => {
    const res = await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId: adminUserId });

    assert.equal(res.status, 200);
    const newOwnerMembership = await Membership.findOne({ userId: adminUserId, tenantId });
    assert.equal(newOwnerMembership.role, "owner");
  });

  it("10. nonexistent target member returns 404 Not Found", async () => {
    const nonExistentId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId: nonExistentId.toString() });

    assert.equal(res.status, 404);
    assert.match(res.body.message, /Target member not found/i);
  });

  it("11. non-member user ID returns 404 Not Found", async () => {
    const res = await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId: foreignUserId });

    assert.equal(res.status, 404);
    assert.match(res.body.message, /Target member not found/i);
  });

  it("12. cross-tenant target user is rejected with 404 Not Found", async () => {
    const res = await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId: foreignUserId });

    assert.equal(res.status, 404);
  });

  it("13. suspended target member is rejected with 400 Bad Request", async () => {
    const res = await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId: suspendedMemberUserId });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /suspended or inactive/i);

    // Verify Alice is still the owner
    const aliceM = await Membership.findOne({ userId: ownerUserId, tenantId });
    assert.equal(aliceM.role, "owner");
  });

  it("14. self-transfer attempt is rejected with 400 Bad Request", async () => {
    const res = await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId: ownerUserId });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /yourself/i);
  });

  it("15. already-owner target member is rejected with 400 Bad Request", async () => {
    // Attempt to transfer to current owner
    const res = await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId: ownerUserId });

    assert.equal(res.status, 400);
  });

  it("16. missing target memberUserId returns 400 Bad Request", async () => {
    const res = await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({});

    assert.equal(res.status, 400);
    assert.match(res.body.message, /target member user ID/i);
  });

  it("17. malformed workspace ID returns 400 Bad Request", async () => {
    const res = await request(app)
      .post("/api/workspaces/invalid-workspace-id/transfer-ownership")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /valid workspace ID/i);
  });

  // ==========================================
  // SECTION 3: Ownership Invariants
  // ==========================================

  it("18. previous owner becomes an active admin", async () => {
    await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId });

    const prevOwnerMembership = await Membership.findOne({ userId: ownerUserId, tenantId });
    assert.equal(prevOwnerMembership.role, "admin");
    assert.equal(prevOwnerMembership.status, "active");
  });

  it("19. target member becomes active owner", async () => {
    await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId });

    const newOwnerMembership = await Membership.findOne({ userId: memberUserId, tenantId });
    assert.equal(newOwnerMembership.role, "owner");
    assert.equal(newOwnerMembership.status, "active");
  });

  it("20. exactly one active owner remains after transfer", async () => {
    await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId });

    const ownerCount = await Membership.countDocuments({
      tenantId,
      role: "owner",
      status: "active"
    });
    assert.equal(ownerCount, 1);
  });

  it("21. membership count remains identical after transfer", async () => {
    const countBefore = await Membership.countDocuments({ tenantId });

    await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId });

    const countAfter = await Membership.countDocuments({ tenantId });
    assert.equal(countAfter, countBefore);
  });

  it("22. workspace identity attributes (name, createdBy, type, status) remain unchanged", async () => {
    const wsBefore = await Tenant.findById(tenantId);

    await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId });

    const wsAfter = await Tenant.findById(tenantId);
    assert.equal(wsAfter.name, wsBefore.name);
    assert.equal(wsAfter.createdBy.toString(), wsBefore.createdBy.toString());
    assert.equal(wsAfter.type, wsBefore.type);
    assert.equal(wsAfter.status, wsBefore.status);
    assert.equal(wsAfter._id.toString(), wsBefore._id.toString());
  });

  it("23. historical billing records, usage records, and services remain completely intact", async () => {
    const billBefore = await BillingRecord.findOne({ tenantId, invoiceNumber: "INV-PRE-TRANSFER" });
    const usageCountBefore = await UsageRecord.countDocuments({ tenantId });
    const serviceCountBefore = await TrackedService.countDocuments({ tenantId });

    await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId });

    const billAfter = await BillingRecord.findOne({ tenantId, invoiceNumber: "INV-PRE-TRANSFER" });
    const usageCountAfter = await UsageRecord.countDocuments({ tenantId });
    const serviceCountAfter = await TrackedService.countDocuments({ tenantId });

    assert.equal(billAfter.subtotal.toString(), billBefore.subtotal.toString());
    assert.equal(billAfter.total.toString(), billBefore.total.toString());
    assert.equal(usageCountAfter, usageCountBefore);
    assert.equal(serviceCountAfter, serviceCountBefore);
  });

  // ==========================================
  // SECTION 4: Security & Session Behavior
  // ==========================================

  it("24. previous owner's stale JWT cannot perform owner-only operations after transfer", async () => {
    // Alice transfers to Charlie
    await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId });

    // Alice attempts another ownership transfer with her stale JWT
    const resTransfer = await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId: adminUserId });

    assert.equal(resTransfer.status, 403);
    assert.match(resTransfer.body.message, /only the workspace owner/i);

    // Alice attempts to modify a member's role (owner-only endpoint)
    const resRoleMod = await request(app)
      .patch(`/api/workspaces/${tenantId}/members/${memberUserId}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "member" });

    assert.equal(resRoleMod.status, 403);
    assert.match(resRoleMod.body.message, /only workspace owners can modify/i);
  });

  it("25. new owner can perform owner-only operations using their existing JWT", async () => {
    // Alice transfers to Charlie
    await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId });

    // Charlie uses his existing JWT to modify Bob's role (owner-only)
    const resRoleMod = await request(app)
      .patch(`/api/workspaces/${tenantId}/members/${adminUserId}/role`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ role: "member" });

    assert.equal(resRoleMod.status, 200);
    assert.equal(resRoleMod.body.success, true);
    assert.equal(resRoleMod.body.data.member.role, "member");
  });

  it("26. previous owner retains valid admin privileges using their existing JWT", async () => {
    // Alice transfers to Charlie
    await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId });

    // Alice can still add a new member (admin privilege)
    const regEve = await request(app).post("/api/auth/register").send({
      name: "Eve New",
      email: "eve@example.com",
      password: "Password123!",
      organizationName: "Eve Corp"
    });

    const resAddMember = await request(app)
      .post(`/api/workspaces/${tenantId}/members`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "eve@example.com", role: "member" });

    assert.equal(resAddMember.status, 201);
  });

  it("27. unrelated foreign workspace privileges remain completely isolated", async () => {
    // Mallory attempts to transfer Alice's workspace
    const res = await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${foreignOwnerToken}`)
      .send({ memberUserId });

    assert.equal(res.status, 403);
  });

  // ==========================================
  // SECTION 5: Concurrency Safety
  // ==========================================

  it("28. concurrent transfers cannot create multiple owners (exactly one wins)", async () => {
    // Alice fires concurrent transfers to Bob and Charlie
    const [resBob, resCharlie] = await Promise.all([
      request(app)
        .post(`/api/workspaces/${tenantId}/transfer-ownership`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ memberUserId: adminUserId }),
      request(app)
        .post(`/api/workspaces/${tenantId}/transfer-ownership`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ memberUserId: memberUserId })
    ]);

    const statuses = [resBob.status, resCharlie.status].sort();
    assert.deepEqual(statuses, [200, 403], "One transfer must succeed (200) and the second must be rejected (403)");

    // Invariant check: Exactly one owner remains
    const owners = await Membership.find({ tenantId, role: "owner", status: "active" });
    assert.equal(owners.length, 1);
  });

  it("29. final membership state remains completely valid after concurrent attempts", async () => {
    // 3 concurrent attempts
    const [res1, res2, res3] = await Promise.all([
      request(app).post(`/api/workspaces/${tenantId}/transfer-ownership`).set("Authorization", `Bearer ${ownerToken}`).send({ memberUserId: adminUserId }),
      request(app).post(`/api/workspaces/${tenantId}/transfer-ownership`).set("Authorization", `Bearer ${ownerToken}`).send({ memberUserId: memberUserId }),
      request(app).post(`/api/workspaces/${tenantId}/transfer-ownership`).set("Authorization", `Bearer ${ownerToken}`).send({ memberUserId: adminUserId })
    ]);

    const successCount = [res1, res2, res3].filter((r) => r.status === 200).length;
    assert.equal(successCount, 1, "Only 1 transfer must succeed");

    const activeOwners = await Membership.find({ tenantId, role: "owner", status: "active" });
    assert.equal(activeOwners.length, 1, "Workspace must have exactly one active owner");

    const aliceM = await Membership.findOne({ userId: ownerUserId, tenantId });
    assert.equal(aliceM.role, "admin", "Alice must be an admin");
  });

  // ==========================================
  // SECTION 6: Regression
  // ==========================================

  it("30. existing role modification endpoint still works after transfer", async () => {
    // Alice transfers to Bob
    await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId: adminUserId });

    // Bob modifies Charlie's role to admin
    const modRes = await request(app)
      .patch(`/api/workspaces/${tenantId}/members/${memberUserId}/role`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role: "admin" });

    assert.equal(modRes.status, 200);
    assert.equal(modRes.body.data.member.role, "admin");
  });

  it("31. existing member suspension and reactivation still works after transfer", async () => {
    // Alice transfers to Bob
    await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId: adminUserId });

    // Bob suspends Charlie
    const suspRes = await request(app)
      .patch(`/api/workspaces/${tenantId}/members/${memberUserId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "suspended" });

    assert.equal(suspRes.status, 200);

    // Bob reactivates Charlie
    const reactRes = await request(app)
      .patch(`/api/workspaces/${tenantId}/members/${memberUserId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    assert.equal(reactRes.status, 200);
  });

  it("32. existing self-leave behavior still works after transfer", async () => {
    // Alice transfers to Bob
    await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId: adminUserId });

    // Alice (now admin) has a secondary workspace so she can leave
    await request(app)
      .post("/api/workspaces")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Alice Backup", type: "organization" });

    // Alice self-leaves Acme Corp
    const leaveRes = await request(app)
      .post(`/api/workspaces/${tenantId}/leave`)
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.equal(leaveRes.status, 200);
    const aliceMembership = await Membership.findOne({ userId: ownerUserId, tenantId });
    assert.equal(aliceMembership, null);
  });

  it("33. existing workspace archive behavior still works after transfer", async () => {
    // Alice transfers to Bob
    await request(app)
      .post(`/api/workspaces/${tenantId}/transfer-ownership`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ memberUserId: adminUserId });

    // Bob has Bob Corp as secondary workspace, so Bob can archive Acme Corp
    const archRes = await request(app)
      .patch(`/api/workspaces/${tenantId}/archive`)
      .set("Authorization", `Bearer ${adminToken}`);

    assert.equal(archRes.status, 200);
    const ws = await Tenant.findById(tenantId);
    assert.equal(ws.status, "archived");
  });
});
