import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import app from "../src/app.js";
import Membership from "../src/models/Membership.js";
import User from "../src/models/User.js";
import Tenant from "../src/models/Tenant.js";
import TrackedService from "../src/models/TrackedService.js";
import UsageRecord from "../src/models/UsageRecord.js";
import BillingRecord from "../src/models/BillingRecord.js";
import Budget from "../src/models/Budget.js";
import BudgetAlert from "../src/models/BudgetAlert.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";

describe("API Contract, Error Handling & Status Codes Audit", () => {
  before(async () => {
    await connectTestDb();
    await TrackedService.syncIndexes();
    await UsageRecord.syncIndexes();
    await BillingRecord.syncIndexes();
    await Budget.syncIndexes();
    await BudgetAlert.syncIndexes();
  });

  after(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  // Helper to quickly register an owner and get token + workspace
  async function registerUser(email = "alice@example.com", name = "Alice Owner", org = "Alice Org") {
    const res = await request(app).post("/api/auth/register").send({
      name,
      email,
      password: "Password123!",
      organizationName: org
    });
    assert.equal(res.status, 201);
    return {
      token: res.body.data.token,
      user: res.body.data.user,
      tenant: res.body.data.tenant
    };
  }

  // Helper to login
  async function loginUser(email, password = "Password123!") {
    return request(app).post("/api/auth/login").send({ email, password });
  }

  // ==========================================
  // 1. AUTHENTICATION CONTRACTS
  // ==========================================
  describe("Authentication API Contracts", () => {
    it("POST /api/auth/register: 201 on success with structured payload", async () => {
      const res = await request(app).post("/api/auth/register").send({
        name: "Test User",
        email: "test@meterflow.internal",
        password: "ValidPassword123!",
        organizationName: "Test Org"
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(typeof res.body.message, "string");
      assert.ok(res.body.data.token);
      assert.equal(res.body.data.user.email, "test@meterflow.internal");
      assert.equal(res.body.data.user.role, "owner");
      assert.equal(res.body.data.tenant.name, "Test Org");
      assert.ok(res.body.data.user.tenantId);
    });

    it("POST /api/auth/register: 400 Bad Request on invalid inputs", async () => {
      // Name too short
      const res1 = await request(app).post("/api/auth/register").send({
        name: "A",
        email: "short@example.com",
        password: "ValidPassword123!",
        organizationName: "Org"
      });
      assert.equal(res1.status, 400);
      assert.equal(res1.body.success, false);
      assert.ok(res1.body.message);

      // Invalid email
      const res2 = await request(app).post("/api/auth/register").send({
        name: "Valid Name",
        email: "not-an-email",
        password: "ValidPassword123!",
        organizationName: "Org"
      });
      assert.equal(res2.status, 400);

      // Short password
      const res3 = await request(app).post("/api/auth/register").send({
        name: "Valid Name",
        email: "pass@example.com",
        password: "short",
        organizationName: "Org"
      });
      assert.equal(res3.status, 400);
    });

    it("POST /api/auth/register: 409 Conflict when email already registered", async () => {
      await registerUser("duplicate@example.com", "First User", "First Org");
      const res = await request(app).post("/api/auth/register").send({
        name: "Second User",
        email: "duplicate@example.com",
        password: "Password123!",
        organizationName: "Second Org"
      });
      assert.equal(res.status, 409);
      assert.equal(res.body.success, false);
      assert.match(res.body.message.toLowerCase(), /already exists|registered|in use/);
    });

    it("POST /api/auth/login: 200 OK on valid credentials", async () => {
      await registerUser("login@example.com", "Login User", "Login Org");
      const res = await loginUser("login@example.com");
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.data.token);
      assert.equal(res.body.data.user.email, "login@example.com");
      assert.equal(res.body.data.tenant.name, "Login Org");
    });

    it("POST /api/auth/login: 400 on missing credentials", async () => {
      const res = await request(app).post("/api/auth/login").send({});
      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
    });

    it("POST /api/auth/login: 401 on incorrect password", async () => {
      await registerUser("wrongpass@example.com");
      const res = await loginUser("wrongpass@example.com", "WrongPassword999!");
      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
      assert.match(res.body.message.toLowerCase(), /invalid (email or password|credentials)/);
    });

    it("GET /api/auth/me: 200 OK when authenticated", async () => {
      const { token, user, tenant } = await registerUser("me@example.com");
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.userId, user.id);
      assert.equal(res.body.data.tenantId, tenant.id);
      assert.equal(res.body.data.role, "owner");
    });

    it("GET /api/auth/me: 401 Unauthorized when token missing or corrupted", async () => {
      const res1 = await request(app).get("/api/auth/me");
      assert.equal(res1.status, 401);

      const res2 = await request(app).get("/api/auth/me").set("Authorization", "Bearer invalid.jwt.token");
      assert.equal(res2.status, 401);
    });

    it("GET /api/auth/me: 403 Forbidden when user membership is suspended", async () => {
      const { token, user, tenant } = await registerUser("suspend@example.com");
      // Mark membership suspended
      await Membership.updateOne(
        { userId: user.id, tenantId: tenant.id },
        { status: "suspended" }
      );

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);
      assert.equal(res.status, 403);
      assert.match(res.body.message.toLowerCase(), /suspended or inactive/);
    });
  });

  // ==========================================
  // 2. WORKSPACE CONTRACTS
  // ==========================================
  describe("Workspace API Contracts", () => {
    it("GET /api/workspaces: 200 OK with list of memberships", async () => {
      const { token, tenant } = await registerUser("ws@example.com");
      const res = await request(app)
        .get("/api/workspaces")
        .set("Authorization", `Bearer ${token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(Array.isArray(res.body.data.workspaces));
      assert.equal(res.body.data.workspaces.length, 1);
      assert.equal(res.body.data.workspaces[0].id.toString(), tenant.id.toString());
      assert.equal(res.body.data.workspaces[0].isCurrent, true);
    });

    it("POST /api/workspaces: 201 Created with new workspace metadata", async () => {
      const { token } = await registerUser("wscreate@example.com");
      const res = await request(app)
        .post("/api/workspaces")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Secondary Workspace", type: "organization" });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.workspace.name, "Secondary Workspace");
      assert.equal(res.body.data.workspace.type, "organization");
    });

    it("POST /api/workspaces/switch: 200 OK with new JWT containing switched tenantId", async () => {
      const { token } = await registerUser("wsswitch@example.com");
      const created = await request(app)
        .post("/api/workspaces")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Work Workspace", type: "organization" });
      const newWsId = created.body.data.workspace.id;

      const switchRes = await request(app)
        .post("/api/workspaces/switch")
        .set("Authorization", `Bearer ${token}`)
        .send({ workspaceId: newWsId });

      assert.equal(switchRes.status, 200);
      assert.equal(switchRes.body.success, true);
      assert.ok(switchRes.body.data.token);
      assert.equal(switchRes.body.data.workspace.id, newWsId);
    });

    it("GET & POST /api/workspaces/:id/members: 200 OK roster and 403 when non-admin adds", async () => {
      const owner = await registerUser("owner_roster@example.com");
      const memberUser = await registerUser("member_roster@example.com");
      const ownerWsId = owner.tenant.id;

      // Owner adds member: 201 Created
      const addRes = await request(app)
        .post(`/api/workspaces/${ownerWsId}/members`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ email: "member_roster@example.com", role: "member" });
      assert.equal(addRes.status, 201);
      assert.equal(addRes.body.success, true);

      // GET members
      const listRes = await request(app)
        .get(`/api/workspaces/${ownerWsId}/members`)
        .set("Authorization", `Bearer ${owner.token}`);
      assert.equal(listRes.status, 200);
      assert.ok(Array.isArray(listRes.body.data.members));
      assert.equal(listRes.body.data.members.length, 2);

      // Member switches to owner's workspace
      const switchRes = await request(app)
        .post("/api/workspaces/switch")
        .set("Authorization", `Bearer ${memberUser.token}`)
        .send({ workspaceId: ownerWsId });
      const memberTokenInOwnerWs = switchRes.body.data.token;

      // Member attempts to add another member: 403 Forbidden
      const forbidRes = await request(app)
        .post(`/api/workspaces/${ownerWsId}/members`)
        .set("Authorization", `Bearer ${memberTokenInOwnerWs}`)
        .send({ email: "third@example.com", role: "member" });
      assert.equal(forbidRes.status, 403);
      assert.equal(forbidRes.body.success, false);
    });
  });

  // ==========================================
  // 3. TRACKED SERVICES CONTRACTS
  // ==========================================
  describe("Tracked Services API Contracts", () => {
    it("POST /api/services: 201 Created for metered, subscription, and hybrid services", async () => {
      const { token } = await registerUser("services@example.com");

      // 1. Metered
      const meteredRes = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "API Calls Meter",
          trackingType: "metered",
          pricingModel: "per_unit",
          unitPrice: 0.05,
          unit: "calls"
        });
      assert.equal(meteredRes.status, 201);
      assert.equal(meteredRes.body.data.service.name, "API Calls Meter");
      assert.equal(meteredRes.body.data.service.trackingType, "metered");

      // 2. Subscription
      const subRes = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Enterprise Platform",
          trackingType: "subscription",
          pricingModel: "flat_fee",
          billingInterval: "monthly",
          subscriptionAmount: 299.00
        });
      assert.equal(subRes.status, 201);
      assert.equal(subRes.body.data.service.trackingType, "subscription");

      // 3. Hybrid
      const hybridRes = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Hybrid Compute",
          trackingType: "hybrid",
          pricingModel: "per_unit",
          unitPrice: 0.10,
          unit: "hours",
          subscriptionAmount: 49.00,
          billingInterval: "monthly"
        });
      assert.equal(hybridRes.status, 201);
      assert.equal(hybridRes.body.data.service.trackingType, "hybrid");
    });

    it("POST /api/services: 400 Bad Request on invalid service payload", async () => {
      const { token } = await registerUser("srv_bad@example.com");

      // Missing trackingType
      const res1 = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Faulty Meter"
        });
      assert.equal(res1.status, 400);
      assert.equal(res1.body.success, false);

      // Negative unitPrice
      const res2 = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Negative Price Meter",
          trackingType: "metered",
          pricingModel: "per_unit",
          unitPrice: -5.00,
          unit: "requests"
        });
      assert.equal(res2.status, 400);
    });

    it("PUT /api/services/:id: 200 OK on update, 404 on nonexistent id", async () => {
      const { token } = await registerUser("srv_update@example.com");
      const created = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Original Name",
          trackingType: "metered",
          pricingModel: "per_unit",
          unitPrice: 1.00,
          unit: "units"
        });
      const srvId = created.body.data.service.id;

      // 200 on update
      const updateRes = await request(app)
        .put(`/api/services/${srvId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Updated Name", unitPrice: 1.25 });
      assert.equal(updateRes.status, 200);
      assert.equal(updateRes.body.data.service.name, "Updated Name");

      // 404 on nonexistent
      const fakeId = "507f1f77bcf86cd799439011";
      const notFoundRes = await request(app)
        .put(`/api/services/${fakeId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Will Fail" });
      assert.equal(notFoundRes.status, 404);
    });

    it("DELETE /api/services/:id: 200 OK on archive", async () => {
      const { token } = await registerUser("srv_del@example.com");
      const created = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "To Archive",
          trackingType: "subscription",
          pricingModel: "flat_fee",
          subscriptionAmount: 20.00,
          billingInterval: "monthly"
        });
      const srvId = created.body.data.service.id;

      const delRes = await request(app)
        .delete(`/api/services/${srvId}`)
        .set("Authorization", `Bearer ${token}`);
      assert.equal(delRes.status, 200);
      assert.equal(delRes.body.success, true);
    });
  });

  // ==========================================
  // 4. USAGE CONTRACTS
  // ==========================================
  describe("Usage API Contracts", () => {
    it("POST /api/usage: 201 on new ingestion, 200 on replay, 409 on conflict", async () => {
      const { token } = await registerUser("usage_contracts@example.com");
      const srv = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Tokens Service",
          trackingType: "metered",
          pricingModel: "per_unit",
          unitPrice: 0.002,
          unit: "tokens"
        });
      const srvId = srv.body.data.service.id;

      const basePayload = {
        serviceId: srvId,
        quantity: "1500",
        unit: "tokens",
        idempotencyKey: "test-idemp-key-100",
        occurredAt: new Date().toISOString()
      };

      // 1. First ingestion -> 201 Created
      const res1 = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${token}`)
        .send(basePayload);
      assert.equal(res1.status, 201);
      assert.equal(res1.body.success, true);
      assert.equal(res1.body.data.idempotentReplay, false);
      assert.equal(res1.body.data.record.quantity, "1500");

      // 2. Exact replay -> 200 OK with idempotentReplay: true
      const res2 = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${token}`)
        .send(basePayload);
      assert.equal(res2.status, 200);
      assert.equal(res2.body.data.idempotentReplay, true);

      // 3. Conflict (same key, modified quantity) -> 409 Conflict
      const res3 = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${token}`)
        .send({
          ...basePayload,
          quantity: "99999"
        });
      assert.equal(res3.status, 409);
      assert.equal(res3.body.success, false);
      assert.match(res3.body.message.toLowerCase(), /conflict|idempotency/);
    });

    it("POST /api/usage: 400 Bad Request on invalid quantity or unit mismatch", async () => {
      const { token } = await registerUser("usage_invalid@example.com");
      const srv = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "MB Storage",
          trackingType: "metered",
          pricingModel: "per_unit",
          unitPrice: 0.10,
          unit: "MB"
        });
      const srvId = srv.body.data.service.id;

      // Negative quantity
      const res1 = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${token}`)
        .send({
          serviceId: srvId,
          quantity: "-10",
          unit: "MB"
        });
      assert.equal(res1.status, 400);

      // Unit mismatch
      const res2 = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${token}`)
        .send({
          serviceId: srvId,
          quantity: "10",
          unit: "GB" // mismatched
        });
      assert.equal(res2.status, 400);
      assert.match(res2.body.message.toLowerCase(), /unit/);
    });

    it("GET /api/usage & GET /api/usage/summary: 200 OK", async () => {
      const { token } = await registerUser("usage_list@example.com");
      const listRes = await request(app)
        .get("/api/usage")
        .set("Authorization", `Bearer ${token}`);
      assert.equal(listRes.status, 200);
      assert.ok(Array.isArray(listRes.body.data.records));

      const sumRes = await request(app)
        .get("/api/usage/summary")
        .set("Authorization", `Bearer ${token}`);
      assert.equal(sumRes.status, 200);
      assert.equal(sumRes.body.success, true);
    });
  });

  // ==========================================
  // 5. BILLING CONTRACTS
  // ==========================================
  describe("Billing API Contracts", () => {
    it("POST /api/billing/generate: 201 on new, 200 on existing period replay", async () => {
      const { token } = await registerUser("billing_contract@example.com");
      const start = new Date("2026-01-01T00:00:00Z").toISOString();
      const end = new Date("2026-01-31T23:59:59Z").toISOString();

      // 1. Generate first invoice -> 201 Created
      const res1 = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${token}`)
        .send({
          billingPeriodStart: start,
          billingPeriodEnd: end,
          currency: "USD"
        });
      assert.equal(res1.status, 201);
      assert.equal(res1.body.success, true);
      assert.equal(res1.body.data.isExisting, false);
      assert.ok(res1.body.data.billingRecord.id);

      // 2. Replay same period -> 200 OK with isExisting: true
      const res2 = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${token}`)
        .send({
          billingPeriodStart: start,
          billingPeriodEnd: end,
          currency: "USD"
        });
      assert.equal(res2.status, 200);
      assert.equal(res2.body.data.isExisting, true);
    });

    it("POST /api/billing/generate: 400 Bad Request on invalid date range (start >= end)", async () => {
      const { token } = await registerUser("billing_bad_dates@example.com");
      const start = new Date("2026-02-15T00:00:00Z").toISOString();
      const end = new Date("2026-02-10T00:00:00Z").toISOString();

      const res = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${token}`)
        .send({
          billingPeriodStart: start,
          billingPeriodEnd: end
        });
      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.message.toLowerCase(), /date|period/);
    });

    it("GET /api/billing/:id & GET /api/billing/:id/usage: 200 OK on generated invoice", async () => {
      const { token } = await registerUser("billing_details@example.com");
      const gen = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${token}`)
        .send({
          billingPeriodStart: "2026-03-01T00:00:00Z",
          billingPeriodEnd: "2026-03-31T23:59:59Z"
        });
      const invoiceId = gen.body.data.billingRecord.id;

      // GET detail
      const detailRes = await request(app)
        .get(`/api/billing/${invoiceId}`)
        .set("Authorization", `Bearer ${token}`);
      assert.equal(detailRes.status, 200);
      assert.equal(detailRes.body.success, true);
      assert.equal(detailRes.body.data.billingRecord.id, invoiceId);
      assert.ok(Array.isArray(detailRes.body.data.billingRecord.lineItems));

      // GET audit trail
      const auditRes = await request(app)
        .get(`/api/billing/${invoiceId}/usage`)
        .set("Authorization", `Bearer ${token}`);
      assert.equal(auditRes.status, 200);
      assert.ok(Array.isArray(auditRes.body.data.usageRecords));
    });
  });

  // ==========================================
  // 6. BUDGETS & ALERTS CONTRACTS
  // ==========================================
  describe("Budgets & Alerts API Contracts", () => {
    it("POST /api/budgets: 201 Created on valid budget creation", async () => {
      const { token } = await registerUser("budgets_contract@example.com");
      const res = await request(app)
        .post("/api/budgets")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Q1 Infrastructure Budget",
          amount: "5000.00",
          currency: "USD",
          periodType: "monthly",
          startDate: "2026-01-01T00:00:00.000Z",
          endDate: "2026-03-31T23:59:59.999Z",
          thresholds: [50, 75, 90, 100]
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.budget.name, "Q1 Infrastructure Budget");
      assert.equal(res.body.data.budget.amount, "5000.00");
    });

    it("PUT & DELETE /api/budgets/:id: 200 OK", async () => {
      const { token } = await registerUser("budget_ops@example.com");
      const created = await request(app)
        .post("/api/budgets")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Operations Budget",
          amount: "1200.00",
          currency: "USD",
          periodType: "monthly",
          startDate: "2026-04-01T00:00:00.000Z",
          endDate: "2026-04-30T23:59:59.999Z"
        });
      const budgetId = created.body.data.budget.id;

      // Update
      const putRes = await request(app)
        .put(`/api/budgets/${budgetId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Updated Operations Budget", amount: "1500.00" });
      assert.equal(putRes.status, 200);
      assert.equal(putRes.body.data.budget.name, "Updated Operations Budget");

      // Delete
      const delRes = await request(app)
        .delete(`/api/budgets/${budgetId}`)
        .set("Authorization", `Bearer ${token}`);
      assert.equal(delRes.status, 200);
      assert.equal(delRes.body.success, true);
    });

    it("POST /api/budgets/:id/evaluate & Alerts handling: 200 OK", async () => {
      const { token } = await registerUser("budget_eval@example.com");
      const created = await request(app)
        .post("/api/budgets")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Small Limit Budget",
          amount: "100.00",
          currency: "USD",
          periodType: "monthly",
          startDate: "2026-01-01T00:00:00.000Z",
          endDate: "2026-12-31T23:59:59.999Z",
          thresholds: [50, 80, 100]
        });
      const budgetId = created.body.data.budget.id;

      // Evaluate
      const evalRes = await request(app)
        .post(`/api/budgets/${budgetId}/evaluate`)
        .set("Authorization", `Bearer ${token}`)
        .send({});
      assert.equal(evalRes.status, 200);
      assert.equal(evalRes.body.success, true);

      // List Alerts
      const alertsRes = await request(app)
        .get("/api/budgets/alerts")
        .set("Authorization", `Bearer ${token}`);
      assert.equal(alertsRes.status, 200);
      assert.ok(Array.isArray(alertsRes.body.data.alerts));
    });
  });

  // ==========================================
  // 7. GENERAL SYSTEM PROTOCOL CONTRACTS
  // ==========================================
  describe("General System Protocol & Edge-Case Contracts", () => {
    it("Undefined API routes return 404 Not Found", async () => {
      const res = await request(app).get("/api/undefined_route_endpoint");
      assert.equal(res.status, 404);
      assert.equal(res.body.success, false);
      assert.match(res.body.message.toLowerCase(), /cannot get/);
    });

    it("Malformed JSON body in POST returns 400 Bad Request", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .set("Content-Type", "application/json")
        .send('{"email": "broken"'); // Malformed JSON string

      assert.equal(res.status, 400);
    });
  });

  // ==========================================
  // 8. FRONTEND API CLIENT INTEGRATION IN VM
  // ==========================================
  describe("Frontend MeterFlowAPI Client VM Evaluation", () => {
    let clientApi;

    before(() => {
      const clientCode = fs.readFileSync(
        path.resolve(process.cwd(), "../frontend/js/api.js"),
        "utf8"
      );
      const storage = new Map();
      const mockLocalStorage = {
        getItem: (k) => storage.get(k) || null,
        setItem: (k, v) => storage.set(k, String(v)),
        removeItem: (k) => storage.delete(k),
        clear: () => storage.clear()
      };
      const sandbox = {
        window: {
          location: { origin: "http://localhost:3000", pathname: "/" }
        },
        localStorage: mockLocalStorage,
        console: { error: () => {}, warn: () => {}, log: () => {} }
      };
      sandbox.window.window = sandbox.window;
      vm.createContext(sandbox);
      vm.runInContext(clientCode, sandbox);
      clientApi = sandbox.window.MeterFlowAPI;
    });

    it("MeterFlowAPI formats 400, 401, 403, 404, 409, 413, 500 error messages correctly", () => {
      assert.equal(
        clientApi.formatAuthErrorMessage({ status: 400, message: "Field invalid" }),
        "Field invalid"
      );
      assert.equal(
        clientApi.formatAuthErrorMessage({ status: 401, message: "Session expired" }),
        "Your session has expired. Please sign in again."
      );
      assert.equal(
        clientApi.formatAuthErrorMessage({ status: 403, message: "User suspended" }),
        "Access Denied: Your workspace membership is suspended or inactive."
      );
      assert.equal(
        clientApi.formatAuthErrorMessage({ status: 404, message: "Resource missing" }),
        "Resource missing"
      );
      assert.equal(
        clientApi.formatAuthErrorMessage({ status: 409, message: "Email in use" }),
        "Email in use"
      );
      assert.equal(
        clientApi.formatAuthErrorMessage({ status: 413, message: "Too large" }),
        "Too large"
      );
      assert.equal(
        clientApi.formatAuthErrorMessage({ status: 500 }),
        "A server error occurred. Please try again later."
      );
      assert.equal(
        clientApi.formatAuthErrorMessage({ status: 500, message: "Internal server error" }),
        "Internal server error"
      );
    });

    it("MeterFlowAPI exposes delete method with optional body", () => {
      assert.equal(typeof clientApi.delete, "function");
    });
  });
});
