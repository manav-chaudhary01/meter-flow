import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import Membership from "../src/models/Membership.js";
import User from "../src/models/User.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";

describe("Authentication API", () => {
  before(async () => {
    await connectTestDb();
  });

  after(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  describe("POST /api/auth/register", () => {
    it("should successfully register a user and tenant", async () => {
      const payload = {
        name: "Alice Developer",
        email: "alice@example.com",
        password: "password123",
        organizationName: "Acme Cloud"
      };

      const res = await request(app).post("/api/auth/register").send(payload);

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.message, "Registration successful");
      assert.ok(res.body.data.token);
      assert.equal(res.body.data.user.name, "Alice Developer");
      assert.equal(res.body.data.user.email, "alice@example.com");
      assert.equal(res.body.data.user.role, "owner");
      assert.equal(res.body.data.tenant.name, "Acme Cloud");
      assert.ok(res.body.data.user.tenantId);
    });

    it("should reject registration with name shorter than 2 characters", async () => {
      const res = await request(app).post("/api/auth/register").send({
        name: "A",
        email: "valid@example.com",
        password: "password123",
        organizationName: "Org"
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /at least 2 characters/i);
    });

    it("should reject registration with invalid email format", async () => {
      const res = await request(app).post("/api/auth/register").send({
        name: "Valid Name",
        email: "not-an-email",
        password: "password123",
        organizationName: "Org"
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /invalid email/i);
    });

    it("should reject registration with missing required fields", async () => {
      const res = await request(app).post("/api/auth/register").send({
        name: "Incomplete User",
        email: "incomplete@example.com"
      });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /required/i);
    });

    it("should reject duplicate registration with 409 Conflict", async () => {
      const payload = {
        name: "Alice Developer",
        email: "alice@example.com",
        password: "password123",
        organizationName: "Acme Cloud"
      };

      const first = await request(app).post("/api/auth/register").send(payload);
      assert.equal(first.status, 201);

      const second = await request(app).post("/api/auth/register").send(payload);
      assert.equal(second.status, 409);
      assert.equal(second.body.success, false);
      assert.match(second.body.message, /already exists/i);
    });
  });

  describe("POST /api/auth/login", () => {
    beforeEach(async () => {
      await request(app).post("/api/auth/register").send({
        name: "Login User",
        email: "login@example.com",
        password: "secretPassword",
        organizationName: "Login Org"
      });
    });

    it("should authenticate valid credentials and return JWT", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: "login@example.com",
        password: "secretPassword"
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.data.token);
      assert.equal(res.body.data.user.email, "login@example.com");
      assert.equal(res.body.data.user.role, "owner");
      assert.equal(res.body.data.tenant.name, "Login Org");
    });

    it("should reject incorrect password with 401", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: "login@example.com",
        password: "wrongPassword"
      });

      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /invalid/i);
    });

    it("should reject nonexistent user with 401", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: "nonexistent@example.com",
        password: "anyPassword"
      });

      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /invalid/i);
    });

    it("should reject login missing required credentials with 400", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: "login@example.com"
      });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
    });
  });

  describe("GET /api/auth/me", () => {
    it("should return identity for authenticated user", async () => {
      const registerRes = await request(app).post("/api/auth/register").send({
        name: "Me User",
        email: "me@example.com",
        password: "password123",
        organizationName: "Me Org"
      });

      const token = registerRes.body.data.token;

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.userId, registerRes.body.data.user.id);
      assert.equal(res.body.data.tenantId, registerRes.body.data.tenant.id);
      assert.equal(res.body.data.role, "owner");
    });

    it("should reject request without Authorization header with 401", async () => {
      const res = await request(app).get("/api/auth/me");
      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
    });

    it("should reject request with malformed/invalid token with 401", async () => {
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer invalid-token-string");
      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
    });
  });

  describe("Workspace Membership Status & RBAC Boundaries", () => {
    it("should deny access with 403 when membership is suspended", async () => {
      const reg = await request(app).post("/api/auth/register").send({
        name: "Suspended User",
        email: "suspended@example.com",
        password: "password123",
        organizationName: "Suspended Org"
      });
      const token = reg.body.data.token;
      const userId = reg.body.data.user.id;
      const tenantId = reg.body.data.tenant.id;

      // Mark membership suspended
      await Membership.updateOne(
        { userId, tenantId },
        { status: "suspended" }
      );

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);

      assert.equal(res.status, 403);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /suspended or inactive/i);
    });

    it("should deny access with 403 when user is not an active member of workspace", async () => {
      // 1. Owner registers and owns the workspace
      const ownerReg = await request(app).post("/api/auth/register").send({
        name: "Workspace Owner",
        email: "owner-ws@example.com",
        password: "password123",
        organizationName: "Protected Org"
      });
      const ownerToken = ownerReg.body.data.token;
      const tenantId = ownerReg.body.data.tenant.id;

      // 2. Member registers
      const memberReg = await request(app).post("/api/auth/register").send({
        name: "Former Member",
        email: "former@example.com",
        password: "password123",
        organizationName: "Former Personal"
      });

      // 3. Owner adds member
      await request(app)
        .post(`/api/workspaces/${tenantId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          email: "former@example.com",
          role: "member"
        });

      // 4. Member switches to Owner's workspace
      const switchRes = await request(app)
        .post("/api/workspaces/switch")
        .set("Authorization", `Bearer ${memberReg.body.data.token}`)
        .send({ workspaceId: tenantId });
      assert.equal(switchRes.status, 200);
      const memberToken = switchRes.body.data.token;

      // 5. Delete member's membership (simulate removal from workspace while owner still exists)
      const memberUser = await User.findOne({ email: "former@example.com" });
      await Membership.deleteOne({ userId: memberUser._id, tenantId });

      // 6. Member request to workspace is denied with 403
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${memberToken}`);

      assert.equal(res.status, 403);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /not an active member/i);
    });

    it("should allow member role to read data but reject administrative operations with 403", async () => {
      // 1. Register Owner
      const ownerReg = await request(app).post("/api/auth/register").send({
        name: "Owner User",
        email: "owner@example.com",
        password: "password123",
        organizationName: "Shared Org"
      });
      const ownerToken = ownerReg.body.data.token;
      const tenantId = ownerReg.body.data.tenant.id;

      // 2. Register Member
      const memberReg = await request(app).post("/api/auth/register").send({
        name: "Regular Member",
        email: "member@example.com",
        password: "password123",
        organizationName: "Member Personal Workspace"
      });

      // Add member to Owner's workspace with 'member' role
      const addMemberRes = await request(app)
        .post(`/api/workspaces/${tenantId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          email: "member@example.com",
          role: "member"
        });
      assert.equal(addMemberRes.status, 201);

      // Switch member's active workspace to Owner's workspace
      const switchRes = await request(app)
        .post("/api/workspaces/switch")
        .set("Authorization", `Bearer ${memberReg.body.data.token}`)
        .send({ workspaceId: tenantId });

      assert.equal(switchRes.status, 200);
      const memberToken = switchRes.body.data.token;

      // Verify GET /api/auth/me returns member role
      const meRes = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${memberToken}`);
      assert.equal(meRes.status, 200);
      assert.equal(meRes.body.data.role, "member");

      // Read operations succeed with 200
      const servicesRead = await request(app)
        .get("/api/services")
        .set("Authorization", `Bearer ${memberToken}`);
      assert.equal(servicesRead.status, 200);

      const billingRead = await request(app)
        .get("/api/billing")
        .set("Authorization", `Bearer ${memberToken}`);
      assert.equal(billingRead.status, 200);

      const budgetsRead = await request(app)
        .get("/api/budgets")
        .set("Authorization", `Bearer ${memberToken}`);
      assert.equal(budgetsRead.status, 200);

      // Admin write operations fail with 403 Forbidden
      const serviceCreate = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
          name: "Unauthorized Service",
          trackingType: "metered",
          currency: "USD",
          unit: "requests",
          unitPrice: 0.05
        });
      assert.equal(serviceCreate.status, 403);
      assert.equal(serviceCreate.body.success, false);
      assert.match(serviceCreate.body.message, /Forbidden.*role/i);

      const billingGenerate = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
          periodStart: "2026-11-01T00:00:00.000Z",
          periodEnd: "2026-11-15T00:00:00.000Z"
        });
      assert.equal(billingGenerate.status, 403);
      assert.equal(billingGenerate.body.success, false);

      const budgetCreate = await request(app)
        .post("/api/budgets")
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
          name: "Unauthorized Budget",
          amount: "500",
          currency: "USD",
          periodType: "monthly",
          startDate: "2026-11-01T00:00:00.000Z",
          endDate: "2026-11-30T23:59:59.999Z"
        });
      assert.equal(budgetCreate.status, 403);
      assert.equal(budgetCreate.body.success, false);

      const memberInvite = await request(app)
        .post(`/api/workspaces/${tenantId}/members`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
          email: "another@example.com",
          role: "admin"
        });
      assert.equal(memberInvite.status, 403);
      assert.equal(memberInvite.body.success, false);
    });
  });
});
