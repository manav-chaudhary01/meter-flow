import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";

describe("Resource CRUD API", () => {
  let authToken;
  let tenantId;

  before(async () => {
    await connectTestDb();
  });

  after(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();

    const reg = await request(app).post("/api/auth/register").send({
      name: "Resource Tester",
      email: "resourcetester@example.com",
      password: "password123",
      organizationName: "Test Cloud Org"
    });

    authToken = reg.body.data.token;
    tenantId = reg.body.data.tenant.id;
  });

  describe("POST /api/resources", () => {
    it("should create a resource with valid name, unit, and price", async () => {
      const res = await request(app)
        .post("/api/resources")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          name: "API Requests",
          unit: "1000 requests",
          price: "5.5000"
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.resource.name, "API Requests");
      assert.equal(res.body.data.resource.unit, "1000 requests");
      assert.equal(res.body.data.resource.tenantId, tenantId);
    });

    it("should reject creation with missing fields", async () => {
      const res = await request(app)
        .post("/api/resources")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          name: "Incomplete Resource"
        });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
    });

    it("should reject creation with negative or invalid price", async () => {
      const negativeRes = await request(app)
        .post("/api/resources")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          name: "Compute Hours",
          unit: "hour",
          price: "-2.5"
        });
      assert.equal(negativeRes.status, 400);

      const invalidRes = await request(app)
        .post("/api/resources")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          name: "Compute Hours",
          unit: "hour",
          price: "not-a-number"
        });
      assert.equal(invalidRes.status, 400);
    });
  });

  describe("GET /api/resources", () => {
    it("should list resources for current tenant", async () => {
      await request(app)
        .post("/api/resources")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "Storage GB", unit: "GB-month", price: "0.025" });

      const res = await request(app)
        .get("/api/resources")
        .set("Authorization", `Bearer ${authToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.resources.length, 1);
      assert.equal(res.body.data.resources[0].name, "Storage GB");
    });
  });

  describe("GET /api/resources/:id", () => {
    it("should retrieve an existing resource by ID", async () => {
      const created = await request(app)
        .post("/api/resources")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "Bandwidth", unit: "TB", price: "12.00" });

      const resourceId = created.body.data.resource._id;

      const res = await request(app)
        .get(`/api/resources/${resourceId}`)
        .set("Authorization", `Bearer ${authToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.resource.name, "Bandwidth");
    });

    it("should return 400 for malformed ObjectId", async () => {
      const res = await request(app)
        .get("/api/resources/invalid-mongo-id")
        .set("Authorization", `Bearer ${authToken}`);

      assert.equal(res.status, 400);
      assert.match(res.body.message, /invalid resource id/i);
    });

    it("should return 404 for nonexistent valid ObjectId", async () => {
      const res = await request(app)
        .get("/api/resources/507f1f77bcf86cd799439011")
        .set("Authorization", `Bearer ${authToken}`);

      assert.equal(res.status, 404);
      assert.match(res.body.message, /not found/i);
    });
  });

  describe("PUT /api/resources/:id", () => {
    it("should update an existing resource", async () => {
      const created = await request(app)
        .post("/api/resources")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "Old Name", unit: "hour", price: "1.00" });

      const resourceId = created.body.data.resource._id;

      const res = await request(app)
        .put(`/api/resources/${resourceId}`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "Updated Name", unit: "hour", price: "2.50" });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.resource.name, "Updated Name");
    });

    it("should reject update with invalid price", async () => {
      const created = await request(app)
        .post("/api/resources")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "Price Test", unit: "unit", price: "1.00" });

      const resourceId = created.body.data.resource._id;

      const res = await request(app)
        .put(`/api/resources/${resourceId}`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "Price Test", unit: "unit", price: "invalid" });

      assert.equal(res.status, 400);
    });
  });

  describe("DELETE /api/resources/:id", () => {
    it("should delete an existing resource", async () => {
      const created = await request(app)
        .post("/api/resources")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "To Delete", unit: "unit", price: "1.00" });

      const resourceId = created.body.data.resource._id;

      const delRes = await request(app)
        .delete(`/api/resources/${resourceId}`)
        .set("Authorization", `Bearer ${authToken}`);

      assert.equal(delRes.status, 200);
      assert.equal(delRes.body.success, true);

      // Verify it is gone
      const getRes = await request(app)
        .get(`/api/resources/${resourceId}`)
        .set("Authorization", `Bearer ${authToken}`);

      assert.equal(getRes.status, 404);
    });
  });
});
