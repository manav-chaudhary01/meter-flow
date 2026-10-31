import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import express from "express";
import mongoose from "mongoose";
import app, { errorHandler } from "../src/app.js";
import User from "../src/models/User.js";
import Tenant from "../src/models/Tenant.js";
import Membership from "../src/models/Membership.js";
import TrackedService from "../src/models/TrackedService.js";
import UsageRecord from "../src/models/UsageRecord.js";
import BillingRecord from "../src/models/BillingRecord.js";
import Budget from "../src/models/Budget.js";
import BudgetAlert from "../src/models/BudgetAlert.js";
import { calculateBill } from "../src/services/billingCalculator.js";
import { generateSpendForecast } from "../src/services/spendForecaster.js";
import { validateEnv } from "../src/config/env.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";

describe("Milestone F: Reliability, Reconciliation & Production Readiness", () => {
  let ownerToken;
  let ownerUserId;
  let ownerTenantId;

  before(async () => {
    await connectTestDb();
    await Membership.syncIndexes();
    await BillingRecord.syncIndexes();
    await Budget.syncIndexes();
    await BudgetAlert.syncIndexes();
    await UsageRecord.syncIndexes();
  });

  after(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();

    // Register primary owner
    const regRes = await request(app).post("/api/auth/register").send({
      name: "Owner One",
      email: "owner@primary.com",
      password: "password123",
      organizationName: "Primary Enterprise"
    });

    ownerToken = regRes.body.data.token;
    ownerUserId = regRes.body.data.user.id;
    ownerTenantId = regRes.body.data.tenant.id;
  });

  describe("Phase 4: Authentication, Authorization & Anti-Privilege Escalation", () => {
    it("should reject access with 403 when workspace membership is suspended", async () => {
      // Suspend the membership
      await Membership.findOneAndUpdate(
        { userId: ownerUserId, tenantId: ownerTenantId },
        { status: "suspended" }
      );

      const res = await request(app)
        .get("/api/workspaces")
        .set("Authorization", `Bearer ${ownerToken}`);

      assert.equal(res.status, 403);
      assert.equal(res.body.success, false);
      assert.match(
        res.body.message,
        /Access denied: your workspace membership is suspended or inactive/
      );
    });

    it("should reject removed member with stale token and prevent legacy auto-heal from escalating to owner", async () => {
      // 1. Create a second user (Dev Member)
      const regMember = await request(app).post("/api/auth/register").send({
        name: "Dev Member",
        email: "dev@external.com",
        password: "password123",
        organizationName: "Dev Freelance"
      });
      const memberUserId = regMember.body.data.user.id;

      // 2. Owner adds Dev Member to Primary Enterprise
      const addRes = await request(app)
        .post(`/api/workspaces/${ownerTenantId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: "dev@external.com", role: "member" });
      assert.equal(addRes.status, 201);

      // 3. Dev Member logs in and switches to Primary Enterprise
      const loginRes = await request(app).post("/api/auth/login").send({
        email: "dev@external.com",
        password: "password123"
      });
      const devTempToken = loginRes.body.data.token;

      const switchRes = await request(app)
        .post("/api/workspaces/switch")
        .set("Authorization", `Bearer ${devTempToken}`)
        .send({ workspaceId: ownerTenantId });
      assert.equal(switchRes.status, 200);

      // Dev Member's token scoped to Primary Enterprise
      const devOrgToken = switchRes.body.data.token;

      // Verify Dev Member can access services in Primary Enterprise
      const checkRes = await request(app)
        .get("/api/services")
        .set("Authorization", `Bearer ${devOrgToken}`);
      assert.equal(checkRes.status, 200);

      // 4. Owner removes Dev Member from Primary Enterprise
      const removeRes = await request(app)
        .delete(`/api/workspaces/${ownerTenantId}/members/${memberUserId}`)
        .set("Authorization", `Bearer ${ownerToken}`);
      assert.equal(removeRes.status, 200);

      // 5. Dev Member attempts to access Primary Enterprise with their old token
      const staleRes = await request(app)
        .get("/api/services")
        .set("Authorization", `Bearer ${devOrgToken}`);

      // Must be 403 Forbidden!
      assert.equal(staleRes.status, 403);
      assert.equal(staleRes.body.success, false);
      assert.match(
        staleRes.body.message,
        /Access denied: you are not an active member of this workspace/
      );

      // 6. Verify that NO auto-healed owner membership was created for Dev Member!
      const unauthorizedMembership = await Membership.findOne({
        userId: memberUserId,
        tenantId: ownerTenantId
      });
      assert.equal(unauthorizedMembership, null, "Removed member must NEVER be granted owner role!");

      // 7. Verify removed user's tenant pointer was cleanly reset
      const updatedUser = await User.findById(memberUserId);
      assert.notEqual(
        updatedUser.tenantId?.toString(),
        ownerTenantId.toString(),
        "User.tenantId must not point to the removed workspace"
      );
    });
  });

  describe("Phase 2: Billing Self-Healing Reconciliation & Period Handling", () => {
    it("should self-heal unbilled usage records when billing generation is retried for an existing bill", async () => {
      // 1. Create a metered service
      const svcRes = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          name: "Compute Hours",
          trackingType: "metered",
          unit: "hour",
          unitPrice: 2.5,
          currency: "USD"
        });
      assert.equal(svcRes.status, 201);
      const serviceId = svcRes.body.data.service.id;

      // 2. Ingest usage records for January 2025
      const periodStart = "2025-01-01T00:00:00.000Z";
      const periodEnd = "2025-02-01T00:00:00.000Z";

      const usage1 = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          serviceId,
          quantity: 10,
          unit: "hour",
          occurredAt: "2025-01-10T12:00:00.000Z"
        });
      assert.equal(usage1.status, 201);

      const usage2 = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          serviceId,
          quantity: 20,
          unit: "hour",
          occurredAt: "2025-01-20T12:00:00.000Z"
        });
      assert.equal(usage2.status, 201);

      // 3. Simulate an interrupted billing run:
      // Manually insert BillingRecord directly into DB, leaving usage records unbilled (billingRecordId: null)
      const interruptedBill = await BillingRecord.create({
        tenantId: ownerTenantId,
        invoiceNumber: "INV-20250101-SIMFAIL",
        billingPeriodStart: new Date(periodStart),
        billingPeriodEnd: new Date(periodEnd),
        currency: "USD",
        lineItems: [
          {
            serviceId,
            serviceName: "Compute Hours",
            chargeType: "usage",
            quantity: "30",
            unit: "hour",
            unitPrice: "2.5",
            amount: "75.00",
            usageRecordCount: 2,
            description: "Usage charge for 30 hour at USD 2.5/hour"
          }
        ],
        subtotal: "75.00",
        total: "75.00",
        status: "issued",
        generatedAt: new Date(),
        generatedBy: ownerUserId
      });

      // Verify usage records are currently unlinked
      let unlinkedCount = await UsageRecord.countDocuments({
        tenantId: ownerTenantId,
        billingRecordId: null
      });
      assert.equal(unlinkedCount, 2);

      // 4. Retry billing generation for this period: POST /api/billing/generate
      const retryRes = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          billingPeriodStart: periodStart,
          billingPeriodEnd: periodEnd,
          currency: "USD"
        });

      assert.equal(retryRes.status, 200);
      assert.equal(retryRes.body.data.isExisting, true);

      // 5. Verify that self-healing linked all unbilled usage records to the bill!
      unlinkedCount = await UsageRecord.countDocuments({
        tenantId: ownerTenantId,
        billingRecordId: null
      });
      assert.equal(unlinkedCount, 0, "All unbilled usage records should now be reconciled!");

      const linkedCount = await UsageRecord.countDocuments({
        tenantId: ownerTenantId,
        billingRecordId: interruptedBill._id
      });
      assert.equal(linkedCount, 2);
    });

    it("should self-heal usage records on GET /api/billing/:id/usage if previously unlinked", async () => {
      // 1. Create metered service & usage
      const svcRes = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          name: "Storage GB",
          trackingType: "metered",
          unit: "gb",
          unitPrice: 0.1,
          currency: "USD"
        });
      const serviceId = svcRes.body.data.service.id;

      await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          serviceId,
          quantity: 100,
          unit: "gb",
          occurredAt: "2025-03-15T00:00:00.000Z"
        });

      // 2. Create bill directly with unlinked usage record
      const bill = await BillingRecord.create({
        tenantId: ownerTenantId,
        invoiceNumber: "INV-20250301-HEAL",
        billingPeriodStart: new Date("2025-03-01T00:00:00.000Z"),
        billingPeriodEnd: new Date("2025-04-01T00:00:00.000Z"),
        currency: "USD",
        lineItems: [
          {
            serviceId,
            serviceName: "Storage GB",
            chargeType: "usage",
            quantity: "100",
            unit: "gb",
            unitPrice: "0.1",
            amount: "10.00",
            usageRecordCount: 1,
            description: "Usage charge"
          }
        ],
        subtotal: "10.00",
        total: "10.00",
        status: "issued",
        generatedAt: new Date(),
        generatedBy: ownerUserId
      });

      // 3. Request usage for this bill: GET /api/billing/:id/usage
      const usageRes = await request(app)
        .get(`/api/billing/${bill._id}/usage`)
        .set("Authorization", `Bearer ${ownerToken}`);

      assert.equal(usageRes.status, 200);
      assert.equal(usageRes.body.data.count, 1);
      assert.equal(usageRes.body.data.usageRecords.length, 1);
      assert.equal(usageRes.body.data.usageRecords[0].quantity, "100");
    });

    it("should calculate exact days in leap years (29 days) vs non-leap years (28 days)", () => {
      const mockService = {
        _id: new mongoose.Types.ObjectId(),
        name: "Dedicated Server",
        trackingType: "subscription",
        currency: "USD",
        subscriptionAmount: "10.00",
        billingInterval: "daily",
        status: "active"
      };

      // Leap Year February 2024: 29 days (2024-02-01 to 2024-03-01)
      const leapStart = new Date("2024-02-01T00:00:00.000Z");
      const leapEnd = new Date("2024-03-01T00:00:00.000Z");

      const leapBill = calculateBill({
        services: [mockService],
        usageRecords: [],
        billingPeriodStart: leapStart,
        billingPeriodEnd: leapEnd,
        currency: "USD"
      });

      // 10.00 * 29 = 290.00
      assert.equal(leapBill.total, "290.00");
      assert.equal(leapBill.lineItems[0].amount, "290.00");

      // Non-Leap Year February 2023: 28 days (2023-02-01 to 2023-03-01)
      const nonLeapStart = new Date("2023-02-01T00:00:00.000Z");
      const nonLeapEnd = new Date("2023-03-01T00:00:00.000Z");

      const nonLeapBill = calculateBill({
        services: [mockService],
        usageRecords: [],
        billingPeriodStart: nonLeapStart,
        billingPeriodEnd: nonLeapEnd,
        currency: "USD"
      });

      // 10.00 * 28 = 280.00
      assert.equal(nonLeapBill.total, "280.00");
      assert.equal(nonLeapBill.lineItems[0].amount, "280.00");
    });
  });

  describe("Phase 3: Budget Multi-Threshold Crossings & Over-100% Alerts", () => {
    it("should trigger all crossed thresholds including > 100% when spend jumps rapidly", async () => {
      // 1. Create a service and budget with custom thresholds including > 100%
      const svcRes = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          name: "API Service",
          trackingType: "metered",
          unit: "call",
          unitPrice: 1.0,
          currency: "USD"
        });
      const serviceId = svcRes.body.data.service.id;

      const budgetRes = await request(app)
        .post("/api/budgets")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          name: "Q1 API Budget",
          amount: 100.0,
          currency: "USD",
          startDate: "2025-01-01T00:00:00.000Z",
          endDate: "2025-04-01T00:00:00.000Z",
          thresholds: [50, 80, 100, 120]
        });
      assert.equal(budgetRes.status, 201);
      const budgetId = budgetRes.body.data.budget.id;

      // 2. Ingest usage of 130 calls ($130 = 130% of budget) in a single jump
      await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          serviceId,
          quantity: 130,
          unit: "call",
          occurredAt: "2025-01-15T10:00:00.000Z"
        });

      // Realize actual spend via bill generation for January 2025
      const billRes = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          billingPeriodStart: "2025-01-01T00:00:00.000Z",
          billingPeriodEnd: "2025-02-01T00:00:00.000Z",
          currency: "USD"
        });
      assert.equal(billRes.status, 201);
      assert.equal(billRes.body.data.billingRecord.total, "130.00");

      // 3. Fetch budget to trigger evaluation
      const getRes = await request(app)
        .get(`/api/budgets/${budgetId}`)
        .set("Authorization", `Bearer ${ownerToken}`);
      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.data.budget.actualSpend, "130.00");
      assert.equal(getRes.body.data.budget.percentageUsed, 130);

      // 4. Fetch alerts
      const alertsRes = await request(app)
        .get(`/api/budgets/alerts?budgetId=${budgetId}`)
        .set("Authorization", `Bearer ${ownerToken}`);

      assert.equal(alertsRes.status, 200);
      const alerts = alertsRes.body.data.alerts;

      // Must have triggered all 4 thresholds: 50, 80, 100, 120
      assert.equal(alerts.length, 4);

      const alert50 = alerts.find((a) => a.threshold === 50);
      const alert80 = alerts.find((a) => a.threshold === 80);
      const alert100 = alerts.find((a) => a.threshold === 100);
      const alert120 = alerts.find((a) => a.threshold === 120);

      assert.ok(alert50 && alert80 && alert100 && alert120);
      assert.equal(alert50.alertType, "threshold_reached");
      assert.equal(alert80.alertType, "threshold_reached");
      assert.equal(alert100.alertType, "threshold_exceeded");
      assert.equal(alert120.alertType, "threshold_exceeded");

      // Verify repeated check does not create duplicate alerts
      await request(app)
        .get(`/api/budgets/${budgetId}`)
        .set("Authorization", `Bearer ${ownerToken}`);

      const alertsRes2 = await request(app)
        .get(`/api/budgets/alerts?budgetId=${budgetId}`)
        .set("Authorization", `Bearer ${ownerToken}`);
      assert.equal(alertsRes2.body.data.alerts.length, 4, "No duplicate alerts should be generated");
    });

    it("should explain forecast limitations when historical data is insufficient", () => {
      const mockBudget = {
        startDate: "2025-05-01T00:00:00.000Z",
        endDate: "2025-06-01T00:00:00.000Z",
        amount: "500.00",
        currency: "USD"
      };

      // Case 1: Evaluation date before start date
      const preStartForecast = generateSpendForecast({
        budget: mockBudget,
        actualSpend: "0.00",
        evaluationDate: new Date("2025-04-20T00:00:00.000Z")
      });
      assert.equal(preStartForecast.hasSufficientData, false);
      assert.match(preStartForecast.reason, /Budget period has not started yet/);

      // Case 2: Only 6 hours elapsed in the active period
      const microElapsedForecast = generateSpendForecast({
        budget: mockBudget,
        actualSpend: "20.00",
        evaluationDate: new Date("2025-05-01T06:00:00.000Z")
      });
      assert.equal(microElapsedForecast.hasSufficientData, false);
      assert.match(microElapsedForecast.reason, /at least 1 full day/);

      // Case 3: Period ended
      const closedForecast = generateSpendForecast({
        budget: mockBudget,
        actualSpend: "450.00",
        evaluationDate: new Date("2025-06-05T00:00:00.000Z")
      });
      assert.equal(closedForecast.hasSufficientData, true);
      assert.equal(closedForecast.isPeriodCompleted, true);
      assert.equal(closedForecast.forecastSpend, "450.00");
    });
  });

  describe("Phase 6: Operational Readiness & Health Endpoint", () => {
    it("GET /api/health should return operational telemetry including database connectivity and uptime", async () => {
      const res = await request(app).get("/api/health");

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.message, "MeterFlow API is running");
      assert.equal(res.body.status, "healthy");
      assert.equal(res.body.database, "connected");
      assert.equal(typeof res.body.uptime, "number");
      assert.ok(res.body.timestamp);
    });

    it("should sanitize 500 error messages in production mode", async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        const testApp = express();
        testApp.get("/api/test-internal-error", (req, res, next) => {
          next(new Error("Sensitive database credential leaked here"));
        });
        testApp.use(errorHandler);

        // Production environment
        process.env.NODE_ENV = "production";
        const resProd = await request(testApp).get("/api/test-internal-error");
        assert.equal(resProd.status, 500);
        assert.equal(resProd.body.success, false);
        // Sensitive error message must be sanitized to "Internal server error"
        assert.equal(resProd.body.message, "Internal server error");

        // Non-production environment preserves debug message
        process.env.NODE_ENV = "development";
        const resDev = await request(testApp).get("/api/test-internal-error");
        assert.equal(resDev.status, 500);
        assert.equal(resDev.body.success, false);
        assert.equal(resDev.body.message, "Sensitive database credential leaked here");
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it("validateEnv should reject weak JWT secret in production", () => {
      const originalEnv = process.env.NODE_ENV;
      const originalSecret = process.env.JWT_SECRET;
      try {
        process.env.NODE_ENV = "production";
        process.env.JWT_SECRET = "short";

        assert.throws(
          () => validateEnv(),
          /JWT_SECRET must be at least 16 characters in production/
        );
      } finally {
        process.env.NODE_ENV = originalEnv;
        process.env.JWT_SECRET = originalSecret;
      }
    });
  });
});
