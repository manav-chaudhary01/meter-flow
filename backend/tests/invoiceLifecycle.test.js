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
import Budget from "../src/models/Budget.js";
import { calculateActualSpend } from "../src/services/spendCalculator.js";

describe("P3.1 Invoice Finalization & Void Backend API", () => {
  let ownerToken;
  let ownerUserId;
  let tenantId;

  let adminToken;
  let adminUserId;

  let memberToken;
  let memberUserId;

  let foreignTenantId;
  let foreignOwnerToken;

  let testService;

  before(async () => {
    await connectTestDb();
  });

  after(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();

    // 1. Register Owner (Alice) with primary workspace
    const regOwner = await request(app).post("/api/auth/register").send({
      name: "Alice Owner",
      email: "owner@example.com",
      password: "Password123!",
      organizationName: "Acme Corp"
    });
    ownerToken = regOwner.body.data.token;
    ownerUserId = regOwner.body.data.user.id;
    tenantId = regOwner.body.data.tenant.id;

    // 2. Register Bob Admin & add to workspace as admin
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

    // Switch Bob to Alice's workspace
    const bobSwitch = await request(app)
      .post("/api/workspaces/switch")
      .set("Authorization", `Bearer ${regBob.body.data.token}`)
      .send({ workspaceId: tenantId });
    adminToken = bobSwitch.body.data.token;

    // 3. Register Charlie Member & add to workspace as member
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

    // 4. Register Foreign Owner (Mallory) in Foreign Tenant
    const regForeign = await request(app).post("/api/auth/register").send({
      name: "Mallory Foreign",
      email: "mallory@example.com",
      password: "Password123!",
      organizationName: "Foreign Corp"
    });
    foreignOwnerToken = regForeign.body.data.token;
    foreignTenantId = regForeign.body.data.tenant.id;

    // 5. Seed a tracked service in Acme Corp
    testService = await TrackedService.create({
      tenantId,
      name: "API Calls",
      serviceType: "custom",
      trackingType: "metered",
      chargeType: "usage",
      unit: "call",
      unitPrice: mongoose.Types.Decimal128.fromString("0.05"),
      currency: "USD",
      status: "active"
    });
  });

  // Helper to create an issued invoice with known line items and usage
  async function createIssuedBill(periodStart = "2026-01-01T00:00:00.000Z", periodEnd = "2026-01-31T23:59:59.999Z") {
    // Create usage record
    const usage = await UsageRecord.create({
      tenantId,
      serviceId: testService._id,
      quantity: mongoose.Types.Decimal128.fromString("100"),
      unit: "call",
      occurredAt: new Date("2026-01-15T12:00:00.000Z")
    });

    const genRes = await request(app)
      .post("/api/billing/generate")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        billingPeriodStart: periodStart,
        billingPeriodEnd: periodEnd,
        currency: "USD"
      });

    assert.ok(genRes.status === 200 || genRes.status === 201, `generateBill status should be 200 or 201, got ${genRes.status}`);
    return {
      bill: genRes.body.data.billingRecord,
      usageRecordId: usage._id
    };
  }

  // --- Finalize Invoice Tests ---

  it("1. Authorized owner can finalize an issued invoice -> 200 OK", async () => {
    const { bill } = await createIssuedBill();
    const res = await request(app)
      .patch(`/api/billing/${bill.id}/finalize`)
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.billingRecord.status, "finalized");
    assert.ok(res.body.data.billingRecord.finalizedAt);
    assert.equal(res.body.data.billingRecord.finalizedBy, ownerUserId);
  });

  it("2. Authorized admin can finalize an issued invoice -> 200 OK", async () => {
    const { bill } = await createIssuedBill();
    const res = await request(app)
      .patch(`/api/billing/${bill.id}/finalize`)
      .set("Authorization", `Bearer ${adminToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.billingRecord.status, "finalized");
    assert.equal(res.body.data.billingRecord.finalizedBy, adminUserId);
  });

  it("3. Regular member receives 403 Forbidden on invoice finalize", async () => {
    const { bill } = await createIssuedBill();
    const res = await request(app)
      .patch(`/api/billing/${bill.id}/finalize`)
      .set("Authorization", `Bearer ${memberToken}`);

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Forbidden|permission/i);

    // Verify invoice is still issued in DB
    const persisted = await BillingRecord.findById(bill.id);
    assert.equal(persisted.status, "issued");
  });

  it("4. Cross-tenant invoice finalization is rejected (404 Not Found)", async () => {
    const { bill } = await createIssuedBill();
    const res = await request(app)
      .patch(`/api/billing/${bill.id}/finalize`)
      .set("Authorization", `Bearer ${foreignOwnerToken}`);

    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);

    // Verify invoice is untouched
    const persisted = await BillingRecord.findById(bill.id);
    assert.equal(persisted.status, "issued");
  });

  it("5. Unauthenticated request receives 401 Unauthorized on finalize", async () => {
    const { bill } = await createIssuedBill();
    const res = await request(app).patch(`/api/billing/${bill.id}/finalize`);
    assert.equal(res.status, 401);
  });

  it("6. Malformed ObjectId returns 400 Bad Request on finalize", async () => {
    const res = await request(app)
      .patch("/api/billing/invalid-object-id/finalize")
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Invalid billing record ID/i);
  });

  it("7. Nonexistent invoice returns 404 Not Found on finalize", async () => {
    const randomId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .patch(`/api/billing/${randomId}/finalize`)
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Billing record not found/i);
  });

  it("8. Finalized invoice persists status, finalizedAt, and finalizedBy in MongoDB", async () => {
    const { bill } = await createIssuedBill();
    await request(app)
      .patch(`/api/billing/${bill.id}/finalize`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const doc = await BillingRecord.findById(bill.id);
    assert.equal(doc.status, "finalized");
    assert.ok(doc.finalizedAt instanceof Date);
    assert.equal(doc.finalizedBy.toString(), ownerUserId);
  });

  it("9. Finalized invoice preserves immutable monetary subtotal, total, and line items", async () => {
    const { bill } = await createIssuedBill();
    const subtotalBefore = bill.subtotal;
    const totalBefore = bill.total;
    const lineItemCountBefore = bill.lineItems.length;

    await request(app)
      .patch(`/api/billing/${bill.id}/finalize`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const res = await request(app)
      .get(`/api/billing/${bill.id}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.billingRecord.subtotal, subtotalBefore);
    assert.equal(res.body.data.billingRecord.total, totalBefore);
    assert.equal(res.body.data.billingRecord.lineItems.length, lineItemCountBefore);
  });

  it("10. Repeated finalization is deterministic and idempotent (200 OK, alreadyFinalized: true)", async () => {
    const { bill } = await createIssuedBill();

    // First finalization
    const res1 = await request(app)
      .patch(`/api/billing/${bill.id}/finalize`)
      .set("Authorization", `Bearer ${ownerToken}`);
    assert.equal(res1.status, 200);
    const finalizedAt1 = res1.body.data.billingRecord.finalizedAt;

    // Second finalization
    const res2 = await request(app)
      .patch(`/api/billing/${bill.id}/finalize`)
      .set("Authorization", `Bearer ${ownerToken}`);
    assert.equal(res2.status, 200);
    assert.equal(res2.body.success, true);
    assert.equal(res2.body.data.alreadyFinalized, true);
    assert.equal(res2.body.data.billingRecord.status, "finalized");
    assert.equal(res2.body.data.billingRecord.finalizedAt, finalizedAt1);
  });

  // --- Void Invoice Tests ---

  it("11. Authorized owner can void an issued invoice -> 200 OK", async () => {
    const { bill } = await createIssuedBill();
    const res = await request(app)
      .patch(`/api/billing/${bill.id}/void`)
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.billingRecord.status, "void");
    assert.ok(res.body.data.billingRecord.voidedAt);
    assert.equal(res.body.data.billingRecord.voidedBy, ownerUserId);
  });

  it("12. Authorized admin can void an issued invoice -> 200 OK", async () => {
    const { bill } = await createIssuedBill();
    const res = await request(app)
      .patch(`/api/billing/${bill.id}/void`)
      .set("Authorization", `Bearer ${adminToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.billingRecord.status, "void");
    assert.equal(res.body.data.billingRecord.voidedBy, adminUserId);
  });

  it("13. Void invoice remains stored in MongoDB (never hard-deleted)", async () => {
    const { bill } = await createIssuedBill();
    await request(app)
      .patch(`/api/billing/${bill.id}/void`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const doc = await BillingRecord.findById(bill.id);
    assert.ok(doc, "BillingRecord document must still exist in MongoDB");
    assert.equal(doc.status, "void");
  });

  it("14. Void invoice retains historical monetary values and line items", async () => {
    const { bill } = await createIssuedBill();
    const originalSubtotal = bill.subtotal;
    const originalTotal = bill.total;

    await request(app)
      .patch(`/api/billing/${bill.id}/void`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const res = await request(app)
      .get(`/api/billing/${bill.id}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.billingRecord.status, "void");
    assert.equal(res.body.data.billingRecord.subtotal, originalSubtotal);
    assert.equal(res.body.data.billingRecord.total, originalTotal);
    assert.equal(res.body.data.billingRecord.lineItems.length, bill.lineItems.length);
  });

  it("15. Unauthorized member receives 403 Forbidden on void", async () => {
    const { bill } = await createIssuedBill();
    const res = await request(app)
      .patch(`/api/billing/${bill.id}/void`)
      .set("Authorization", `Bearer ${memberToken}`);

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Forbidden|permission/i);

    const doc = await BillingRecord.findById(bill.id);
    assert.equal(doc.status, "issued");
  });

  it("16. Cross-tenant void is rejected (404 Not Found)", async () => {
    const { bill } = await createIssuedBill();
    const res = await request(app)
      .patch(`/api/billing/${bill.id}/void`)
      .set("Authorization", `Bearer ${foreignOwnerToken}`);

    assert.equal(res.status, 404);

    const doc = await BillingRecord.findById(bill.id);
    assert.equal(doc.status, "issued");
  });

  it("17. Repeated void is deterministic and idempotent (200 OK, alreadyVoid: true)", async () => {
    const { bill } = await createIssuedBill();

    const res1 = await request(app)
      .patch(`/api/billing/${bill.id}/void`)
      .set("Authorization", `Bearer ${ownerToken}`);
    assert.equal(res1.status, 200);

    const res2 = await request(app)
      .patch(`/api/billing/${bill.id}/void`)
      .set("Authorization", `Bearer ${ownerToken}`);
    assert.equal(res2.status, 200);
    assert.equal(res2.body.data.alreadyVoid, true);
    assert.equal(res2.body.data.billingRecord.status, "void");
  });

  // --- Conflict & Invariant Tests ---

  it("18. Attempting to void a finalized invoice returns 409 Conflict", async () => {
    const { bill } = await createIssuedBill();

    // Finalize first
    const finRes = await request(app)
      .patch(`/api/billing/${bill.id}/finalize`)
      .set("Authorization", `Bearer ${ownerToken}`);
    assert.equal(finRes.status, 200);

    // Attempt to void
    const voidRes = await request(app)
      .patch(`/api/billing/${bill.id}/void`)
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.equal(voidRes.status, 409);
    assert.equal(voidRes.body.success, false);
    assert.match(voidRes.body.message, /Cannot void a finalized invoice/i);

    // Verify status remains finalized
    const doc = await BillingRecord.findById(bill.id);
    assert.equal(doc.status, "finalized");
  });

  it("19. Attempting to finalize a void invoice returns 409 Conflict", async () => {
    const { bill } = await createIssuedBill();

    // Void first
    const voidRes = await request(app)
      .patch(`/api/billing/${bill.id}/void`)
      .set("Authorization", `Bearer ${ownerToken}`);
    assert.equal(voidRes.status, 200);

    // Attempt to finalize
    const finRes = await request(app)
      .patch(`/api/billing/${bill.id}/finalize`)
      .set("Authorization", `Bearer ${ownerToken}`);

    assert.equal(finRes.status, 409);
    assert.equal(finRes.body.success, false);
    assert.match(finRes.body.message, /Cannot finalize a void invoice/i);

    // Verify status remains void
    const doc = await BillingRecord.findById(bill.id);
    assert.equal(doc.status, "void");
  });

  it("20. Re-generating billing for a finalized or void period returns existing record without creating duplicates", async () => {
    const { bill } = await createIssuedBill("2026-02-01T00:00:00.000Z", "2026-02-28T23:59:59.999Z");

    await request(app)
      .patch(`/api/billing/${bill.id}/finalize`)
      .set("Authorization", `Bearer ${ownerToken}`);

    // Call generate again for the exact same period
    const regenRes = await request(app)
      .post("/api/billing/generate")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        billingPeriodStart: "2026-02-01T00:00:00.000Z",
        billingPeriodEnd: "2026-02-28T23:59:59.999Z",
        currency: "USD"
      });

    assert.equal(regenRes.status, 200);
    assert.equal(regenRes.body.data.isExisting, true);
    assert.equal(regenRes.body.data.billingRecord.id, bill.id);
    assert.equal(regenRes.body.data.billingRecord.status, "finalized");

    // Verify total count in DB remains 1
    const totalBills = await BillingRecord.countDocuments({ tenantId });
    assert.equal(totalBills, 1);
  });

  it("21. Late-arriving usage does not attach to a finalized bill; caught up in subsequent period", async () => {
    const period1Start = "2026-03-01T00:00:00.000Z";
    const period1End = "2026-03-31T23:59:59.999Z";

    // Period 1 initial bill with 50 calls
    await UsageRecord.create({
      tenantId,
      serviceId: testService._id,
      quantity: mongoose.Types.Decimal128.fromString("50"),
      unit: "call",
      occurredAt: new Date("2026-03-10T10:00:00.000Z")
    });

    const gen1 = await request(app)
      .post("/api/billing/generate")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ billingPeriodStart: period1Start, billingPeriodEnd: period1End, currency: "USD" });
    const bill1Id = gen1.body.data.billingRecord.id;

    // Finalize Period 1
    await request(app)
      .patch(`/api/billing/${bill1Id}/finalize`)
      .set("Authorization", `Bearer ${ownerToken}`);

    // Now insert a late-arriving event from Period 1 (occurredAt in March)
    const lateUsage = await UsageRecord.create({
      tenantId,
      serviceId: testService._id,
      quantity: mongoose.Types.Decimal128.fromString("25"),
      unit: "call",
      occurredAt: new Date("2026-03-20T10:00:00.000Z"),
      billingRecordId: null
    });

    // Re-requesting Period 1 should NOT attach the late event
    await request(app)
      .post("/api/billing/generate")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ billingPeriodStart: period1Start, billingPeriodEnd: period1End, currency: "USD" });

    const checkLate = await UsageRecord.findById(lateUsage._id);
    assert.equal(checkLate.billingRecordId, null, "Late usage must NOT be attached to finalized bill");

    // Generate Period 2 (April)
    const period2Start = "2026-04-01T00:00:00.000Z";
    const period2End = "2026-04-30T23:59:59.999Z";

    const gen2 = await request(app)
      .post("/api/billing/generate")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ billingPeriodStart: period2Start, billingPeriodEnd: period2End, currency: "USD" });

    assert.ok(gen2.status === 200 || gen2.status === 201, `generateBill status should be 200 or 201, got ${gen2.status}`);
    // Late usage must now be caught up in Period 2
    const checkLateAfterP2 = await UsageRecord.findById(lateUsage._id);
    assert.equal(
      checkLateAfterP2.billingRecordId.toString(),
      gen2.body.data.billingRecord.id,
      "Late usage must be caught up in subsequent billing cycle"
    );
  });

  // --- Spend Calculator Integration Tests ---

  it("22. Budget spend calculation strictly excludes void invoices while including finalized invoices", async () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const mid = new Date("2026-05-15T00:00:00.000Z");
    const end = new Date("2026-05-31T23:59:59.999Z");

    // Invoice 1: Issued $100
    const bill1 = await BillingRecord.create({
      tenantId,
      invoiceNumber: "INV-SPEND-1",
      billingPeriodStart: start,
      billingPeriodEnd: mid,
      currency: "USD",
      subtotal: mongoose.Types.Decimal128.fromString("100.00"),
      total: mongoose.Types.Decimal128.fromString("100.00"),
      status: "issued"
    });

    // Invoice 2: Finalized $200
    const bill2 = await BillingRecord.create({
      tenantId,
      invoiceNumber: "INV-SPEND-2",
      billingPeriodStart: mid,
      billingPeriodEnd: end,
      currency: "USD",
      subtotal: mongoose.Types.Decimal128.fromString("200.00"),
      total: mongoose.Types.Decimal128.fromString("200.00"),
      status: "finalized",
      finalizedAt: new Date(),
      finalizedBy: ownerUserId
    });

    // Invoice 3: Void $500 (should be excluded)
    const bill3 = await BillingRecord.create({
      tenantId,
      invoiceNumber: "INV-SPEND-3",
      billingPeriodStart: start,
      billingPeriodEnd: end,
      currency: "USD",
      subtotal: mongoose.Types.Decimal128.fromString("500.00"),
      total: mongoose.Types.Decimal128.fromString("500.00"),
      status: "void",
      voidedAt: new Date(),
      voidedBy: ownerUserId
    });

    const spendResult = await calculateActualSpend({
      tenantId,
      currency: "USD",
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      endDate: new Date("2026-06-01T00:00:00.000Z")
    });

    // Expected: $100 (issued) + $200 (finalized) = $300. Void bill ($500) is excluded.
    assert.equal(spendResult.actualSpend, "300.00");
    assert.equal(spendResult.billCount, 2);
  });

  // --- Concurrency / Race Resolution Test ---

  it("23. Concurrent finalize and void requests resolve deterministically without corrupting state", async () => {
    const { bill } = await createIssuedBill("2026-06-01T00:00:00.000Z", "2026-06-30T23:59:59.999Z");

    // Fire finalize and void concurrently
    const [resFin, resVoid] = await Promise.all([
      request(app).patch(`/api/billing/${bill.id}/finalize`).set("Authorization", `Bearer ${ownerToken}`),
      request(app).patch(`/api/billing/${bill.id}/void`).set("Authorization", `Bearer ${ownerToken}`)
    ]);

    // One must succeed (200) and the other must be rejected with 409 Conflict
    const statuses = [resFin.status, resVoid.status].sort();
    assert.deepEqual(statuses, [200, 409], "One operation must win (200) and the other must receive 409 Conflict");

    const finalDoc = await BillingRecord.findById(bill.id);
    assert.ok(
      finalDoc.status === "finalized" || finalDoc.status === "void",
      "Document must be deterministically either finalized or void"
    );
  });
});
