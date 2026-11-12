import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";

describe("TrackedService Catalog API", () => {
  let ownerTokenA;
  let memberTokenA;
  let ownerTokenB;
  let tenantAId;
  let tenantBId;

  before(async () => {
    await connectTestDb();
  });

  after(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();

    // 1. Register Tenant A Owner
    const regA = await request(app).post("/api/auth/register").send({
      name: "Alice Owner",
      email: "alice@org-a.com",
      password: "password123",
      organizationName: "Org Alpha"
    });
    ownerTokenA = regA.body.data.token;
    tenantAId = regA.body.data.tenant.id;

    // 2. Register Tenant B Owner
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

    const addMemberRes = await request(app)
      .post(`/api/workspaces/${tenantAId}/members`)
      .set("Authorization", `Bearer ${ownerTokenA}`)
      .send({ email: "charlie@org-a.com", role: "member" });
    assert.equal(addMemberRes.status, 201);

    const loginCharlie = await request(app).post("/api/auth/login").send({
      email: "charlie@org-a.com",
      password: "password123"
    });

    // Switch Charlie to Org Alpha
    const switchRes = await request(app)
      .post("/api/workspaces/switch")
      .set("Authorization", `Bearer ${loginCharlie.body.data.token}`)
      .send({ workspaceId: tenantAId });
    memberTokenA = switchRes.body.data.token;
  });

  describe("POST /api/services", () => {
    it("should create a valid 'metered' service", async () => {
      const res = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "OpenAI GPT-4 Tokens",
          provider: "OpenAI",
          category: "ai",
          trackingType: "metered",
          currency: "USD",
          unit: "1k-tokens",
          unitPrice: "0.0300"
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.service.name, "OpenAI GPT-4 Tokens");
      assert.equal(res.body.data.service.trackingType, "metered");
      assert.equal(res.body.data.service.unit, "1k-tokens");
      assert.equal(res.body.data.service.unitPrice, "0.03");
      assert.equal(res.body.data.service.subscriptionAmount, null);
      assert.equal(res.body.data.service.status, "active");
    });

    it("should create a valid 'subscription' service", async () => {
      const res = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "GitHub Enterprise",
          provider: "GitHub",
          category: "developer-tools",
          trackingType: "subscription",
          currency: "USD",
          subscriptionAmount: "21.00",
          billingInterval: "monthly"
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.service.trackingType, "subscription");
      assert.equal(res.body.data.service.subscriptionAmount, "21");
      assert.equal(res.body.data.service.billingInterval, "monthly");
      assert.equal(res.body.data.service.unit, null);
    });

    it("should create a valid 'hybrid' service", async () => {
      const res = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "Datadog Infrastructure Pro",
          provider: "Datadog",
          category: "monitoring",
          trackingType: "hybrid",
          currency: "USD",
          unit: "host",
          unitPrice: "15.00",
          subscriptionAmount: "100.00",
          billingInterval: "monthly"
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.service.trackingType, "hybrid");
      assert.equal(res.body.data.service.unit, "host");
      assert.equal(res.body.data.service.unitPrice, "15");
      assert.equal(res.body.data.service.subscriptionAmount, "100");
      assert.equal(res.body.data.service.billingInterval, "monthly");
    });

    it("should reject invalid tracking type", async () => {
      const res = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "Invalid Service",
          trackingType: "unsupported"
        });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Tracking type must be/i);
    });

    it("should reject metered service without unit or unitPrice", async () => {
      const noUnit = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "Compute Hours",
          trackingType: "metered",
          unitPrice: "0.50"
        });
      assert.equal(noUnit.status, 400);
      assert.match(noUnit.body.message, /unit is required/i);

      const noPrice = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "Compute Hours",
          trackingType: "metered",
          unit: "hour"
        });
      assert.equal(noPrice.status, 400);
      assert.match(noPrice.body.message, /unit price is required/i);
    });

    it("should reject negative unitPrice or subscriptionAmount", async () => {
      const negMetered = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "Compute",
          trackingType: "metered",
          unit: "hour",
          unitPrice: "-1.50"
        });
      assert.equal(negMetered.status, 400);
      assert.match(negMetered.body.message, /non-negative/i);

      const negSub = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "Hosting",
          trackingType: "subscription",
          subscriptionAmount: "-50.00"
        });
      assert.equal(negSub.status, 400);
      assert.match(negSub.body.message, /non-negative/i);
    });

    it("should reject non-admin/non-owner member from creating services (403)", async () => {
      const res = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${memberTokenA}`)
        .send({
          name: "Member Created Service",
          trackingType: "metered",
          unit: "call",
          unitPrice: "0.01"
        });

      assert.equal(res.status, 403);
      assert.match(res.body.message, /requires one of the following roles/i);
    });
  });

  describe("GET /api/services", () => {
    beforeEach(async () => {
      await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "AWS S3 Storage",
          trackingType: "metered",
          unit: "GB",
          unitPrice: "0.023",
          category: "cloud"
        });

      await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "Figma Team",
          trackingType: "subscription",
          subscriptionAmount: "15.00",
          category: "design"
        });
    });

    it("should list active services for authenticated workspace member", async () => {
      const res = await request(app)
        .get("/api/services")
        .set("Authorization", `Bearer ${memberTokenA}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.services.length, 2);
    });

    it("should filter services by category and trackingType", async () => {
      const res = await request(app)
        .get("/api/services?category=cloud&trackingType=metered")
        .set("Authorization", `Bearer ${ownerTokenA}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.services.length, 1);
      assert.equal(res.body.data.services[0].name, "AWS S3 Storage");
    });
  });

  describe("GET /api/services/:id, PUT /api/services/:id, DELETE /api/services/:id", () => {
    let serviceIdA;

    beforeEach(async () => {
      const created = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "Stripe Gateway",
          provider: "Stripe",
          trackingType: "metered",
          unit: "txn",
          unitPrice: "0.30"
        });
      serviceIdA = created.body.data.service.id;
    });

    it("should retrieve a service by ID", async () => {
      const res = await request(app)
        .get(`/api/services/${serviceIdA}`)
        .set("Authorization", `Bearer ${ownerTokenA}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.service.name, "Stripe Gateway");
    });

    it("should update a service when caller is owner or admin", async () => {
      const res = await request(app)
        .put(`/api/services/${serviceIdA}`)
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "Stripe Gateway (Updated)",
          unitPrice: "0.3500"
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.service.name, "Stripe Gateway (Updated)");
      assert.equal(res.body.data.service.unitPrice, "0.35");
    });

    it("should archive a service on DELETE /api/services/:id", async () => {
      const res = await request(app)
        .delete(`/api/services/${serviceIdA}`)
        .set("Authorization", `Bearer ${ownerTokenA}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.service.status, "archived");

      // Verify active listing does not return it by default
      const listRes = await request(app)
        .get("/api/services")
        .set("Authorization", `Bearer ${ownerTokenA}`);
      assert.equal(listRes.body.data.services.length, 0);

      // Verify listing with status=archived shows it
      const archivedList = await request(app)
        .get("/api/services?status=archived")
        .set("Authorization", `Bearer ${ownerTokenA}`);
      assert.equal(archivedList.body.data.services.length, 1);
    });

    it("should enforce cross-workspace isolation (Tenant B cannot read, update, or archive Tenant A service)", async () => {
      // 1. Tenant B tries to get Tenant A's service -> 404
      const getB = await request(app)
        .get(`/api/services/${serviceIdA}`)
        .set("Authorization", `Bearer ${ownerTokenB}`);
      assert.equal(getB.status, 404);

      // 2. Tenant B tries to update Tenant A's service -> 404
      const putB = await request(app)
        .put(`/api/services/${serviceIdA}`)
        .set("Authorization", `Bearer ${ownerTokenB}`)
        .send({ name: "Hacked by Tenant B" });
      assert.equal(putB.status, 404);

      // 3. Tenant B tries to archive Tenant A's service -> 404
      const delB = await request(app)
        .delete(`/api/services/${serviceIdA}`)
        .set("Authorization", `Bearer ${ownerTokenB}`);
      assert.equal(delB.status, 404);
    });

    it("should reject member role on PUT and DELETE (403) while allowing admin role full CRUD", async () => {
      // Member cannot update or archive Tenant A's service
      const memberPut = await request(app)
        .put(`/api/services/${serviceIdA}`)
        .set("Authorization", `Bearer ${memberTokenA}`)
        .send({ name: "Unauthorized Edit" });
      assert.equal(memberPut.status, 403);

      const memberDel = await request(app)
        .delete(`/api/services/${serviceIdA}`)
        .set("Authorization", `Bearer ${memberTokenA}`);
      assert.equal(memberDel.status, 403);

      // Register and promote an Admin in Tenant A
      await request(app).post("/api/auth/register").send({
        name: "Dana Admin",
        email: "dana@org-a.com",
        password: "password123",
        organizationName: "Dana Temp Org"
      });

      const addAdmin = await request(app)
        .post(`/api/workspaces/${tenantAId}/members`)
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({ email: "dana@org-a.com", role: "admin" });
      assert.equal(addAdmin.status, 201);

      const loginAdmin = await request(app).post("/api/auth/login").send({
        email: "dana@org-a.com",
        password: "password123"
      });
      const switchAdmin = await request(app)
        .post("/api/workspaces/switch")
        .set("Authorization", `Bearer ${loginAdmin.body.data.token}`)
        .send({ workspaceId: tenantAId });
      const adminTokenA = switchAdmin.body.data.token;

      // Admin can create, update, and archive
      const adminCreate = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${adminTokenA}`)
        .send({
          name: "Cloudflare Workers",
          provider: "Cloudflare",
          category: "edge",
          trackingType: "subscription",
          currency: "EUR",
          subscriptionAmount: "5.00",
          billingInterval: "monthly"
        });
      assert.equal(adminCreate.status, 201);
      const adminServiceId = adminCreate.body.data.service.id;

      const adminUpdate = await request(app)
        .put(`/api/services/${adminServiceId}`)
        .set("Authorization", `Bearer ${adminTokenA}`)
        .send({ subscriptionAmount: "10.00", billingInterval: "yearly" });
      assert.equal(adminUpdate.status, 200);
      assert.equal(adminUpdate.body.data.service.subscriptionAmount, "10");
      assert.equal(adminUpdate.body.data.service.billingInterval, "yearly");

      const adminArchive = await request(app)
        .delete(`/api/services/${adminServiceId}`)
        .set("Authorization", `Bearer ${adminTokenA}`);
      assert.equal(adminArchive.status, 200);
      assert.equal(adminArchive.body.data.service.status, "archived");
    });

    it("should keep trackingType immutable, reject invalid update fields (400), and allow reactivation", async () => {
      const badCurrency = await request(app)
        .put(`/api/services/${serviceIdA}`)
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({ currency: "BAD1" });
      assert.equal(badCurrency.status, 400);
      assert.match(badCurrency.body.message, /3-letter ISO code/i);

      // Attempting to switch trackingType via PUT leaves existing type unchanged
      const attemptTypeChange = await request(app)
        .put(`/api/services/${serviceIdA}`)
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({ trackingType: "subscription", name: "Stripe Metered" });
      assert.equal(attemptTypeChange.status, 200);
      assert.equal(attemptTypeChange.body.data.service.trackingType, "metered");

      // Archive then reactivate via PUT status: active
      await request(app)
        .delete(`/api/services/${serviceIdA}`)
        .set("Authorization", `Bearer ${ownerTokenA}`);

      const reactivate = await request(app)
        .put(`/api/services/${serviceIdA}`)
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({ status: "active" });
      assert.equal(reactivate.status, 200);
      assert.equal(reactivate.body.data.service.status, "active");
    });
  });
});
