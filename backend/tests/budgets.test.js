import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import Budget from "../src/models/Budget.js";
import BudgetAlert from "../src/models/BudgetAlert.js";
import BillingRecord from "../src/models/BillingRecord.js";
import { generateSpendForecast } from "../src/services/spendForecaster.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";

describe("Budget Management, Spend Calculation, Alerts & Forecasting API", () => {
  let ownerTokenA;
  let ownerTokenB;
  let memberTokenA;
  let tenantAId;
  let tenantBId;

  before(async () => {
    await connectTestDb();
    await Budget.syncIndexes();
    await BudgetAlert.syncIndexes();
  });

  after(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();

    // 1. Register Tenant A Owner (Org Alpha)
    const regA = await request(app).post("/api/auth/register").send({
      name: "Alice Owner",
      email: "alice@org-a.com",
      password: "password123",
      organizationName: "Org Alpha"
    });
    ownerTokenA = regA.body.data.token;
    tenantAId = regA.body.data.tenant.id;

    // 2. Register Tenant B Owner (Org Beta)
    const regB = await request(app).post("/api/auth/register").send({
      name: "Bob Owner",
      email: "bob@org-b.com",
      password: "password123",
      organizationName: "Org Beta"
    });
    ownerTokenB = regB.body.data.token;
    tenantBId = regB.body.data.tenant.id;

    // 3. Register a regular member in Tenant A
    await request(app).post("/api/auth/register").send({
      name: "Charlie Member",
      email: "charlie@org-a.com",
      password: "password123",
      organizationName: "Charlie Temp Org"
    });

    await request(app)
      .post(`/api/workspaces/${tenantAId}/members`)
      .set("Authorization", `Bearer ${ownerTokenA}`)
      .send({ email: "charlie@org-a.com", role: "member" });

    const loginCharlie = await request(app).post("/api/auth/login").send({
      email: "charlie@org-a.com",
      password: "password123"
    });

    const switchRes = await request(app)
      .post("/api/workspaces/switch")
      .set("Authorization", `Bearer ${loginCharlie.body.data.token}`)
      .send({ workspaceId: tenantAId });
    memberTokenA = switchRes.body.data.token;
  });

  describe("POST /api/budgets (Budget Creation & Validation)", () => {
    it("should create a valid monthly budget with custom thresholds", async () => {
      const res = await request(app)
        .post("/api/budgets")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "Q1 Infrastructure Budget",
          amount: "1500.00",
          currency: "USD",
          periodType: "monthly",
          startDate: "2026-03-01T00:00:00.000Z",
          endDate: "2026-04-01T00:00:00.000Z",
          thresholds: [50, 75, 90, 100]
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      const budget = res.body.data.budget;
      assert.ok(budget.id);
      assert.equal(budget.name, "Q1 Infrastructure Budget");
      assert.equal(budget.amount, "1500.00");
      assert.equal(budget.currency, "USD");
      assert.equal(budget.status, "active");
      assert.deepEqual(budget.thresholds, [50, 75, 90, 100]);
      assert.equal(budget.actualSpend, "0.00");
      assert.equal(budget.percentageUsed, 0);
    });

    it("should reject budget creation with missing name, amount, or dates (400)", async () => {
      // Missing name
      const r1 = await request(app)
        .post("/api/budgets")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          amount: "1000.00",
          startDate: "2026-03-01T00:00:00.000Z",
          endDate: "2026-04-01T00:00:00.000Z"
        });
      assert.equal(r1.status, 400);

      // Missing amount
      const r2 = await request(app)
        .post("/api/budgets")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "Test Budget",
          startDate: "2026-03-01T00:00:00.000Z",
          endDate: "2026-04-01T00:00:00.000Z"
        });
      assert.equal(r2.status, 400);

      // Missing dates
      const r3 = await request(app)
        .post("/api/budgets")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "Test Budget",
          amount: "1000.00"
        });
      assert.equal(r3.status, 400);
    });

    it("should reject non-positive amount (amount <= 0)", async () => {
      const rZero = await request(app)
        .post("/api/budgets")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "Zero Budget",
          amount: "0.00",
          startDate: "2026-03-01T00:00:00.000Z",
          endDate: "2026-04-01T00:00:00.000Z"
        });
      assert.equal(rZero.status, 400);
      assert.match(rZero.body.message, /positive number/i);

      const rNeg = await request(app)
        .post("/api/budgets")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "Negative Budget",
          amount: "-50.00",
          startDate: "2026-03-01T00:00:00.000Z",
          endDate: "2026-04-01T00:00:00.000Z"
        });
      assert.equal(rNeg.status, 400);
    });

    it("should reject invalid date range (startDate >= endDate)", async () => {
      const res = await request(app)
        .post("/api/budgets")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "Inverted Dates Budget",
          amount: "100.00",
          startDate: "2026-04-01T00:00:00.000Z",
          endDate: "2026-03-01T00:00:00.000Z"
        });
      assert.equal(res.status, 400);
      assert.match(res.body.message, /strictly before/i);
    });

    it("should reject invalid threshold values (> 200 or <= 0)", async () => {
      const res = await request(app)
        .post("/api/budgets")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "Invalid Threshold Budget",
          amount: "500.00",
          startDate: "2026-03-01T00:00:00.000Z",
          endDate: "2026-04-01T00:00:00.000Z",
          thresholds: [50, 250] // 250 is > 200
        });
      assert.equal(res.status, 400);
      assert.match(res.body.message, /between 1 and 200/i);
    });

    it("should reject non-admin/non-owner member from creating budgets (403)", async () => {
      const res = await request(app)
        .post("/api/budgets")
        .set("Authorization", `Bearer ${memberTokenA}`)
        .send({
          name: "Member Budget",
          amount: "100.00",
          startDate: "2026-03-01T00:00:00.000Z",
          endDate: "2026-04-01T00:00:00.000Z"
        });
      assert.equal(res.status, 403);
      assert.match(res.body.message, /requires one of the following roles/i);
    });
  });

  describe("GET /api/budgets & GET /api/budgets/:id", () => {
    let budgetAId;

    beforeEach(async () => {
      const bRes = await request(app)
        .post("/api/budgets")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "Production Cloud Spend",
          amount: "1000.00",
          currency: "USD",
          startDate: "2026-03-01T00:00:00.000Z",
          endDate: "2026-04-01T00:00:00.000Z",
          thresholds: [50, 80, 100]
        });
      budgetAId = bRes.body.data.budget.id;
    });

    it("should list budgets for active workspace with pagination and computed spend", async () => {
      const res = await request(app)
        .get("/api/budgets")
        .set("Authorization", `Bearer ${ownerTokenA}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.budgets.length, 1);
      assert.equal(res.body.data.budgets[0].id, budgetAId);
      assert.equal(res.body.data.budgets[0].amount, "1000.00");
    });

    it("should allow regular members to view workspace budgets", async () => {
      const res = await request(app)
        .get("/api/budgets")
        .set("Authorization", `Bearer ${memberTokenA}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.budgets.length, 1);
    });

    it("should retrieve budget by ID with associated alerts", async () => {
      const res = await request(app)
        .get(`/api/budgets/${budgetAId}`)
        .set("Authorization", `Bearer ${ownerTokenA}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.budget.id, budgetAId);
      assert.ok(Array.isArray(res.body.data.alerts));
    });

    it("should enforce workspace isolation (Tenant B cannot see Tenant A budgets)", async () => {
      // List
      const listRes = await request(app)
        .get("/api/budgets")
        .set("Authorization", `Bearer ${ownerTokenB}`);
      assert.equal(listRes.status, 200);
      assert.equal(listRes.body.data.budgets.length, 0);

      // Get by ID
      const getRes = await request(app)
        .get(`/api/budgets/${budgetAId}`)
        .set("Authorization", `Bearer ${ownerTokenB}`);
      assert.equal(getRes.status, 404);
    });
  });

  describe("PUT /api/budgets/:id & DELETE /api/budgets/:id (Soft Deactivation)", () => {
    let budgetId;

    beforeEach(async () => {
      const bRes = await request(app)
        .post("/api/budgets")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "Original Budget",
          amount: "500.00",
          startDate: "2026-03-01T00:00:00.000Z",
          endDate: "2026-04-01T00:00:00.000Z"
        });
      budgetId = bRes.body.data.budget.id;
    });

    it("should update budget name, amount, and thresholds when authorized", async () => {
      const res = await request(app)
        .put(`/api/budgets/${budgetId}`)
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "Updated Cloud Budget",
          amount: "800.00",
          thresholds: [60, 85, 100]
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.budget.name, "Updated Cloud Budget");
      assert.equal(res.body.data.budget.amount, "800.00");
      assert.deepEqual(res.body.data.budget.thresholds, [60, 85, 100]);
    });

    it("should reject updates from regular members (403)", async () => {
      const res = await request(app)
        .put(`/api/budgets/${budgetId}`)
        .set("Authorization", `Bearer ${memberTokenA}`)
        .send({ name: "Hacked Name" });
      assert.equal(res.status, 403);
    });

    it("should soft-deactivate (archive) a budget on DELETE and retain document", async () => {
      const res = await request(app)
        .delete(`/api/budgets/${budgetId}`)
        .set("Authorization", `Bearer ${ownerTokenA}`);

      assert.equal(res.status, 200);
      assert.match(res.body.message, /archived/i);

      // Verify the budget still exists in database but status is archived
      const dbBudget = await Budget.findById(budgetId);
      assert.ok(dbBudget);
      assert.equal(dbBudget.status, "archived");
    });
  });

  describe("Actual Spend Calculation & Currency Isolation", () => {
    it("should sum eligible bills (issued/finalized) and exclude void/draft or other currency bills", async () => {
      const startDate = "2026-03-01T00:00:00.000Z";
      const endDate = "2026-04-01T00:00:00.000Z";

      // Create Budget: $1000 USD
      const bRes = await request(app)
        .post("/api/budgets")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "Compute Budget",
          amount: "1000.00",
          currency: "USD",
          startDate,
          endDate
        });
      const budgetId = bRes.body.data.budget.id;

      // 1. Eligible Bill 1 (issued, $150.25 USD)
      await BillingRecord.create({
        tenantId: tenantAId,
        invoiceNumber: "INV-20260305-001",
        billingPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
        billingPeriodEnd: new Date("2026-03-15T00:00:00.000Z"),
        currency: "USD",
        subtotal: "150.25",
        total: "150.25",
        status: "issued"
      });

      // 2. Eligible Bill 2 (finalized, $249.75 USD)
      await BillingRecord.create({
        tenantId: tenantAId,
        invoiceNumber: "INV-20260320-002",
        billingPeriodStart: new Date("2026-03-15T00:00:00.000Z"),
        billingPeriodEnd: new Date("2026-03-31T00:00:00.000Z"),
        currency: "USD",
        subtotal: "249.75",
        total: "249.75",
        status: "finalized"
      });

      // 3. Ineligible Bill: VOID ($500.00 USD) - Must NOT be counted
      await BillingRecord.create({
        tenantId: tenantAId,
        invoiceNumber: "INV-20260325-VOID",
        billingPeriodStart: new Date("2026-03-20T00:00:00.000Z"),
        billingPeriodEnd: new Date("2026-03-25T00:00:00.000Z"),
        currency: "USD",
        subtotal: "500.00",
        total: "500.00",
        status: "void"
      });

      // 4. Ineligible Bill: EUR currency ($300.00 EUR) - Must NOT be mixed with USD
      await BillingRecord.create({
        tenantId: tenantAId,
        invoiceNumber: "INV-20260310-EUR",
        billingPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
        billingPeriodEnd: new Date("2026-04-01T00:00:00.000Z"),
        currency: "EUR",
        subtotal: "300.00",
        total: "300.00",
        status: "issued"
      });

      // 5. Ineligible Bill: Outside Period (February 2026) - Must NOT be counted
      await BillingRecord.create({
        tenantId: tenantAId,
        invoiceNumber: "INV-20260215-OLD",
        billingPeriodStart: new Date("2026-02-01T00:00:00.000Z"),
        billingPeriodEnd: new Date("2026-03-01T00:00:00.000Z"),
        currency: "USD",
        subtotal: "100.00",
        total: "100.00",
        status: "issued"
      });

      // Fetch Budget and inspect actual spend: $150.25 + $249.75 = $400.00 exactly (40.0%)
      const res = await request(app)
        .get(`/api/budgets/${budgetId}`)
        .set("Authorization", `Bearer ${ownerTokenA}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.budget.actualSpend, "400.00");
      assert.equal(res.body.data.budget.percentageUsed, 40);
    });
  });

  describe("Spend-Threshold Alerts (Multi-Threshold Jumps & Duplicate Prevention)", () => {
    let budgetId;

    beforeEach(async () => {
      const bRes = await request(app)
        .post("/api/budgets")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "Alert Test Budget",
          amount: "1000.00",
          currency: "USD",
          startDate: "2026-03-01T00:00:00.000Z",
          endDate: "2026-04-01T00:00:00.000Z",
          thresholds: [50, 80, 100]
        });
      budgetId = bRes.body.data.budget.id;
    });

    it("should trigger multiple threshold alerts (50% and 80%) when spend jumps from 0% to 85%", async () => {
      // Create bill for $850.00 (85% of $1000)
      await BillingRecord.create({
        tenantId: tenantAId,
        invoiceNumber: "INV-20260310-850",
        billingPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
        billingPeriodEnd: new Date("2026-03-15T00:00:00.000Z"),
        currency: "USD",
        subtotal: "850.00",
        total: "850.00",
        status: "issued"
      });

      const evalRes = await request(app)
        .post(`/api/budgets/${budgetId}/evaluate`)
        .set("Authorization", `Bearer ${ownerTokenA}`);

      assert.equal(evalRes.status, 200);
      assert.equal(evalRes.body.data.actualSpend, "850.00");
      assert.equal(evalRes.body.data.percentageUsed, 85);
      // Both 50% and 80% should be triggered
      assert.equal(evalRes.body.data.newAlerts.length, 2);

      const t50 = evalRes.body.data.newAlerts.find((a) => a.threshold === 50);
      const t80 = evalRes.body.data.newAlerts.find((a) => a.threshold === 80);
      assert.ok(t50);
      assert.ok(t80);
      assert.equal(t50.alertType, "threshold_reached");
      assert.equal(t80.alertType, "threshold_reached");
    });

    it("should NOT duplicate alerts on repeated evaluation for the same threshold", async () => {
      // Create bill for $850.00
      await BillingRecord.create({
        tenantId: tenantAId,
        invoiceNumber: "INV-20260310-850",
        billingPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
        billingPeriodEnd: new Date("2026-03-15T00:00:00.000Z"),
        currency: "USD",
        subtotal: "850.00",
        total: "850.00",
        status: "issued"
      });

      // 1st evaluation
      await request(app)
        .post(`/api/budgets/${budgetId}/evaluate`)
        .set("Authorization", `Bearer ${ownerTokenA}`);

      // 2nd evaluation: same spend
      const eval2 = await request(app)
        .post(`/api/budgets/${budgetId}/evaluate`)
        .set("Authorization", `Bearer ${ownerTokenA}`);

      assert.equal(eval2.status, 200);
      assert.equal(eval2.body.data.newAlerts.length, 0); // 0 new alerts!
      assert.equal(eval2.body.data.existingAlerts.length, 2);

      // Verify DB contains exactly 2 alerts
      const count = await BudgetAlert.countDocuments({ budgetId });
      assert.equal(count, 2);
    });

    it("should trigger threshold_exceeded alert when spend crosses 100%", async () => {
      // Create bill for $1050.00 (105% of $1000)
      await BillingRecord.create({
        tenantId: tenantAId,
        invoiceNumber: "INV-20260320-1050",
        billingPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
        billingPeriodEnd: new Date("2026-03-25T00:00:00.000Z"),
        currency: "USD",
        subtotal: "1050.00",
        total: "1050.00",
        status: "issued"
      });

      const evalRes = await request(app)
        .post(`/api/budgets/${budgetId}/evaluate`)
        .set("Authorization", `Bearer ${ownerTokenA}`);

      assert.equal(evalRes.status, 200);
      assert.equal(evalRes.body.data.newAlerts.length, 3); // 50, 80, 100

      const t100 = evalRes.body.data.newAlerts.find((a) => a.threshold === 100);
      assert.ok(t100);
      assert.equal(t100.alertType, "threshold_exceeded");
      assert.equal(t100.percentageUsed, 105);
    });

    it("should allow acknowledging an alert", async () => {
      // Trigger an alert first
      await BillingRecord.create({
        tenantId: tenantAId,
        invoiceNumber: "INV-20260310-500",
        billingPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
        billingPeriodEnd: new Date("2026-03-15T00:00:00.000Z"),
        currency: "USD",
        subtotal: "600.00",
        total: "600.00",
        status: "issued"
      });

      const evalRes = await request(app)
        .post(`/api/budgets/${budgetId}/evaluate`)
        .set("Authorization", `Bearer ${ownerTokenA}`);

      const alertId = evalRes.body.data.newAlerts[0].id;

      // Acknowledge alert
      const ackRes = await request(app)
        .patch(`/api/budgets/alerts/${alertId}/ack`)
        .set("Authorization", `Bearer ${memberTokenA}`);

      assert.equal(ackRes.status, 200);
      assert.equal(ackRes.body.data.alert.status, "acknowledged");
    });
  });

  describe("Spending Forecast Module (Explainable Linear Run-Rate)", () => {
    it("should return hasSufficientData: false when budget period has not started yet", () => {
      const budget = {
        amount: "1000.00",
        currency: "USD",
        startDate: new Date("2026-04-01T00:00:00.000Z"),
        endDate: new Date("2026-05-01T00:00:00.000Z")
      };

      const evalDate = new Date("2026-03-15T00:00:00.000Z"); // Before period start
      const forecast = generateSpendForecast({ budget, actualSpend: "0.00", evaluationDate: evalDate });

      assert.equal(forecast.hasSufficientData, false);
      assert.equal(forecast.forecastSpend, null);
      assert.match(forecast.reason, /not started yet/i);
    });

    it("should return hasSufficientData: false when less than 1 day has elapsed in the period", () => {
      const budget = {
        amount: "1000.00",
        currency: "USD",
        startDate: new Date("2026-03-01T00:00:00.000Z"),
        endDate: new Date("2026-04-01T00:00:00.000Z")
      };

      const evalDate = new Date("2026-03-01T06:00:00.000Z"); // Only 6 hours elapsed
      const forecast = generateSpendForecast({ budget, actualSpend: "50.00", evaluationDate: evalDate });

      assert.equal(forecast.hasSufficientData, false);
      assert.equal(forecast.forecastSpend, null);
      assert.match(forecast.reason, /at least 1 full day/i);
    });

    it("should accurately extrapolate linear spend across remaining days when data is sufficient", () => {
      // 31-day budget period: March 1 to April 1 (31 days total)
      const budget = {
        amount: "1000.00",
        currency: "USD",
        startDate: new Date("2026-03-01T00:00:00.000Z"),
        endDate: new Date("2026-04-01T00:00:00.000Z")
      };

      // 10 full days elapsed: March 11. 21 days remaining.
      // Actual spend: $250.00.
      // Daily burn rate: $250 / 10 = $25.00/day.
      // Remaining forecast: 21 * $25 = $525.00.
      // Total forecast spend: $250 + $525 = $775.00.
      const evalDate = new Date("2026-03-11T00:00:00.000Z");
      const forecast = generateSpendForecast({ budget, actualSpend: "250.00", evaluationDate: evalDate });

      assert.equal(forecast.hasSufficientData, true);
      assert.equal(forecast.actualSpend, "250.00");
      assert.equal(forecast.forecastSpend, "775.00");
      assert.equal(forecast.dailyAverageSpend, "25.0000");
      assert.equal(forecast.projectedVariance, "-225.00");
      assert.equal(forecast.isProjectedToExceed, false);
      assert.equal(forecast.method, "linear_run_rate");
      assert.equal(forecast.dataWindow.daysElapsed, 10);
      assert.equal(forecast.dataWindow.daysRemaining, 21);
      assert.ok(forecast.assumptions);
      assert.ok(forecast.limitations);
    });

    it("should set isProjectedToExceed: true when linear projection exceeds budget amount", () => {
      const budget = {
        amount: "1000.00",
        currency: "USD",
        startDate: new Date("2026-03-01T00:00:00.000Z"),
        endDate: new Date("2026-04-01T00:00:00.000Z")
      };

      // 10 days elapsed, actual spend = $500.00.
      // Daily burn rate = $50.00/day.
      // Total forecast = $500 + (21 * $50) = $1550.00.
      const evalDate = new Date("2026-03-11T00:00:00.000Z");
      const forecast = generateSpendForecast({ budget, actualSpend: "500.00", evaluationDate: evalDate });

      assert.equal(forecast.hasSufficientData, true);
      assert.equal(forecast.forecastSpend, "1550.00");
      assert.equal(forecast.projectedVariance, "550.00");
      assert.equal(forecast.isProjectedToExceed, true);
    });

    it("should treat completed budget period as final realized actual spend", () => {
      const budget = {
        amount: "1000.00",
        currency: "USD",
        startDate: new Date("2026-03-01T00:00:00.000Z"),
        endDate: new Date("2026-04-01T00:00:00.000Z")
      };

      // Evaluated after period end
      const evalDate = new Date("2026-04-05T00:00:00.000Z");
      const forecast = generateSpendForecast({ budget, actualSpend: "890.00", evaluationDate: evalDate });

      assert.equal(forecast.hasSufficientData, true);
      assert.equal(forecast.isPeriodCompleted, true);
      assert.equal(forecast.forecastSpend, "890.00");
      assert.equal(forecast.actualSpend, "890.00");
      assert.equal(forecast.dataWindow.daysRemaining, 0);
    });
  });
});
