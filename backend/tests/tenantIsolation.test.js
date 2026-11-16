import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import app from "../src/app.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import TrackedService from "../src/models/TrackedService.js";
import UsageRecord from "../src/models/UsageRecord.js";
import BillingRecord from "../src/models/BillingRecord.js";
import Budget from "../src/models/Budget.js";
import BudgetAlert from "../src/models/BudgetAlert.js";
import Membership from "../src/models/Membership.js";
import User from "../src/models/User.js";

describe("Multi-Tenant Workspace Isolation & Authorization Audit", () => {
  let tenantAToken;
  let tenantBToken;
  let tenantAId;
  let tenantBId;
  let userAId;
  let userBId;

  // Tenant A Fixture IDs
  let serviceAId;
  let usageAId;
  let billingAId;
  let budgetAId;
  let alertAId;

  // Tenant B Fixture IDs
  let serviceBId;
  let usageBId;
  let billingBId;
  let budgetBId;
  let alertBId;

  before(async () => {
    await connectTestDb();
  });

  after(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();

    // 1. Provision Tenant A (Alice Owner)
    const regA = await request(app).post("/api/auth/register").send({
      name: "Alice Owner",
      email: "alice@tenant-a.com",
      password: "password123",
      organizationName: "Tenant Alpha Corp"
    });
    assert.equal(regA.status, 201);
    tenantAToken = regA.body.data.token;
    tenantAId = regA.body.data.tenant.id;
    userAId = regA.body.data.user.id;

    // 2. Provision Tenant B (Bob Owner)
    const regB = await request(app).post("/api/auth/register").send({
      name: "Bob Owner",
      email: "bob@tenant-b.com",
      password: "password123",
      organizationName: "Tenant Beta Ltd"
    });
    assert.equal(regB.status, 201);
    tenantBToken = regB.body.data.token;
    tenantBId = regB.body.data.tenant.id;
    userBId = regB.body.data.user.id;

    // 3. Seed Tenant A Resources
    const createSvcA = await request(app)
      .post("/api/services")
      .set("Authorization", `Bearer ${tenantAToken}`)
      .send({
        name: "Compute Alpha",
        trackingType: "metered",
        currency: "USD",
        unit: "vCPU-hour",
        unitPrice: "0.10"
      });
    assert.equal(createSvcA.status, 201);
    serviceAId = createSvcA.body.data.service.id;

    const createUsageA = await request(app)
      .post("/api/usage")
      .set("Authorization", `Bearer ${tenantAToken}`)
      .send({
        serviceId: serviceAId,
        quantity: "150",
        unit: "vCPU-hour",
        occurredAt: "2026-11-01T10:00:00.000Z"
      });
    assert.equal(createUsageA.status, 201);
    usageAId = createUsageA.body.data.record.id;

    const genBillA = await request(app)
      .post("/api/billing/generate")
      .set("Authorization", `Bearer ${tenantAToken}`)
      .send({
        billingPeriodStart: "2026-11-01T00:00:00.000Z",
        billingPeriodEnd: "2026-11-15T00:00:00.000Z",
        currency: "USD"
      });
    assert.equal(genBillA.status, 201);
    billingAId = genBillA.body.data.billingRecord.id;

    const createBudgetA = await request(app)
      .post("/api/budgets")
      .set("Authorization", `Bearer ${tenantAToken}`)
      .send({
        name: "Alpha Monthly Budget",
        amount: "20.00",
        currency: "USD",
        startDate: "2026-11-01T00:00:00.000Z",
        endDate: "2026-11-30T00:00:00.000Z",
        thresholds: [50, 80, 100]
      });
    assert.equal(createBudgetA.status, 201);
    budgetAId = createBudgetA.body.data.budget.id;

    // Trigger alert for Tenant A (spend is $15.00 on a $20.00 budget = 75%, crossing 50%)
    const evalA = await request(app)
      .post(`/api/budgets/${budgetAId}/evaluate`)
      .set("Authorization", `Bearer ${tenantAToken}`);
    assert.equal(evalA.status, 200);
    assert(evalA.body.data.newAlerts.length > 0 || evalA.body.data.existingAlerts.length > 0);
    const alertADoc = await BudgetAlert.findOne({ tenantId: tenantAId });
    assert(alertADoc);
    alertAId = alertADoc._id.toString();

    // 4. Seed Tenant B Resources
    const createSvcB = await request(app)
      .post("/api/services")
      .set("Authorization", `Bearer ${tenantBToken}`)
      .send({
        name: "Storage Beta",
        trackingType: "metered",
        currency: "USD",
        unit: "GB-month",
        unitPrice: "0.05"
      });
    assert.equal(createSvcB.status, 201);
    serviceBId = createSvcB.body.data.service.id;

    const createUsageB = await request(app)
      .post("/api/usage")
      .set("Authorization", `Bearer ${tenantBToken}`)
      .send({
        serviceId: serviceBId,
        quantity: "400",
        unit: "GB-month",
        occurredAt: "2026-11-02T12:00:00.000Z"
      });
    assert.equal(createUsageB.status, 201);
    usageBId = createUsageB.body.data.record.id;

    const genBillB = await request(app)
      .post("/api/billing/generate")
      .set("Authorization", `Bearer ${tenantBToken}`)
      .send({
        billingPeriodStart: "2026-11-01T00:00:00.000Z",
        billingPeriodEnd: "2026-11-15T00:00:00.000Z",
        currency: "USD"
      });
    assert.equal(genBillB.status, 201);
    billingBId = genBillB.body.data.billingRecord.id;

    const createBudgetB = await request(app)
      .post("/api/budgets")
      .set("Authorization", `Bearer ${tenantBToken}`)
      .send({
        name: "Beta Monthly Budget",
        amount: "25.00",
        currency: "USD",
        startDate: "2026-11-01T00:00:00.000Z",
        endDate: "2026-11-30T00:00:00.000Z",
        thresholds: [50, 80, 100]
      });
    assert.equal(createBudgetB.status, 201);
    budgetBId = createBudgetB.body.data.budget.id;

    const evalB = await request(app)
      .post(`/api/budgets/${budgetBId}/evaluate`)
      .set("Authorization", `Bearer ${tenantBToken}`);
    assert.equal(evalB.status, 200);
    const alertBDoc = await BudgetAlert.findOne({ tenantId: tenantBId });
    assert(alertBDoc);
    alertBId = alertBDoc._id.toString();
  });

  describe("1. Direct Cross-Tenant Resource Access (Adversarial ID Infiltration)", () => {
    it("should deny Tenant A access to Tenant B TrackedService (GET, PUT, DELETE)", async () => {
      // GET
      const getRes = await request(app)
        .get(`/api/services/${serviceBId}`)
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(getRes.status, 404);
      assert.match(getRes.body.message, /service not found/i);

      // PUT
      const putRes = await request(app)
        .put(`/api/services/${serviceBId}`)
        .set("Authorization", `Bearer ${tenantAToken}`)
        .send({ name: "Compromised Service Name" });
      assert.equal(putRes.status, 404);
      assert.match(putRes.body.message, /service not found/i);

      // DELETE
      const deleteRes = await request(app)
        .delete(`/api/services/${serviceBId}`)
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(deleteRes.status, 404);
      assert.match(deleteRes.body.message, /service not found/i);

      // Verify Service B remains untouched
      const svcDoc = await TrackedService.findById(serviceBId);
      assert.equal(svcDoc.name, "Storage Beta");
      assert.equal(svcDoc.status, "active");
    });

    it("should deny Tenant A access to Tenant B UsageRecord (GET)", async () => {
      const getRes = await request(app)
        .get(`/api/usage/${usageBId}`)
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(getRes.status, 404);
      assert.match(getRes.body.message, /usage record not found/i);
    });

    it("should deny Tenant A access to Tenant B BillingRecord (GET /:id and GET /:id/usage)", async () => {
      // Direct invoice fetch
      const getRes = await request(app)
        .get(`/api/billing/${billingBId}`)
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(getRes.status, 404);
      assert.match(getRes.body.message, /billing record not found/i);

      // Reconciled usage audit for foreign invoice
      const getUsageRes = await request(app)
        .get(`/api/billing/${billingBId}/usage`)
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(getUsageRes.status, 404);
      assert.match(getUsageRes.body.message, /billing record not found/i);
    });

    it("should deny Tenant A access to Tenant B Budget (GET, PUT, DELETE, EVALUATE)", async () => {
      // GET
      const getRes = await request(app)
        .get(`/api/budgets/${budgetBId}`)
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(getRes.status, 404);
      assert.match(getRes.body.message, /budget not found/i);

      // PUT
      const putRes = await request(app)
        .put(`/api/budgets/${budgetBId}`)
        .set("Authorization", `Bearer ${tenantAToken}`)
        .send({ amount: "1.00" });
      assert.equal(putRes.status, 404);
      assert.match(putRes.body.message, /budget not found/i);

      // DELETE
      const deleteRes = await request(app)
        .delete(`/api/budgets/${budgetBId}`)
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(deleteRes.status, 404);
      assert.match(deleteRes.body.message, /budget not found/i);

      // EVALUATE
      const evalRes = await request(app)
        .post(`/api/budgets/${budgetBId}/evaluate`)
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(evalRes.status, 404);
      assert.match(evalRes.body.message, /budget not found/i);

      // Verify Budget B remains untouched
      const budgetDoc = await Budget.findById(budgetBId);
      assert.equal(budgetDoc.status, "active");
      assert.equal(budgetDoc.amount.toString(), "25.00");
    });

    it("should deny Tenant A access to Tenant B BudgetAlert (PATCH ack)", async () => {
      const ackRes = await request(app)
        .patch(`/api/budgets/alerts/${alertBId}/ack`)
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(ackRes.status, 404);
      assert.match(ackRes.body.message, /alert not found/i);

      // Verify Alert B remains active
      const alertDoc = await BudgetAlert.findById(alertBId);
      assert.equal(alertDoc.status, "active");
    });

    it("should deny Tenant A access to Tenant B Workspace Members (GET, POST, DELETE)", async () => {
      // Attempt to view Tenant B members
      const getMembersRes = await request(app)
        .get(`/api/workspaces/${tenantBId}/members`)
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(getMembersRes.status, 403);
      assert.match(getMembersRes.body.message, /access denied/i);

      // Attempt to add a member to Tenant B
      const addMemberRes = await request(app)
        .post(`/api/workspaces/${tenantBId}/members`)
        .set("Authorization", `Bearer ${tenantAToken}`)
        .send({
          email: "attacker@meterflow.test",
          role: "admin"
        });
      assert.equal(addMemberRes.status, 403);
      assert.match(addMemberRes.body.message, /only workspace owners and admins/i);

      // Attempt to remove Bob from Tenant B
      const removeMemberRes = await request(app)
        .delete(`/api/workspaces/${tenantBId}/members/${userBId}`)
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(removeMemberRes.status, 403);
      assert.match(removeMemberRes.body.message, /only workspace owners and admins/i);
    });

    it("should deny Tenant A access to Tenant B legacy Resource (GET, PUT, DELETE)", async () => {
      // Create resource in Tenant B
      const createResB = await request(app)
        .post("/api/resources")
        .set("Authorization", `Bearer ${tenantBToken}`)
        .send({
          name: "Confidential B Server",
          unit: "node",
          price: "15.00"
        });
      assert.equal(createResB.status, 201);
      const resBId = createResB.body.data.resource._id;

      // Tenant A tries to GET
      const getRes = await request(app)
        .get(`/api/resources/${resBId}`)
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(getRes.status, 404);

      // Tenant A tries to PUT
      const putRes = await request(app)
        .put(`/api/resources/${resBId}`)
        .set("Authorization", `Bearer ${tenantAToken}`)
        .send({ name: "Hacked", unit: "node", price: "0.01" });
      assert.equal(putRes.status, 404);

      // Tenant A tries to DELETE
      const deleteRes = await request(app)
        .delete(`/api/resources/${resBId}`)
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(deleteRes.status, 404);
    });
  });

  describe("2. Cross-Tenant List Endpoint & Filter Isolation", () => {
    it("should strictly scope GET /api/workspaces to caller memberships", async () => {
      const resA = await request(app)
        .get("/api/workspaces")
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(resA.status, 200);
      assert.equal(resA.body.data.workspaces.length, 1);
      assert.equal(resA.body.data.workspaces[0].id, tenantAId);

      const resB = await request(app)
        .get("/api/workspaces")
        .set("Authorization", `Bearer ${tenantBToken}`);
      assert.equal(resB.status, 200);
      assert.equal(resB.body.data.workspaces.length, 1);
      assert.equal(resB.body.data.workspaces[0].id, tenantBId);
    });

    it("should strictly scope GET /api/services to active workspace", async () => {
      const resA = await request(app)
        .get("/api/services")
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(resA.status, 200);
      assert.equal(resA.body.data.services.length, 1);
      assert.equal(resA.body.data.services[0].id, serviceAId);

      const resB = await request(app)
        .get("/api/services")
        .set("Authorization", `Bearer ${tenantBToken}`);
      assert.equal(resB.status, 200);
      assert.equal(resB.body.data.services.length, 1);
      assert.equal(resB.body.data.services[0].id, serviceBId);
    });

    it("should strictly scope GET /api/usage and prevent filter leakages", async () => {
      // General list
      const resA = await request(app)
        .get("/api/usage")
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(resA.status, 200);
      assert.equal(resA.body.data.records.length, 1);
      assert.equal(resA.body.data.records[0].id, usageAId);

      // Filtering with Tenant B's service ID in Tenant A must return 0 records
      const filteredRes = await request(app)
        .get(`/api/usage?serviceId=${serviceBId}`)
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(filteredRes.status, 200);
      assert.equal(filteredRes.body.data.records.length, 0);
    });

    it("should strictly scope GET /api/usage/summary and aggregations", async () => {
      // Aggregation by service
      const summaryA = await request(app)
        .get("/api/usage/summary?groupBy=service")
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(summaryA.status, 200);
      assert.equal(summaryA.body.data.summary.length, 1);
      assert.equal(summaryA.body.data.summary[0].serviceId, serviceAId);
      assert.equal(summaryA.body.data.summary[0].totalQuantity, "150");

      // Filtering summary by foreign serviceId must yield empty summary
      const foreignSummary = await request(app)
        .get(`/api/usage/summary?serviceId=${serviceBId}`)
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(foreignSummary.status, 200);
      assert.equal(foreignSummary.body.data.summary.length, 0);

      // Aggregation by day
      const dailySummary = await request(app)
        .get("/api/usage/summary?groupBy=day")
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(dailySummary.status, 200);
      assert.equal(dailySummary.body.data.summary.length, 1);
      assert.equal(dailySummary.body.data.summary[0].serviceName, "Compute Alpha");
    });

    it("should strictly scope GET /api/billing and GET /api/budgets", async () => {
      const billsA = await request(app)
        .get("/api/billing")
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(billsA.status, 200);
      assert.equal(billsA.body.data.billingRecords.length, 1);
      assert.equal(billsA.body.data.billingRecords[0].id, billingAId);

      const budgetsA = await request(app)
        .get("/api/budgets")
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(budgetsA.status, 200);
      assert.equal(budgetsA.body.data.budgets.length, 1);
      assert.equal(budgetsA.body.data.budgets[0].id, budgetAId);

      const alertsA = await request(app)
        .get("/api/budgets/alerts")
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(alertsA.status, 200);
      assert.equal(alertsA.body.data.alerts.length, 1);
      assert.equal(alertsA.body.data.alerts[0].id, alertAId);

      // Querying alerts with Tenant B's budgetId must return empty array
      const foreignAlerts = await request(app)
        .get(`/api/budgets/alerts?budgetId=${budgetBId}`)
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(foreignAlerts.status, 200);
      assert.equal(foreignAlerts.body.data.alerts.length, 0);
    });
  });

  describe("3. Cross-Tenant Relationship Infiltration & Isolation", () => {
    it("should reject usage ingestion referencing a service belonging to another tenant", async () => {
      const res = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${tenantAToken}`)
        .send({
          serviceId: serviceBId,
          quantity: "50",
          unit: "GB-month"
        });

      assert.equal(res.status, 404);
      assert.match(res.body.message, /service not found in active workspace/i);

      // Verify no usage record was created
      const count = await UsageRecord.countDocuments({ serviceId: serviceBId, tenantId: tenantAId });
      assert.equal(count, 0);
    });

    it("should isolate idempotency keys and externalEventIds per tenant without collision", async () => {
      const sharedKey = "evt-sync-999";
      const sharedExternalId = "ext-order-555";

      // 1. Tenant A ingests usage with shared keys
      const resA = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${tenantAToken}`)
        .send({
          serviceId: serviceAId,
          quantity: "25",
          unit: "vCPU-hour",
          idempotencyKey: sharedKey,
          externalEventId: sharedExternalId
        });
      assert.equal(resA.status, 201);
      assert.equal(resA.body.data.idempotentReplay, false);

      // 2. Tenant B ingests usage on their own service with the EXACT SAME keys
      const resB = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${tenantBToken}`)
        .send({
          serviceId: serviceBId,
          quantity: "75",
          unit: "GB-month",
          idempotencyKey: sharedKey,
          externalEventId: sharedExternalId
        });
      assert.equal(resB.status, 201);
      assert.equal(resB.body.data.idempotentReplay, false);

      // Verify both records exist under their respective tenantIds in the database
      const docA = await UsageRecord.findOne({ tenantId: tenantAId, idempotencyKey: sharedKey });
      const docB = await UsageRecord.findOne({ tenantId: tenantBId, idempotencyKey: sharedKey });
      assert(docA);
      assert(docB);
      assert.notEqual(docA._id.toString(), docB._id.toString());
      assert.equal(docA.quantity.toString(), "25");
      assert.equal(docB.quantity.toString(), "75");
    });

    it("should strictly isolate billing generation from foreign services and usage", async () => {
      // 1. Ingest unbilled usage into Tenant A and Tenant B
      await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${tenantAToken}`)
        .send({
          serviceId: serviceAId,
          quantity: "50",
          unit: "vCPU-hour",
          occurredAt: "2026-11-20T10:00:00.000Z"
        });

      const unbilledB = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${tenantBToken}`)
        .send({
          serviceId: serviceBId,
          quantity: "200",
          unit: "GB-month",
          occurredAt: "2026-11-20T11:00:00.000Z"
        });
      const unbilledBId = unbilledB.body.data.record.id;

      // 2. Tenant A generates bill for late November
      const billGenA = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${tenantAToken}`)
        .send({
          billingPeriodStart: "2026-11-16T00:00:00.000Z",
          billingPeriodEnd: "2026-11-30T00:00:00.000Z",
          currency: "USD"
        });
      assert.equal(billGenA.status, 201);

      // Total must be 50 * 0.10 = $5.00
      assert.equal(billGenA.body.data.billingRecord.total, "5.00");
      assert.equal(billGenA.body.data.billingRecord.lineItems.length, 1);
      assert.equal(billGenA.body.data.billingRecord.lineItems[0].serviceId, serviceAId);

      // 3. Verify Tenant B's unbilled usage was NOT reconciled to Tenant A's bill
      const recordB = await UsageRecord.findById(unbilledBId);
      assert.equal(recordB.billingRecordId, null);
      assert.equal(recordB.billedAt, null);
    });

    it("should isolate spend calculation and budget forecasting from foreign billing records", async () => {
      // Tenant B generates an enormous bill of $10,000
      await BillingRecord.create({
        tenantId: tenantBId,
        invoiceNumber: "INV-B-WHALE",
        billingPeriodStart: new Date("2026-11-01T00:00:00.000Z"),
        billingPeriodEnd: new Date("2026-11-30T00:00:00.000Z"),
        currency: "USD",
        lineItems: [],
        subtotal: "10000.00",
        total: "10000.00",
        status: "issued",
        generatedAt: new Date()
      });

      // Tenant A evaluates budget
      const evalRes = await request(app)
        .get(`/api/budgets/${budgetAId}`)
        .set("Authorization", `Bearer ${tenantAToken}`);

      assert.equal(evalRes.status, 200);
      // Spend for Tenant A must only reflect Tenant A's bills ($15.00), not Tenant B's $10,000
      assert.equal(evalRes.body.data.budget.actualSpend, "15.00");
      assert.equal(evalRes.body.data.budget.percentageUsed, 75);
    });
  });

  describe("4. ID Manipulation & Error Sanitization", () => {
    it("should reject malformed ObjectIds with HTTP 400 across all resource endpoints", async () => {
      const badId = "not-a-valid-object-id";

      const endpoints = [
        { method: "get", path: `/api/services/${badId}` },
        { method: "put", path: `/api/services/${badId}`, body: { name: "Test" } },
        { method: "delete", path: `/api/services/${badId}` },
        { method: "get", path: `/api/usage/${badId}` },
        { method: "get", path: `/api/billing/${badId}` },
        { method: "get", path: `/api/billing/${badId}/usage` },
        { method: "get", path: `/api/budgets/${badId}` },
        { method: "put", path: `/api/budgets/${badId}`, body: { name: "Test" } },
        { method: "delete", path: `/api/budgets/${badId}` },
        { method: "post", path: `/api/budgets/${badId}/evaluate` },
        { method: "patch", path: `/api/budgets/alerts/${badId}/ack` },
        { method: "get", path: `/api/workspaces/${badId}/members` },
        { method: "post", path: `/api/workspaces/${badId}/members`, body: { email: "a@b.com" } },
        { method: "delete", path: `/api/workspaces/${badId}/members/${badId}` }
      ];

      for (const ep of endpoints) {
        let reqBuilder = request(app)[ep.method](ep.path).set("Authorization", `Bearer ${tenantAToken}`);
        if (ep.body) reqBuilder = reqBuilder.send(ep.body);
        const res = await reqBuilder;
        assert.equal(
          res.status,
          400,
          `Expected 400 for ${ep.method.toUpperCase()} ${ep.path}, got ${res.status}`
        );
        assert.equal(res.body.success, false);
        assert(res.body.message);
        // Ensure error response contains no internal stack trace or DB dump
        assert.strictEqual(res.body.stack, undefined);
      }
    });

    it("should return HTTP 404 for valid nonexistent ObjectIds without information disclosure", async () => {
      const nonexistentId = new mongoose.Types.ObjectId().toString();

      const endpoints = [
        { method: "get", path: `/api/services/${nonexistentId}` },
        { method: "get", path: `/api/usage/${nonexistentId}` },
        { method: "get", path: `/api/billing/${nonexistentId}` },
        { method: "get", path: `/api/billing/${nonexistentId}/usage` },
        { method: "get", path: `/api/budgets/${nonexistentId}` },
        { method: "patch", path: `/api/budgets/alerts/${nonexistentId}/ack` }
      ];

      for (const ep of endpoints) {
        const res = await request(app)[ep.method](ep.path).set("Authorization", `Bearer ${tenantAToken}`);
        assert.equal(
          res.status,
          404,
          `Expected 404 for ${ep.method.toUpperCase()} ${ep.path}, got ${res.status}`
        );
        assert.equal(res.body.success, false);
        assert.match(res.body.message, /not found/i);
        assert.strictEqual(res.body.stack, undefined);
      }
    });
  });

  describe("5. Workspace Switching Security & Membership Lifecycle", () => {
    it("should support authorized workspace switching (A1 -> A2 -> A1) with strict isolation at each step", async () => {
      // 1. Alice creates second organization workspace
      const createWsRes = await request(app)
        .post("/api/workspaces")
        .set("Authorization", `Bearer ${tenantAToken}`)
        .send({
          name: "Tenant Alpha Secondary",
          type: "organization"
        });
      assert.equal(createWsRes.status, 201);
      const tenantA2Id = createWsRes.body.data.workspace.id;

      // 2. Switch from A1 to A2
      const switchRes = await request(app)
        .post("/api/workspaces/switch")
        .set("Authorization", `Bearer ${tenantAToken}`)
        .send({ workspaceId: tenantA2Id });
      assert.equal(switchRes.status, 200);
      assert.equal(switchRes.body.data.workspace.id, tenantA2Id);
      const tokenA2 = switchRes.body.data.token;

      // 3. In A2, services list must be empty (Service A belongs to A1)
      const listA2 = await request(app)
        .get("/api/services")
        .set("Authorization", `Bearer ${tokenA2}`);
      assert.equal(listA2.status, 200);
      assert.equal(listA2.body.data.services.length, 0);

      // Create a service in A2
      const createSvcA2 = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${tokenA2}`)
        .send({
          name: "Secondary Database",
          trackingType: "subscription",
          currency: "USD",
          subscriptionAmount: "50.00",
          billingInterval: "monthly"
        });
      assert.equal(createSvcA2.status, 201);
      const serviceA2Id = createSvcA2.body.data.service.id;

      // 4. Switch back from A2 to A1
      const switchBackRes = await request(app)
        .post("/api/workspaces/switch")
        .set("Authorization", `Bearer ${tokenA2}`)
        .send({ workspaceId: tenantAId });
      assert.equal(switchBackRes.status, 200);
      const tokenA1New = switchBackRes.body.data.token;

      // 5. In A1, services list contains Service A, but NOT Service A2
      const listA1 = await request(app)
        .get("/api/services")
        .set("Authorization", `Bearer ${tokenA1New}`);
      assert.equal(listA1.status, 200);
      assert.equal(listA1.body.data.services.length, 1);
      assert.equal(listA1.body.data.services[0].id, serviceAId);

      // Direct lookup of Service A2 with A1 token must return 404
      const foreignLookup = await request(app)
        .get(`/api/services/${serviceA2Id}`)
        .set("Authorization", `Bearer ${tokenA1New}`);
      assert.equal(foreignLookup.status, 404);
    });

    it("should prevent unauthorized switching to workspaces without active membership", async () => {
      // Alice attempts switch to Tenant B
      const res = await request(app)
        .post("/api/workspaces/switch")
        .set("Authorization", `Bearer ${tenantAToken}`)
        .send({ workspaceId: tenantBId });
      assert.equal(res.status, 403);
      assert.match(res.body.message, /you are not an active member/i);
    });

    it("should block workspace switching and API access when membership is suspended", async () => {
      // 1. Add Charlie to Tenant A as member
      const regCharlie = await request(app).post("/api/auth/register").send({
        name: "Charlie Member",
        email: "charlie@member.test",
        password: "password123",
        organizationName: "Charlie Temp Org"
      });
      assert.equal(regCharlie.status, 201);
      const charlieUserId = regCharlie.body.data.user.id;
      const charlieToken = regCharlie.body.data.token;

      // Alice adds Charlie to Tenant A
      const addRes = await request(app)
        .post(`/api/workspaces/${tenantAId}/members`)
        .set("Authorization", `Bearer ${tenantAToken}`)
        .send({
          email: "charlie@member.test",
          role: "member"
        });
      assert.equal(addRes.status, 201);

      // Charlie switches to Tenant A
      const switchRes = await request(app)
        .post("/api/workspaces/switch")
        .set("Authorization", `Bearer ${charlieToken}`)
        .send({ workspaceId: tenantAId });
      assert.equal(switchRes.status, 200);
      const charlieTenantAToken = switchRes.body.data.token;

      // 2. Alice suspends Charlie's membership in Tenant A
      await Membership.updateOne(
        { userId: charlieUserId, tenantId: tenantAId },
        { status: "suspended" }
      );

      // 3. Charlie's existing token for Tenant A is rejected by authMiddleware
      const apiRes = await request(app)
        .get("/api/services")
        .set("Authorization", `Bearer ${charlieTenantAToken}`);
      assert.equal(apiRes.status, 403);
      assert.match(apiRes.body.message, /suspended or inactive/i);

      // 4. Charlie attempting to switch back to Tenant A is rejected
      const switchAttempt = await request(app)
        .post("/api/workspaces/switch")
        .set("Authorization", `Bearer ${charlieToken}`)
        .send({ workspaceId: tenantAId });
      assert.equal(switchAttempt.status, 403);
      assert.match(switchAttempt.body.message, /not an active member/i);
    });

    it("should block workspace switching and API access when membership is removed", async () => {
      // 1. Add Diana to Tenant A
      const regDiana = await request(app).post("/api/auth/register").send({
        name: "Diana Admin",
        email: "diana@member.test",
        password: "password123",
        organizationName: "Diana Temp Org"
      });
      const dianaUserId = regDiana.body.data.user.id;
      const dianaToken = regDiana.body.data.token;

      await request(app)
        .post(`/api/workspaces/${tenantAId}/members`)
        .set("Authorization", `Bearer ${tenantAToken}`)
        .send({
          email: "diana@member.test",
          role: "admin"
        });

      const switchRes = await request(app)
        .post("/api/workspaces/switch")
        .set("Authorization", `Bearer ${dianaToken}`)
        .send({ workspaceId: tenantAId });
      const dianaTenantAToken = switchRes.body.data.token;

      // 2. Alice removes Diana from Tenant A
      const removeRes = await request(app)
        .delete(`/api/workspaces/${tenantAId}/members/${dianaUserId}`)
        .set("Authorization", `Bearer ${tenantAToken}`);
      assert.equal(removeRes.status, 200);

      // 3. Diana's old token for Tenant A is immediately denied
      const apiRes = await request(app)
        .get("/api/services")
        .set("Authorization", `Bearer ${dianaTenantAToken}`);
      assert.equal(apiRes.status, 403);
      assert.match(apiRes.body.message, /not an active member/i);

      // 4. Diana cannot switch back to Tenant A
      const switchAttempt = await request(app)
        .post("/api/workspaces/switch")
        .set("Authorization", `Bearer ${dianaToken}`)
        .send({ workspaceId: tenantAId });
      assert.equal(switchAttempt.status, 403);
    });
  });

  describe("6. Request Body & Query TenantId Injection Immunity", () => {
    it("should ignore tenantId provided in request bodies and strictly enforce JWT tenant context", async () => {
      // Attempt to forge tenantId on service creation
      const svcRes = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${tenantAToken}`)
        .send({
          name: "Injection Test Service",
          trackingType: "metered",
          currency: "USD",
          unit: "queries",
          unitPrice: "0.01",
          tenantId: tenantBId // Malicious tenantId override attempt
        });
      assert.equal(svcRes.status, 201);
      assert.equal(svcRes.body.data.service.tenantId, tenantAId);

      // Verify in DB that it belongs to Tenant A
      const savedSvc = await TrackedService.findById(svcRes.body.data.service.id);
      assert.equal(savedSvc.tenantId.toString(), tenantAId.toString());

      // Attempt to forge tenantId on usage ingestion
      const usageRes = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${tenantAToken}`)
        .send({
          serviceId: svcRes.body.data.service.id,
          quantity: "100",
          unit: "queries",
          tenantId: tenantBId // Malicious override
        });
      assert.equal(usageRes.status, 201);
      assert.equal(usageRes.body.data.record.tenantId, tenantAId);

      const savedUsage = await UsageRecord.findById(usageRes.body.data.record.id);
      assert.equal(savedUsage.tenantId.toString(), tenantAId.toString());

      // Attempt to forge tenantId on budget creation
      const budgetRes = await request(app)
        .post("/api/budgets")
        .set("Authorization", `Bearer ${tenantAToken}`)
        .send({
          name: "Injected Budget",
          amount: "50.00",
          currency: "USD",
          startDate: "2026-11-01T00:00:00.000Z",
          endDate: "2026-11-30T00:00:00.000Z",
          tenantId: tenantBId
        });
      assert.equal(budgetRes.status, 201);
      assert.equal(budgetRes.body.data.budget.tenantId, tenantAId);

      const savedBudget = await Budget.findById(budgetRes.body.data.budget.id);
      assert.equal(savedBudget.tenantId.toString(), tenantAId.toString());
    });
  });
});
