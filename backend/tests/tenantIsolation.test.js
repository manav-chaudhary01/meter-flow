import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";

describe("Tenant Isolation Tests (Multi-tenant Data Boundary)", () => {
  let tenantAToken;
  let tenantBToken;
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

    // Register Tenant A
    const regA = await request(app).post("/api/auth/register").send({
      name: "Tenant A Admin",
      email: "admin@tenant-a.com",
      password: "password123",
      organizationName: "Tenant Alpha Corp"
    });
    tenantAToken = regA.body.data.token;
    tenantAId = regA.body.data.tenant.id;

    // Register Tenant B
    const regB = await request(app).post("/api/auth/register").send({
      name: "Tenant B Admin",
      email: "admin@tenant-b.com",
      password: "password123",
      organizationName: "Tenant Beta Ltd"
    });
    tenantBToken = regB.body.data.token;
    tenantBId = regB.body.data.tenant.id;
  });

  it("should enforce complete isolation between Tenant A and Tenant B resources", async () => {
    // 1. Tenant A creates a private resource
    const createResA = await request(app)
      .post("/api/resources")
      .set("Authorization", `Bearer ${tenantAToken}`)
      .send({
        name: "Alpha Confidential API",
        unit: "query",
        price: "10.00"
      });

    assert.equal(createResA.status, 201);
    const resourceAId = createResA.body.data.resource._id;

    // 2. Tenant B lists resources - must NOT contain Tenant A's resource
    const listResB = await request(app)
      .get("/api/resources")
      .set("Authorization", `Bearer ${tenantBToken}`);

    assert.equal(listResB.status, 200);
    assert.equal(listResB.body.data.resources.length, 0);

    // 3. Tenant B tries to fetch Tenant A's resource by ID - must return 404
    const getResB = await request(app)
      .get(`/api/resources/${resourceAId}`)
      .set("Authorization", `Bearer ${tenantBToken}`);

    assert.equal(getResB.status, 404);
    assert.match(getResB.body.message, /not found/i);

    // 4. Tenant B tries to update Tenant A's resource - must return 404
    const updateResB = await request(app)
      .put(`/api/resources/${resourceAId}`)
      .set("Authorization", `Bearer ${tenantBToken}`)
      .send({
        name: "Hacked by Tenant B",
        unit: "query",
        price: "0.01"
      });

    assert.equal(updateResB.status, 404);

    // 5. Tenant B tries to delete Tenant A's resource - must return 404
    const deleteResB = await request(app)
      .delete(`/api/resources/${resourceAId}`)
      .set("Authorization", `Bearer ${tenantBToken}`);

    assert.equal(deleteResB.status, 404);

    // 6. Tenant A verifies their resource is untouched and intact
    const verifyResA = await request(app)
      .get(`/api/resources/${resourceAId}`)
      .set("Authorization", `Bearer ${tenantAToken}`);

    assert.equal(verifyResA.status, 200);
    assert.equal(verifyResA.body.data.resource.name, "Alpha Confidential API");
    const price = verifyResA.body.data.resource.price.$numberDecimal || verifyResA.body.data.resource.price;
    assert.equal(price, "10.00");
  });
});
