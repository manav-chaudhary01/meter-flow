import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import Tenant from "../src/models/Tenant.js";
import User from "../src/models/User.js";
import Membership from "../src/models/Membership.js";
import TrackedService from "../src/models/TrackedService.js";
import UsageRecord from "../src/models/UsageRecord.js";
import BillingRecord from "../src/models/BillingRecord.js";
import Budget from "../src/models/Budget.js";
import BudgetAlert from "../src/models/BudgetAlert.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";

describe("Milestone G: End-to-End Business Workflow Integration", () => {
  let userAToken;
  let userAId;
  let userBToken;
  let userBId;
  let userCToken;
  let userCId;
  let orgCId;

  let acmeWorkspaceId;
  let gpuServiceId;
  let apiServiceId;
  let gpuUsageId;
  let apiUsageId;
  let billingRecordId;
  let budgetId;
  let alert100Id;

  before(async () => {
    await connectTestDb();
    await Membership.syncIndexes();
    await TrackedService.syncIndexes();
    await UsageRecord.syncIndexes();
    await BillingRecord.syncIndexes();
    await Budget.syncIndexes();
    await BudgetAlert.syncIndexes();
    await clearTestDb();
  });

  after(async () => {
    await disconnectTestDb();
  });

  it("Step 1: Register and authenticate users", async () => {
    // Register User A (Alice - Acme Admin)
    const regA = await request(app).post("/api/auth/register").send({
      name: "Alice Acme",
      email: "alice@acme-corp.com",
      password: "Password123!",
      organizationName: "Acme Initial Workspace"
    });
    assert.equal(regA.status, 201);
    assert.ok(regA.body.data.token);
    userAToken = regA.body.data.token;
    userAId = regA.body.data.user.id;

    // Register User B (Bob - Acme Developer)
    const regB = await request(app).post("/api/auth/register").send({
      name: "Bob Developer",
      email: "bob@developer-labs.com",
      password: "Password123!",
      organizationName: "Bob Personal Labs"
    });
    assert.equal(regB.status, 201);
    userBToken = regB.body.data.token;
    userBId = regB.body.data.user.id;

    // Register User C (Charlie - Competitor Corp)
    const regC = await request(app).post("/api/auth/register").send({
      name: "Charlie Competitor",
      email: "charlie@competitor-systems.com",
      password: "Password123!",
      organizationName: "Competitor Systems Corp"
    });
    assert.equal(regC.status, 201);
    userCToken = regC.body.data.token;
    userCId = regC.body.data.user.id;
    orgCId = regC.body.data.tenant.id;

    // Verify authentication via GET /api/auth/me
    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${userAToken}`);
    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.data.userId, userAId);
  });

  it("Step 2: Create and switch to organization workspace", async () => {
    // Alice creates "Acme Production" organization workspace
    const wsRes = await request(app)
      .post("/api/workspaces")
      .set("Authorization", `Bearer ${userAToken}`)
      .send({
        name: "Acme Production",
        type: "organization"
      });
    assert.equal(wsRes.status, 201);
    acmeWorkspaceId = wsRes.body.data.workspace.id;

    // Alice switches to "Acme Production"
    const switchRes = await request(app)
      .post("/api/workspaces/switch")
      .set("Authorization", `Bearer ${userAToken}`)
      .send({ workspaceId: acmeWorkspaceId });
    assert.equal(switchRes.status, 200);
    userAToken = switchRes.body.data.token; // Refresh token scoped to Acme Production

    // List workspaces and verify isCurrent
    const listRes = await request(app)
      .get("/api/workspaces")
      .set("Authorization", `Bearer ${userAToken}`);
    assert.equal(listRes.status, 200);
    const activeWs = listRes.body.data.workspaces.find((w) => w.isCurrent);
    assert.equal(activeWs.id, acmeWorkspaceId);
    assert.equal(activeWs.role, "owner");
  });

  it("Step 3: Workspace membership and RBAC role restrictions", async () => {
    // Alice adds Bob as a regular 'member' in Acme Production
    const addMemberRes = await request(app)
      .post(`/api/workspaces/${acmeWorkspaceId}/members`)
      .set("Authorization", `Bearer ${userAToken}`)
      .send({ email: "bob@developer-labs.com", role: "member" });
    assert.equal(addMemberRes.status, 201);

    // Bob switches his active context to Acme Production
    const bobSwitchRes = await request(app)
      .post("/api/workspaces/switch")
      .set("Authorization", `Bearer ${userBToken}`)
      .send({ workspaceId: acmeWorkspaceId });
    assert.equal(bobSwitchRes.status, 200);
    userBToken = bobSwitchRes.body.data.token;

    // Bob (regular member) attempts to create a service -> MUST receive 403 Forbidden
    const rbacServiceRes = await request(app)
      .post("/api/services")
      .set("Authorization", `Bearer ${userBToken}`)
      .send({
        name: "Unauthorized Service",
        trackingType: "metered",
        unit: "unit",
        unitPrice: 1.0
      });
    assert.equal(rbacServiceRes.status, 403);
    assert.match(rbacServiceRes.body.message, /Forbidden: this action requires one of the following roles/);

    // Bob attempts to generate bills -> MUST receive 403 Forbidden
    const rbacBillingRes = await request(app)
      .post("/api/billing/generate")
      .set("Authorization", `Bearer ${userBToken}`)
      .send({
        billingPeriodStart: "2026-01-01T00:00:00.000Z",
        billingPeriodEnd: "2026-02-01T00:00:00.000Z"
      });
    assert.equal(rbacBillingRes.status, 403);
  });

  it("Step 4: Create tracked services (hybrid and metered)", async () => {
    // Service 1: Hybrid GPU Cluster ($100/mo subscription + $0.50/GPU-hour)
    const gpuRes = await request(app)
      .post("/api/services")
      .set("Authorization", `Bearer ${userAToken}`)
      .send({
        name: "Cloud GPU Cluster",
        provider: "Acme Infrastructure",
        category: "compute",
        trackingType: "hybrid",
        currency: "USD",
        unit: "gpu-hour",
        unitPrice: 0.5,
        subscriptionAmount: 100.0,
        billingInterval: "monthly"
      });
    assert.equal(gpuRes.status, 201);
    gpuServiceId = gpuRes.body.data.service.id;

    // Service 2: Metered API Gateway ($0.002/request)
    const apiRes = await request(app)
      .post("/api/services")
      .set("Authorization", `Bearer ${userAToken}`)
      .send({
        name: "API Gateway Requests",
        provider: "Acme Edge",
        category: "network",
        trackingType: "metered",
        currency: "USD",
        unit: "request",
        unitPrice: 0.002
      });
    assert.equal(apiRes.status, 201);
    apiServiceId = apiRes.body.data.service.id;
  });

  it("Step 5: Ingest usage and verify idempotency protection", async () => {
    // Ingest GPU usage: 200 hours with idempotencyKey
    const gpuUsagePayload = {
      serviceId: gpuServiceId,
      quantity: 200,
      unit: "gpu-hour",
      occurredAt: "2026-05-10T14:30:00.000Z",
      source: "scheduler",
      idempotencyKey: "gpu-cluster-job-4510"
    };

    const gpuUsageRes1 = await request(app)
      .post("/api/usage")
      .set("Authorization", `Bearer ${userAToken}`)
      .send(gpuUsagePayload);
    assert.equal(gpuUsageRes1.status, 201);
    assert.equal(gpuUsageRes1.body.data.idempotentReplay, false);
    gpuUsageId = gpuUsageRes1.body.data.record.id;

    // Replay identical GPU usage payload -> returns 200 OK with idempotentReplay: true
    const gpuUsageReplay = await request(app)
      .post("/api/usage")
      .set("Authorization", `Bearer ${userAToken}`)
      .send(gpuUsagePayload);
    assert.equal(gpuUsageReplay.status, 200);
    assert.equal(gpuUsageReplay.body.data.idempotentReplay, true);
    assert.equal(gpuUsageReplay.body.data.record.id, gpuUsageId);

    // Ingest API usage: 50,000 requests with externalEventId
    const apiUsagePayload = {
      serviceId: apiServiceId,
      quantity: 50000,
      unit: "request",
      occurredAt: "2026-05-15T09:00:00.000Z",
      source: "api-gateway",
      externalEventId: "evt-api-month-batch-900"
    };

    const apiUsageRes = await request(app)
      .post("/api/usage")
      .set("Authorization", `Bearer ${userAToken}`)
      .send(apiUsagePayload);
    assert.equal(apiUsageRes.status, 201);
    apiUsageId = apiUsageRes.body.data.record.id;
  });

  it("Step 6: Query usage history and aggregation summaries", async () => {
    // Query usage history for May 2026
    const historyRes = await request(app)
      .get("/api/usage?startDate=2026-05-01T00:00:00.000Z&endDate=2026-06-01T00:00:00.000Z")
      .set("Authorization", `Bearer ${userAToken}`);
    assert.equal(historyRes.status, 200);
    assert.equal(historyRes.body.data.pagination.total, 2);

    // Query usage summary aggregated by service
    const summaryRes = await request(app)
      .get("/api/usage/summary?startDate=2026-05-01T00:00:00.000Z&endDate=2026-06-01T00:00:00.000Z")
      .set("Authorization", `Bearer ${userAToken}`);
    assert.equal(summaryRes.status, 200);
    assert.equal(summaryRes.body.data.count, 2);

    const gpuSummary = summaryRes.body.data.summary.find(
      (s) => s.serviceId.toString() === gpuServiceId.toString()
    );
    assert.ok(gpuSummary);
    assert.equal(gpuSummary.totalQuantity, "200");

    const apiSummary = summaryRes.body.data.summary.find(
      (s) => s.serviceId.toString() === apiServiceId.toString()
    );
    assert.ok(apiSummary);
    assert.equal(apiSummary.totalQuantity, "50000");
  });

  it("Step 7 & 8: Generate billing record, verify line items and reconciled usage", async () => {
    const periodStart = "2026-05-01T00:00:00.000Z";
    const periodEnd = "2026-06-01T00:00:00.000Z";

    const billGenRes = await request(app)
      .post("/api/billing/generate")
      .set("Authorization", `Bearer ${userAToken}`)
      .send({
        billingPeriodStart: periodStart,
        billingPeriodEnd: periodEnd,
        currency: "USD"
      });

    assert.equal(billGenRes.status, 201);
    assert.equal(billGenRes.body.data.isExisting, false);

    const bill = billGenRes.body.data.billingRecord;
    billingRecordId = bill.id;

    // Expected Line Items:
    // 1. Monthly subscription for GPU Cluster = $100.00
    // 2. 200 GPU-hours @ $0.50/hr = $100.00
    // 3. 50,000 API requests @ $0.002 = $100.00
    // Total = $300.00
    assert.equal(bill.total, "300.00");
    assert.equal(bill.lineItems.length, 3);

    // Verify reconciled usage records linked to this invoice
    const usageBilledRes = await request(app)
      .get(`/api/billing/${billingRecordId}/usage`)
      .set("Authorization", `Bearer ${userAToken}`);

    assert.equal(usageBilledRes.status, 200);
    assert.equal(usageBilledRes.body.data.count, 2);
    const billedIds = usageBilledRes.body.data.usageRecords.map((r) => r.id.toString());
    assert.ok(billedIds.includes(gpuUsageId.toString()));
    assert.ok(billedIds.includes(apiUsageId.toString()));
  });

  it("Step 9: Idempotent billing retry verification", async () => {
    // Retry generation for exact same period and currency
    const retryRes = await request(app)
      .post("/api/billing/generate")
      .set("Authorization", `Bearer ${userAToken}`)
      .send({
        billingPeriodStart: "2026-05-01T00:00:00.000Z",
        billingPeriodEnd: "2026-06-01T00:00:00.000Z",
        currency: "USD"
      });

    assert.equal(retryRes.status, 200);
    assert.equal(retryRes.body.data.isExisting, true);
    assert.equal(retryRes.body.data.billingRecord.id, billingRecordId);
    assert.equal(retryRes.body.data.billingRecord.total, "300.00");

    // Verify database contains exactly 1 invoice for this period
    const invoiceCount = await BillingRecord.countDocuments({
      tenantId: acmeWorkspaceId,
      billingPeriodStart: new Date("2026-05-01T00:00:00.000Z"),
      billingPeriodEnd: new Date("2026-06-01T00:00:00.000Z")
    });
    assert.equal(invoiceCount, 1, "Duplicate billing record must never be created");
  });

  it("Step 10, 11 & 12: Create budget, calculate actual spend, and verify multi-threshold alerts", async () => {
    // Create Budget: $250.00 for May 2026 with thresholds 50%, 80%, 100%
    const budgetRes = await request(app)
      .post("/api/budgets")
      .set("Authorization", `Bearer ${userAToken}`)
      .send({
        name: "Acme Infrastructure May Budget",
        amount: 250.0,
        currency: "USD",
        startDate: "2026-05-01T00:00:00.000Z",
        endDate: "2026-06-01T00:00:00.000Z",
        thresholds: [50, 80, 100]
      });

    assert.equal(budgetRes.status, 201);
    budgetId = budgetRes.body.data.budget.id;

    // Actual spend is $300.00 (from the finalized $300.00 bill)
    // 300 / 250 = 120% utilized
    assert.equal(budgetRes.body.data.budget.actualSpend, "300.00");
    assert.equal(budgetRes.body.data.budget.percentageUsed, 120);

    // Verify that alerts for all 3 thresholds (50, 80, 100) were triggered and persisted
    const alertsRes = await request(app)
      .get(`/api/budgets/alerts?budgetId=${budgetId}`)
      .set("Authorization", `Bearer ${userAToken}`);

    assert.equal(alertsRes.status, 200);
    const alerts = alertsRes.body.data.alerts;
    assert.equal(alerts.length, 3);

    const a50 = alerts.find((a) => a.threshold === 50);
    const a80 = alerts.find((a) => a.threshold === 80);
    const a100 = alerts.find((a) => a.threshold === 100);

    assert.ok(a50 && a80 && a100);
    assert.equal(a50.alertType, "threshold_reached");
    assert.equal(a80.alertType, "threshold_reached");
    assert.equal(a100.alertType, "threshold_exceeded");
    alert100Id = a100.id;
  });

  it("Step 13: Retrieve forecast and validate explainability", async () => {
    const budgetDetails = await request(app)
      .get(`/api/budgets/${budgetId}`)
      .set("Authorization", `Bearer ${userAToken}`);

    assert.equal(budgetDetails.status, 200);
    const forecast = budgetDetails.body.data.budget.forecast;
    assert.ok(forecast);
    assert.equal(forecast.method, "linear_run_rate");
    assert.ok(forecast.assumptions);
    assert.ok(forecast.limitations);
    assert.ok(forecast.dataWindow);
  });

  it("Step 14: Acknowledge budget alert", async () => {
    const ackRes = await request(app)
      .patch(`/api/budgets/alerts/${alert100Id}/ack`)
      .set("Authorization", `Bearer ${userAToken}`);

    assert.equal(ackRes.status, 200);
    assert.equal(ackRes.body.data.alert.status, "acknowledged");
  });

  it("Step 15: Cross-Tenant Isolation Enforcement", async () => {
    // User C belongs to "Competitor Systems Corp" and must NOT access any of Acme's resources:

    // 1. Members
    const cMembers = await request(app)
      .get(`/api/workspaces/${acmeWorkspaceId}/members`)
      .set("Authorization", `Bearer ${userCToken}`);
    assert.equal(cMembers.status, 403);

    // 2. Tracked Services
    const cService = await request(app)
      .get(`/api/services/${gpuServiceId}`)
      .set("Authorization", `Bearer ${userCToken}`);
    assert.equal(cService.status, 404);

    // 3. Usage Records
    const cUsage = await request(app)
      .get(`/api/usage/${gpuUsageId}`)
      .set("Authorization", `Bearer ${userCToken}`);
    assert.equal(cUsage.status, 404);

    // 4. Billing Records
    const cBilling = await request(app)
      .get(`/api/billing/${billingRecordId}`)
      .set("Authorization", `Bearer ${userCToken}`);
    assert.equal(cBilling.status, 404);

    // 5. Billing Usage
    const cBillingUsage = await request(app)
      .get(`/api/billing/${billingRecordId}/usage`)
      .set("Authorization", `Bearer ${userCToken}`);
    assert.equal(cBillingUsage.status, 404);

    // 6. Budgets
    const cBudget = await request(app)
      .get(`/api/budgets/${budgetId}`)
      .set("Authorization", `Bearer ${userCToken}`);
    assert.equal(cBudget.status, 404);

    // 7. Budget Alerts
    const cAlerts = await request(app)
      .get(`/api/budgets/alerts`)
      .set("Authorization", `Bearer ${userCToken}`);
    assert.equal(cAlerts.status, 200);
    assert.equal(cAlerts.body.data.alerts.length, 0, "Competitor must see 0 alerts from Acme");

    // 8. Usage Summary
    const cSummary = await request(app)
      .get(`/api/usage/summary`)
      .set("Authorization", `Bearer ${userCToken}`);
    assert.equal(cSummary.status, 200);
    assert.equal(cSummary.body.data.count, 0, "Competitor must see 0 aggregated usage records from Acme");
  });
});
