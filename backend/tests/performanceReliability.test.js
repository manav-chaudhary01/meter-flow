import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import User from "../src/models/User.js";
import Tenant from "../src/models/Tenant.js";
import Membership from "../src/models/Membership.js";
import TrackedService from "../src/models/TrackedService.js";
import UsageRecord from "../src/models/UsageRecord.js";
import BillingRecord from "../src/models/BillingRecord.js";
import Budget from "../src/models/Budget.js";
import BudgetAlert from "../src/models/BudgetAlert.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";

describe("Performance, Concurrency & Reliability Validation Suite", () => {
  before(async () => {
    await connectTestDb();
    await User.syncIndexes();
    await Tenant.syncIndexes();
    await Membership.syncIndexes();
    await TrackedService.syncIndexes();
    await UsageRecord.syncIndexes();
    await BillingRecord.syncIndexes();
    await Budget.syncIndexes();
    await BudgetAlert.syncIndexes();
  });

  after(async () => {
    await disconnectTestDb();
  });

  describe("1. Concurrency: Parallel Idempotent Usage Ingestion", () => {
    let token;
    let serviceId;
    let tenantId;

    beforeEach(async () => {
      await clearTestDb();

      const reg = await request(app).post("/api/auth/register").send({
        name: "Concurrency Tester",
        email: "concurrency@tester.com",
        password: "Password123!",
        organizationName: "Concurrency Org"
      });
      token = reg.body.data.token;
      tenantId = reg.body.data.tenant.id;

      const srv = await TrackedService.create({
        tenantId,
        name: "Concurrent Compute Engine",
        provider: "Internal",
        category: "compute",
        trackingType: "metered",
        currency: "USD",
        unit: "vCPU-hours",
        unitPrice: "0.04",
        status: "active"
      });
      serviceId = srv._id.toString();
    });

    it("should handle 10 simultaneous requests with the identical idempotency key without duplicate records", async () => {
      const idempotencyKey = "concurrent-idemp-key-xyz-100";
      const payload = {
        serviceId,
        quantity: "42.50",
        unit: "vCPU-hours",
        idempotencyKey,
        occurredAt: "2026-11-20T10:00:00.000Z"
      };

      // Dispatch 10 requests simultaneously
      const promises = Array.from({ length: 10 }, () =>
        request(app)
          .post("/api/usage")
          .set("Authorization", `Bearer ${token}`)
          .send(payload)
      );

      const responses = await Promise.all(promises);

      // Verify all 10 succeeded (either 201 Created or 200 Idempotent Replay)
      for (const res of responses) {
        assert.ok(
          res.status === 201 || res.status === 200,
          `Expected 201 or 200, got ${res.status}: ${JSON.stringify(res.body)}`
        );
        assert.equal(res.body.success, true);
      }

      // Exactly one response should be 201 Created (the race winner)
      const createdCount = responses.filter((r) => r.status === 201).length;
      const replayCount = responses.filter((r) => r.status === 200).length;
      assert.equal(createdCount, 1, "Exactly one request should create the record");
      assert.equal(replayCount, 9, "Remaining 9 requests should be idempotent replays");

      // Verify exactly one record exists in database
      const dbRecords = await UsageRecord.find({ tenantId, idempotencyKey });
      assert.equal(dbRecords.length, 1, "Database must contain exactly 1 UsageRecord");
      assert.equal(dbRecords[0].quantity.toString(), "42.5");
    });
  });

  describe("2. Concurrency: Parallel Billing Generation for Identical Period", () => {
    let token;
    let tenantId;
    let serviceId;

    beforeEach(async () => {
      await clearTestDb();

      const reg = await request(app).post("/api/auth/register").send({
        name: "Billing Concurrency Tester",
        email: "billing-race@tester.com",
        password: "Password123!",
        organizationName: "Billing Race Org"
      });
      token = reg.body.data.token;
      tenantId = reg.body.data.tenant.id;

      const srv = await TrackedService.create({
        tenantId,
        name: "Billing Test API",
        provider: "Internal",
        category: "ai",
        trackingType: "metered",
        currency: "USD",
        unit: "requests",
        unitPrice: "0.002",
        status: "active"
      });
      serviceId = srv._id;

      // Seed 15 usage records
      const usageDocs = [];
      for (let i = 0; i < 15; i++) {
        usageDocs.push({
          tenantId,
          serviceId,
          quantity: "1000",
          unit: "requests",
          occurredAt: new Date("2026-10-15T12:00:00Z"),
          source: "seed-billing-concurrency"
        });
      }
      await UsageRecord.insertMany(usageDocs);
    });

    it("should prevent double-billing when 6 generation requests execute concurrently for the same period", async () => {
      const period = {
        billingPeriodStart: "2026-10-01T00:00:00.000Z",
        billingPeriodEnd: "2026-10-31T23:59:59.000Z",
        currency: "USD"
      };

      const promises = Array.from({ length: 6 }, () =>
        request(app)
          .post("/api/billing/generate")
          .set("Authorization", `Bearer ${token}`)
          .send(period)
      );

      const responses = await Promise.all(promises);

      // Verify all 6 requests succeeded
      for (const res of responses) {
        assert.ok(
          res.status === 201 || res.status === 200,
          `Expected 201 or 200, got ${res.status}: ${JSON.stringify(res.body)}`
        );
        assert.equal(res.body.success, true);
      }

      // Exactly 1 request should be 201 Created; 5 should be 200 existing
      const createdCount = responses.filter((r) => r.status === 201).length;
      assert.equal(createdCount, 1, "Exactly one bill must be created");

      // Verify database contains exactly one BillingRecord for this period
      const bills = await BillingRecord.find({
        tenantId,
        billingPeriodStart: new Date(period.billingPeriodStart),
        billingPeriodEnd: new Date(period.billingPeriodEnd)
      });
      assert.equal(bills.length, 1, "Database must contain exactly 1 BillingRecord");

      // Verify all 15 usage records are reconciled to this exact bill
      const reconciledUsage = await UsageRecord.find({
        tenantId,
        billingRecordId: bills[0]._id
      });
      assert.equal(reconciledUsage.length, 15, "All 15 usage records must be reconciled to the single bill");
    });
  });

  describe("3. Concurrency: Multi-Tenant Interleaved Operations with Zero Leakage", () => {
    let tokenA, tenantAId;
    let tokenB, tenantBId;

    beforeEach(async () => {
      await clearTestDb();

      // Tenant A
      const regA = await request(app).post("/api/auth/register").send({
        name: "Alice Tenant A",
        email: "alice@tenanta.com",
        password: "Password123!",
        organizationName: "Tenant A Alpha Corp"
      });
      tokenA = regA.body.data.token;
      tenantAId = regA.body.data.tenant.id;

      // Tenant B
      const regB = await request(app).post("/api/auth/register").send({
        name: "Bob Tenant B",
        email: "bob@tenantb.com",
        password: "Password123!",
        organizationName: "Tenant B Beta LLC"
      });
      tokenB = regB.body.data.token;
      tenantBId = regB.body.data.tenant.id;

      // Create distinct services
      await TrackedService.create({
        tenantId: tenantAId,
        name: "Tenant A Secret Database",
        provider: "A-Cloud",
        category: "database",
        trackingType: "subscription",
        currency: "USD",
        subscriptionAmount: "299.00",
        billingInterval: "monthly"
      });

      await TrackedService.create({
        tenantId: tenantBId,
        name: "Tenant B Private Storage",
        provider: "B-Cloud",
        category: "storage",
        trackingType: "subscription",
        currency: "USD",
        subscriptionAmount: "99.00",
        billingInterval: "monthly"
      });
    });

    it("should maintain 100% tenant isolation across 40 interleaved parallel requests", async () => {
      const calls = [];
      for (let i = 0; i < 40; i++) {
        const isA = i % 2 === 0;
        const token = isA ? tokenA : tokenB;
        const expectedTenantId = isA ? tenantAId : tenantBId;
        const expectedServiceName = isA ? "Tenant A Secret Database" : "Tenant B Private Storage";
        const forbiddenServiceName = isA ? "Tenant B Private Storage" : "Tenant A Secret Database";

        calls.push(
          request(app)
            .get("/api/services")
            .set("Authorization", `Bearer ${token}`)
            .then((res) => {
              assert.equal(res.status, 200);
              assert.equal(res.body.success, true);
              const services = res.body.data.services;
              assert.equal(services.length, 1);
              assert.equal(services[0].tenantId.toString(), expectedTenantId);
              assert.equal(services[0].name, expectedServiceName);
              assert.notEqual(services[0].name, forbiddenServiceName);
            })
        );
      }

      await Promise.all(calls);
    });
  });

  describe("4. Concurrency: Workspace Switching & Session Independence", () => {
    let tokenOriginal;
    let wsId1;
    let wsId2;

    beforeEach(async () => {
      await clearTestDb();

      const reg = await request(app).post("/api/auth/register").send({
        name: "Workspace Switch Tester",
        email: "switch@tester.com",
        password: "Password123!",
        organizationName: "Workspace Primary"
      });
      tokenOriginal = reg.body.data.token;
      wsId1 = reg.body.data.tenant.id;

      const wsCreate = await request(app)
        .post("/api/workspaces")
        .set("Authorization", `Bearer ${tokenOriginal}`)
        .send({ name: "Workspace Secondary", type: "organization" });
      wsId2 = wsCreate.body.data.workspace.id;

      // Create a service in wsId1
      await TrackedService.create({
        tenantId: wsId1,
        name: "Primary Workspace Srv",
        provider: "Internal",
        category: "analytics",
        trackingType: "subscription",
        currency: "USD",
        subscriptionAmount: "10.00",
        billingInterval: "monthly"
      });

      // Create a service in wsId2
      await TrackedService.create({
        tenantId: wsId2,
        name: "Secondary Workspace Srv",
        provider: "Internal",
        category: "analytics",
        trackingType: "subscription",
        currency: "USD",
        subscriptionAmount: "20.00",
        billingInterval: "monthly"
      });
    });

    it("should issue independent valid tokens during parallel workspace switching", async () => {
      // Concurrently switch to wsId1 and wsId2
      const [switch1Res, switch2Res] = await Promise.all([
        request(app)
          .post("/api/workspaces/switch")
          .set("Authorization", `Bearer ${tokenOriginal}`)
          .send({ workspaceId: wsId1 }),
        request(app)
          .post("/api/workspaces/switch")
          .set("Authorization", `Bearer ${tokenOriginal}`)
          .send({ workspaceId: wsId2 })
      ]);

      assert.equal(switch1Res.status, 200);
      assert.equal(switch2Res.status, 200);

      const token1 = switch1Res.body.data.token;
      const token2 = switch2Res.body.data.token;

      // Verify token1 sees only wsId1
      const me1 = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token1}`);
      assert.equal(me1.status, 200);
      assert.equal(me1.body.data.tenantId, wsId1);

      const srv1 = await request(app).get("/api/services").set("Authorization", `Bearer ${token1}`);
      assert.equal(srv1.body.data.services.length, 1);
      assert.equal(srv1.body.data.services[0].name, "Primary Workspace Srv");

      // Verify token2 sees only wsId2
      const me2 = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token2}`);
      assert.equal(me2.status, 200);
      assert.equal(me2.body.data.tenantId, wsId2);

      const srv2 = await request(app).get("/api/services").set("Authorization", `Bearer ${token2}`);
      assert.equal(srv2.body.data.services.length, 1);
      assert.equal(srv2.body.data.services[0].name, "Secondary Workspace Srv");
    });
  });

  describe("5. Latency & SLA Verification: Read Endpoints Sub-100ms p95", () => {
    let token;
    let tenantId;

    before(async () => {
      await clearTestDb();

      const reg = await request(app).post("/api/auth/register").send({
        name: "SLA Tester",
        email: "sla@tester.com",
        password: "Password123!",
        organizationName: "SLA Corp"
      });
      token = reg.body.data.token;
      tenantId = reg.body.data.tenant.id;

      const srv = await TrackedService.create({
        tenantId,
        name: "SLA Service",
        provider: "Internal",
        category: "ai",
        trackingType: "metered",
        currency: "USD",
        unit: "tokens",
        unitPrice: "0.001",
        status: "active"
      });

      // Seed 20 usage records
      const records = [];
      for (let i = 0; i < 20; i++) {
        records.push({
          tenantId,
          serviceId: srv._id,
          quantity: "500",
          unit: "tokens",
          occurredAt: new Date(Date.now() - i * 3600000),
          source: "sla-seed"
        });
      }
      await UsageRecord.insertMany(records);

      await Budget.create({
        tenantId,
        name: "SLA Budget",
        amount: "1000.00",
        currency: "USD",
        periodType: "monthly",
        startDate: new Date("2026-11-01T00:00:00Z"),
        endDate: new Date("2026-11-30T23:59:59Z"),
        thresholds: [50, 80, 100],
        status: "active",
        createdBy: reg.body.data.user.id
      });
    });

    async function measureEndpoint(path, iterations = 20) {
      // Warmup
      await request(app).get(path).set("Authorization", `Bearer ${token}`);

      const times = [];
      for (let i = 0; i < iterations; i++) {
        const t0 = performance.now();
        const res = await request(app).get(path).set("Authorization", `Bearer ${token}`);
        const t1 = performance.now();
        assert.equal(res.status, 200);
        times.push(t1 - t0);
      }
      times.sort((a, b) => a - b);
      const p95 = times[Math.ceil(0.95 * times.length) - 1];
      const mean = times.reduce((a, b) => a + b, 0) / times.length;
      return { mean, p95, max: Math.max(...times) };
    }

    it("GET /api/auth/me should have p95 latency under 50ms", async () => {
      const stats = await measureEndpoint("/api/auth/me", 20);
      assert.ok(stats.p95 < 50, `p95 was ${stats.p95.toFixed(2)}ms, expected < 50ms`);
    });

    it("GET /api/workspaces should have p95 latency under 50ms", async () => {
      const stats = await measureEndpoint("/api/workspaces", 20);
      assert.ok(stats.p95 < 50, `p95 was ${stats.p95.toFixed(2)}ms, expected < 50ms`);
    });

    it("GET /api/services should have p95 latency under 50ms", async () => {
      const stats = await measureEndpoint("/api/services", 20);
      assert.ok(stats.p95 < 50, `p95 was ${stats.p95.toFixed(2)}ms, expected < 50ms`);
    });

    it("GET /api/usage/summary should have p95 latency under 100ms", async () => {
      const stats = await measureEndpoint("/api/usage/summary", 20);
      assert.ok(stats.p95 < 100, `p95 was ${stats.p95.toFixed(2)}ms, expected < 100ms`);
    });

    it("GET /api/budgets should have p95 latency under 100ms", async () => {
      const stats = await measureEndpoint("/api/budgets", 20);
      assert.ok(stats.p95 < 100, `p95 was ${stats.p95.toFixed(2)}ms, expected < 100ms`);
    });
  });
});
