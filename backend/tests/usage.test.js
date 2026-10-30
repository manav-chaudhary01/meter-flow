import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import UsageRecord from "../src/models/UsageRecord.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";

describe("Usage Ingestion, History & Aggregation API", () => {
  let tokenA;
  let tokenB;
  let tenantAId;
  let tenantBId;
  let meteredServiceId;
  let hybridServiceId;
  let subscriptionServiceId;
  let archivedServiceId;

  before(async () => {
    await connectTestDb();
  });

  after(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();

    // Register Workspace A
    const regA = await request(app).post("/api/auth/register").send({
      name: "Alice Owner",
      email: "alice@company-a.com",
      password: "password123",
      organizationName: "Company Alpha"
    });
    tokenA = regA.body.data.token;
    tenantAId = regA.body.data.tenant.id;

    // Register Workspace B
    const regB = await request(app).post("/api/auth/register").send({
      name: "Bob Owner",
      email: "bob@company-b.com",
      password: "password123",
      organizationName: "Company Beta"
    });
    tokenB = regB.body.data.token;
    tenantBId = regB.body.data.tenant.id;

    // Create metered service in Workspace A
    const sMetered = await request(app)
      .post("/api/services")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        name: "Anthropic Claude Tokens",
        trackingType: "metered",
        currency: "USD",
        unit: "tokens",
        unitPrice: "0.000015"
      });
    meteredServiceId = sMetered.body.data.service.id;

    // Create hybrid service in Workspace A
    const sHybrid = await request(app)
      .post("/api/services")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        name: "AWS EC2 Compute",
        trackingType: "hybrid",
        currency: "USD",
        unit: "hours",
        unitPrice: "0.085",
        subscriptionAmount: "20.00",
        billingInterval: "monthly"
      });
    hybridServiceId = sHybrid.body.data.service.id;

    // Create subscription service in Workspace A
    const sSub = await request(app)
      .post("/api/services")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        name: "Jira Cloud",
        trackingType: "subscription",
        currency: "USD",
        subscriptionAmount: "50.00",
        billingInterval: "monthly"
      });
    subscriptionServiceId = sSub.body.data.service.id;

    // Create archived service in Workspace A
    const sArchived = await request(app)
      .post("/api/services")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        name: "Legacy Search API",
        trackingType: "metered",
        currency: "USD",
        unit: "queries",
        unitPrice: "0.001"
      });
    archivedServiceId = sArchived.body.data.service.id;
    await request(app)
      .delete(`/api/services/${archivedServiceId}`)
      .set("Authorization", `Bearer ${tokenA}`);
  });

  describe("POST /api/usage (Usage Ingestion)", () => {
    it("should ingest usage record for metered service", async () => {
      const res = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          serviceId: meteredServiceId,
          quantity: "5000",
          unit: "tokens",
          source: "api-backend",
          metadata: { model: "claude-3-opus", promptId: "xyz-1" }
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.idempotentReplay, false);
      assert.equal(res.body.data.record.quantity, "5000");
      assert.equal(res.body.data.record.unit, "tokens");
      assert.equal(res.body.data.record.serviceId, meteredServiceId);
      assert.equal(res.body.data.record.metadata.model, "claude-3-opus");
    });

    it("should accept quantity of zero (0) according to defined policy", async () => {
      const res = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          serviceId: meteredServiceId,
          quantity: "0",
          unit: "tokens"
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.data.record.quantity, "0");
    });

    it("should reject negative quantity with 400", async () => {
      const res = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          serviceId: meteredServiceId,
          quantity: "-100",
          unit: "tokens"
        });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /non-negative/i);
    });

    it("should reject non-numeric quantity with 400", async () => {
      const res = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          serviceId: meteredServiceId,
          quantity: "not-a-number",
          unit: "tokens"
        });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /valid numeric decimal/i);
    });

    it("should reject unit mismatch against service configuration", async () => {
      const res = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          serviceId: meteredServiceId,
          quantity: "100",
          unit: "gigabytes"
        });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Unit mismatch/i);
    });

    it("should reject usage ingestion for archived service", async () => {
      const res = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          serviceId: archivedServiceId,
          quantity: "10",
          unit: "queries"
        });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /archived service/i);
    });

    it("should reject usage ingestion for subscription-only service", async () => {
      const res = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          serviceId: subscriptionServiceId,
          quantity: "1",
          unit: "seat"
        });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /subscription-only/i);
    });

    it("should reject usage ingestion for service owned by another workspace (404)", async () => {
      // Tenant B attempts to record usage against Tenant A's service
      const res = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${tokenB}`)
        .send({
          serviceId: meteredServiceId,
          quantity: "100",
          unit: "tokens"
        });

      assert.equal(res.status, 404);
      assert.match(res.body.message, /not found in active workspace/i);
    });
  });

  describe("Idempotency & Duplicate Prevention", () => {
    it("should return HTTP 200 with idempotentReplay: true on identical event replay", async () => {
      const payload = {
        serviceId: meteredServiceId,
        quantity: "2500",
        unit: "tokens",
        idempotencyKey: "unique-event-key-001",
        occurredAt: "2026-10-30T10:00:00.000Z"
      };

      // 1. Initial ingestion
      const first = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${tokenA}`)
        .send(payload);

      assert.equal(first.status, 201);
      assert.equal(first.body.data.idempotentReplay, false);
      const recordId = first.body.data.record.id;

      // 2. Replay identical event
      const replay = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${tokenA}`)
        .send(payload);

      assert.equal(replay.status, 200);
      assert.equal(replay.body.data.idempotentReplay, true);
      assert.equal(replay.body.data.record.id, recordId);

      // Verify database contains only 1 record
      const count = await UsageRecord.countDocuments({
        tenantId: tenantAId,
        idempotencyKey: "unique-event-key-001"
      });
      assert.equal(count, 1);
    });

    it("should reject reused idempotencyKey with conflicting payload (409 Conflict)", async () => {
      // 1. Initial event with quantity 100
      await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          serviceId: meteredServiceId,
          quantity: "100",
          unit: "tokens",
          idempotencyKey: "key-conflict-test-123"
        });

      // 2. Reusing key with different quantity (200)
      const conflictRes = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          serviceId: meteredServiceId,
          quantity: "200",
          unit: "tokens",
          idempotencyKey: "key-conflict-test-123"
        });

      assert.equal(conflictRes.status, 409);
      assert.match(conflictRes.body.message, /Idempotency conflict/i);
    });

    it("should safely handle concurrent identical requests without duplicates or 500 error", async () => {
      const payload = {
        serviceId: hybridServiceId,
        quantity: "4.50",
        unit: "hours",
        idempotencyKey: "concurrent-run-key-abc",
        occurredAt: "2026-10-30T11:00:00.000Z"
      };

      // Fire 3 simultaneous identical requests
      const results = await Promise.all([
        request(app).post("/api/usage").set("Authorization", `Bearer ${tokenA}`).send(payload),
        request(app).post("/api/usage").set("Authorization", `Bearer ${tokenA}`).send(payload),
        request(app).post("/api/usage").set("Authorization", `Bearer ${tokenA}`).send(payload)
      ]);

      // All must succeed (status 200 or 201)
      results.forEach((res) => {
        assert.ok([200, 201].includes(res.status), `Unexpected status ${res.status}`);
        assert.equal(res.body.success, true);
      });

      // Exactly 1 document inserted in DB
      const count = await UsageRecord.countDocuments({
        tenantId: tenantAId,
        idempotencyKey: "concurrent-run-key-abc"
      });
      assert.equal(count, 1);
    });
  });

  describe("GET /api/usage (Usage History & Pagination)", () => {
    beforeEach(async () => {
      // Seed records with sequential timestamps
      const dates = [
        "2026-10-01T10:00:00.000Z",
        "2026-10-05T12:00:00.000Z",
        "2026-10-10T14:00:00.000Z",
        "2026-10-15T16:00:00.000Z",
        "2026-10-20T18:00:00.000Z"
      ];

      for (let i = 0; i < dates.length; i++) {
        await request(app)
          .post("/api/usage")
          .set("Authorization", `Bearer ${tokenA}`)
          .send({
            serviceId: meteredServiceId,
            quantity: `${(i + 1) * 100}`,
            unit: "tokens",
            occurredAt: dates[i]
          });
      }
    });

    it("should list usage records with default pagination", async () => {
      const res = await request(app)
        .get("/api/usage")
        .set("Authorization", `Bearer ${tokenA}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.records.length, 5);
      assert.equal(res.body.data.pagination.total, 5);
      assert.equal(res.body.data.pagination.page, 1);
      // Newest first sorting
      assert.equal(res.body.data.records[0].quantity, "500");
    });

    it("should filter by date range with inclusive start and exclusive end (start <= occurredAt < end)", async () => {
      // Between 2026-10-05 and 2026-10-15 (exclusive of 10-15)
      const res = await request(app)
        .get("/api/usage?startDate=2026-10-05T00:00:00.000Z&endDate=2026-10-15T00:00:00.000Z")
        .set("Authorization", `Bearer ${tokenA}`);

      assert.equal(res.status, 200);
      // Expected records: 2026-10-05 (200) and 2026-10-10 (300). 2026-10-15 is >= end date, excluded!
      assert.equal(res.body.data.records.length, 2);
      const quantities = res.body.data.records.map((r) => r.quantity);
      assert.ok(quantities.includes("200"));
      assert.ok(quantities.includes("300"));
      assert.ok(!quantities.includes("400"));
    });

    it("should paginate with custom limit and page", async () => {
      const page1 = await request(app)
        .get("/api/usage?page=1&limit=2")
        .set("Authorization", `Bearer ${tokenA}`);

      assert.equal(page1.body.data.records.length, 2);
      assert.equal(page1.body.data.pagination.pages, 3);

      const page2 = await request(app)
        .get("/api/usage?page=2&limit=2")
        .set("Authorization", `Bearer ${tokenA}`);

      assert.equal(page2.body.data.records.length, 2);
      assert.notEqual(page1.body.data.records[0].id, page2.body.data.records[0].id);
    });
  });

  describe("GET /api/usage/summary (Usage Aggregation)", () => {
    beforeEach(async () => {
      // 3 usage events for meteredService (100, 250, 400 => total 750)
      await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ serviceId: meteredServiceId, quantity: "100", unit: "tokens", occurredAt: "2026-10-01T10:00:00Z" });
      await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ serviceId: meteredServiceId, quantity: "250", unit: "tokens", occurredAt: "2026-10-02T10:00:00Z" });
      await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ serviceId: meteredServiceId, quantity: "400", unit: "tokens", occurredAt: "2026-10-03T10:00:00Z" });

      // 2 usage events for hybridService (10, 20 => total 30)
      await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ serviceId: hybridServiceId, quantity: "10", unit: "hours", occurredAt: "2026-10-01T12:00:00Z" });
      await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ serviceId: hybridServiceId, quantity: "20", unit: "hours", occurredAt: "2026-10-02T12:00:00Z" });
    });

    it("should aggregate total quantity, event count, min, and max by service", async () => {
      const res = await request(app)
        .get("/api/usage/summary?groupBy=service")
        .set("Authorization", `Bearer ${tokenA}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.summary.length, 2);

      const meteredSummary = res.body.data.summary.find((s) => s.serviceId === meteredServiceId);
      assert.ok(meteredSummary);
      assert.equal(meteredSummary.totalQuantity, "750");
      assert.equal(meteredSummary.eventCount, 3);
      assert.equal(meteredSummary.minQuantity, "100");
      assert.equal(meteredSummary.maxQuantity, "400");
      assert.equal(meteredSummary.unit, "tokens");

      const hybridSummary = res.body.data.summary.find((s) => s.serviceId === hybridServiceId);
      assert.ok(hybridSummary);
      assert.equal(hybridSummary.totalQuantity, "30");
      assert.equal(hybridSummary.eventCount, 2);
    });

    it("should aggregate usage grouped by day", async () => {
      const res = await request(app)
        .get(`/api/usage/summary?serviceId=${meteredServiceId}&groupBy=day`)
        .set("Authorization", `Bearer ${tokenA}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.summary.length, 3);
      assert.ok(res.body.data.summary.every((s) => s.period.startsWith("2026-10-")));
    });

    it("should never include another workspace's data in usage history or aggregation", async () => {
      // Tenant B queries usage history & summary
      const historyB = await request(app)
        .get("/api/usage")
        .set("Authorization", `Bearer ${tokenB}`);
      assert.equal(historyB.body.data.records.length, 0);

      const summaryB = await request(app)
        .get("/api/usage/summary")
        .set("Authorization", `Bearer ${tokenB}`);
      assert.equal(summaryB.body.data.summary.length, 0);
    });
  });
});
