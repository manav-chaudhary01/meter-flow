import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
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
      assert.equal(res.body.data.tenant.name, "Acme Cloud");
      assert.ok(res.body.data.user.tenantId);
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
});
