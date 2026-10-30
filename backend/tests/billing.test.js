import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import BillingRecord from "../src/models/BillingRecord.js";
import UsageRecord from "../src/models/UsageRecord.js";
import TrackedService from "../src/models/TrackedService.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";

describe("Billing Engine API", () => {
  let ownerTokenA;
  let ownerTokenB;
  let memberTokenA;
  let tenantAId;
  let tenantBId;

  let meteredServiceA;
  let subscriptionServiceA;
  let hybridServiceA;
  let dailyServiceA;
  let eurServiceA;

  before(async () => {
    await connectTestDb();
    await BillingRecord.syncIndexes();
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
      organizationName: "Charlie Org"
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

    const switchRes = await request(app)
      .post("/api/workspaces/switch")
      .set("Authorization", `Bearer ${loginCharlie.body.data.token}`)
      .send({ workspaceId: tenantAId });
    memberTokenA = switchRes.body.data.token;

    // 4. Create standard test services in Workspace A
    // Metered service: OpenAI API ($0.00002 per token)
    const sMetered = await request(app)
      .post("/api/services")
      .set("Authorization", `Bearer ${ownerTokenA}`)
      .send({
        name: "OpenAI GPT-4",
        trackingType: "metered",
        currency: "USD",
        unit: "tokens",
        unitPrice: "0.00002"
      });
    meteredServiceA = sMetered.body.data.service;

    // Subscription service: GitHub Enterprise ($50.00/month)
    const sSub = await request(app)
      .post("/api/services")
      .set("Authorization", `Bearer ${ownerTokenA}`)
      .send({
        name: "GitHub Enterprise",
        trackingType: "subscription",
        currency: "USD",
        subscriptionAmount: "50.00",
        billingInterval: "monthly"
      });
    subscriptionServiceA = sSub.body.data.service;

    // Hybrid service: Datadog ($30.00/mo base + $0.05/host-hour)
    const sHybrid = await request(app)
      .post("/api/services")
      .set("Authorization", `Bearer ${ownerTokenA}`)
      .send({
        name: "Datadog Monitoring",
        trackingType: "hybrid",
        currency: "USD",
        unit: "host-hours",
        unitPrice: "0.05",
        subscriptionAmount: "30.00",
        billingInterval: "monthly"
      });
    hybridServiceA = sHybrid.body.data.service;

    // Daily subscription service: Proxy Pool ($2.50/day)
    const sDaily = await request(app)
      .post("/api/services")
      .set("Authorization", `Bearer ${ownerTokenA}`)
      .send({
        name: "Dedicated Proxies",
        trackingType: "subscription",
        currency: "USD",
        subscriptionAmount: "2.50",
        billingInterval: "daily"
      });
    dailyServiceA = sDaily.body.data.service;

    // EUR currency service
    const sEur = await request(app)
      .post("/api/services")
      .set("Authorization", `Bearer ${ownerTokenA}`)
      .send({
        name: "Hetzner Cloud",
        trackingType: "subscription",
        currency: "EUR",
        subscriptionAmount: "40.00",
        billingInterval: "monthly"
      });
    eurServiceA = sEur.body.data.service;
  });

  describe("POST /api/billing/generate", () => {
    it("should generate a bill with subscription fees for subscription-only service", async () => {
      // Remove other services to test pure subscription bill
      await TrackedService.deleteMany({
        _id: { $in: [meteredServiceA.id, hybridServiceA.id, dailyServiceA.id, eurServiceA.id] }
      });

      const res = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          billingPeriodStart: "2026-03-01T00:00:00.000Z",
          billingPeriodEnd: "2026-04-01T00:00:00.000Z",
          currency: "USD"
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.isExisting, false);

      const bill = res.body.data.billingRecord;
      assert.ok(bill.id);
      assert.ok(bill.invoiceNumber.startsWith("INV-20260301-"));
      assert.equal(bill.currency, "USD");
      assert.equal(bill.subtotal, "50.00");
      assert.equal(bill.total, "50.00");
      assert.equal(bill.status, "issued");
      assert.equal(bill.lineItems.length, 1);

      const item = bill.lineItems[0];
      assert.equal(item.serviceName, "GitHub Enterprise");
      assert.equal(item.chargeType, "subscription");
      assert.equal(item.amount, "50.00");
      assert.equal(item.usageRecordCount, 0);
    });

    it("should generate a bill with daily subscription fees calculated across period duration", async () => {
      // Keep only daily service
      await TrackedService.deleteMany({
        _id: { $in: [meteredServiceA.id, subscriptionServiceA.id, hybridServiceA.id, eurServiceA.id] }
      });

      // 10-day period: 2026-03-01 to 2026-03-11: 10 days * $2.50 = $25.00
      const res = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          billingPeriodStart: "2026-03-01T00:00:00.000Z",
          billingPeriodEnd: "2026-03-11T00:00:00.000Z",
          currency: "USD"
        });

      assert.equal(res.status, 201);
      const bill = res.body.data.billingRecord;
      assert.equal(bill.subtotal, "25.00");
      assert.equal(bill.total, "25.00");
      assert.equal(bill.lineItems.length, 1);
      assert.equal(bill.lineItems[0].amount, "25.00");
    });

    it("should generate a bill with metered usage charges and reconcile usage records", async () => {
      // Keep only metered service
      await TrackedService.deleteMany({
        _id: { $in: [subscriptionServiceA.id, hybridServiceA.id, dailyServiceA.id, eurServiceA.id] }
      });

      // Ingest 2 usage records within the period
      const u1 = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          serviceId: meteredServiceA.id,
          unit: "tokens",
          quantity: "100000",
          occurredAt: "2026-03-05T12:00:00.000Z"
        });
      assert.equal(u1.status, 201);

      const u2 = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          serviceId: meteredServiceA.id,
          unit: "tokens",
          quantity: "250000",
          occurredAt: "2026-03-15T18:30:00.000Z"
        });
      assert.equal(u2.status, 201);

      // Total tokens: 350,000 * 0.00002 = $7.00
      const res = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          billingPeriodStart: "2026-03-01T00:00:00.000Z",
          billingPeriodEnd: "2026-04-01T00:00:00.000Z",
          currency: "USD"
        });

      assert.equal(res.status, 201);
      const bill = res.body.data.billingRecord;
      assert.equal(bill.subtotal, "7.00");
      assert.equal(bill.total, "7.00");
      assert.equal(bill.lineItems.length, 1);

      const item = bill.lineItems[0];
      assert.equal(item.serviceName, "OpenAI GPT-4");
      assert.equal(item.chargeType, "usage");
      assert.equal(item.quantity, "350000");
      assert.equal(item.unit, "tokens");
      assert.equal(item.unitPrice, "0.00002");
      assert.equal(item.amount, "7.00");
      assert.equal(item.usageRecordCount, 2);

      // Verify that the UsageRecords in DB now have billingRecordId and billedAt set
      const dbRecords = await UsageRecord.find({
        serviceId: meteredServiceA.id
      });
      assert.equal(dbRecords.length, 2);
      for (const rec of dbRecords) {
        assert.equal(rec.billingRecordId.toString(), bill.id.toString());
        assert.ok(rec.billedAt instanceof Date);
      }
    });

    it("should generate a bill for hybrid service with both subscription fee and usage charge", async () => {
      // Keep only hybrid service
      await TrackedService.deleteMany({
        _id: { $in: [meteredServiceA.id, subscriptionServiceA.id, dailyServiceA.id, eurServiceA.id] }
      });

      // Ingest usage: 200 host-hours @ $0.05/host-hour = $10.00
      const uRes = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          serviceId: hybridServiceA.id,
          unit: "host-hours",
          quantity: "200",
          occurredAt: "2026-03-10T10:00:00.000Z"
        });
      assert.equal(uRes.status, 201);

      // Hybrid bill: $30.00 subscription + $10.00 usage = $40.00
      const res = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          billingPeriodStart: "2026-03-01T00:00:00.000Z",
          billingPeriodEnd: "2026-04-01T00:00:00.000Z",
          currency: "USD"
        });

      assert.equal(res.status, 201);
      const bill = res.body.data.billingRecord;
      assert.equal(bill.subtotal, "40.00");
      assert.equal(bill.total, "40.00");
      assert.equal(bill.lineItems.length, 2);

      const subItem = bill.lineItems.find((i) => i.chargeType === "subscription");
      const usageItem = bill.lineItems.find((i) => i.chargeType === "usage");

      assert.ok(subItem);
      assert.equal(subItem.amount, "30.00");

      assert.ok(usageItem);
      assert.equal(usageItem.quantity, "200");
      assert.equal(usageItem.amount, "10.00");
      assert.equal(usageItem.usageRecordCount, 1);
    });

    it("should apply precise decimal arithmetic and ROUND_HALF_UP rounding", async () => {
      // Custom metered service with fractional calculation
      const fracServiceRes = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "Fractional Rate Service",
          trackingType: "metered",
          currency: "USD",
          unit: "events",
          unitPrice: "0.0035"
        });
      const fracService = fracServiceRes.body.data.service;

      // Keep only this service
      await TrackedService.deleteMany({
        _id: { $ne: fracService.id }
      });

      // 333 units * $0.0035 = 1.1655 -> ROUND_HALF_UP to 2 decimal places = $1.17
      const uRes = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          serviceId: fracService.id,
          unit: "events",
          quantity: "333",
          occurredAt: "2026-03-05T00:00:00.000Z"
        });
      assert.equal(uRes.status, 201);

      const res = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          billingPeriodStart: "2026-03-01T00:00:00.000Z",
          billingPeriodEnd: "2026-04-01T00:00:00.000Z",
          currency: "USD"
        });

      assert.equal(res.status, 201);
      const bill = res.body.data.billingRecord;
      assert.equal(bill.subtotal, "1.17");
      assert.equal(bill.total, "1.17");
      assert.equal(bill.lineItems[0].amount, "1.17");
    });

    it("should exclude usage records that fall outside the period boundaries (occurredAt < start or occurredAt >= end)", async () => {
      await TrackedService.deleteMany({
        _id: { $ne: meteredServiceA.id }
      });

      const periodStart = "2026-03-01T00:00:00.000Z";
      const periodEnd = "2026-04-01T00:00:00.000Z";

      // 1. Exactly on periodStart: INCLUDED
      const u1 = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          serviceId: meteredServiceA.id,
          unit: "tokens",
          quantity: "10000",
          occurredAt: "2026-03-01T00:00:00.000Z"
        });
      assert.equal(u1.status, 201);

      // 2. Just before periodEnd: INCLUDED
      const u2 = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          serviceId: meteredServiceA.id,
          unit: "tokens",
          quantity: "20000",
          occurredAt: "2026-03-31T23:59:59.999Z"
        });
      assert.equal(u2.status, 201);

      // 3. Exactly on periodEnd: EXCLUDED (exclusive upper bound)
      const u3 = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          serviceId: meteredServiceA.id,
          unit: "tokens",
          quantity: "50000",
          occurredAt: "2026-04-01T00:00:00.000Z"
        });
      assert.equal(u3.status, 201);

      // 4. Before periodStart: EXCLUDED
      const u4 = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          serviceId: meteredServiceA.id,
          unit: "tokens",
          quantity: "80000",
          occurredAt: "2026-02-28T23:59:59.000Z"
        });
      assert.equal(u4.status, 201);

      const res = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          billingPeriodStart: periodStart,
          billingPeriodEnd: periodEnd,
          currency: "USD"
        });

      assert.equal(res.status, 201);
      const bill = res.body.data.billingRecord;
      // Included: 10,000 + 20,000 = 30,000 * 0.00002 = $0.60
      assert.equal(bill.lineItems[0].quantity, "30000");
      assert.equal(bill.lineItems[0].amount, "0.60");
      assert.equal(bill.lineItems[0].usageRecordCount, 2);

      // Verify excluded records remain unbilled
      const unbilled = await UsageRecord.find({
        serviceId: meteredServiceA.id,
        billingRecordId: null
      });
      assert.equal(unbilled.length, 2);
    });

    it("should handle empty billing periods with 0.00 total and empty lineItems", async () => {
      // Clear all services
      await TrackedService.deleteMany({});

      const res = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          billingPeriodStart: "2026-05-01T00:00:00.000Z",
          billingPeriodEnd: "2026-06-01T00:00:00.000Z",
          currency: "USD"
        });

      assert.equal(res.status, 201);
      const bill = res.body.data.billingRecord;
      assert.equal(bill.subtotal, "0.00");
      assert.equal(bill.total, "0.00");
      assert.deepEqual(bill.lineItems, []);
    });

    it("should exclude subscription fee for service archived prior to billing period, but still bill past usage", async () => {
      // Create a service, ingest usage, then archive it before the billing period start
      const sTemp = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          name: "Decommissioned Service",
          trackingType: "hybrid",
          currency: "USD",
          unit: "runs",
          unitPrice: "1.00",
          subscriptionAmount: "100.00",
          billingInterval: "monthly"
        });
      const tempId = sTemp.body.data.service.id;

      // Ingest usage inside the target billing period (March 2026)
      const uRes = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          serviceId: tempId,
          unit: "runs",
          quantity: "5",
          occurredAt: "2026-03-02T12:00:00.000Z"
        });
      assert.equal(uRes.status, 201);

      // Archive the service and set updatedAt to February 2026 (prior to March 1)
      await TrackedService.updateOne(
        { _id: tempId },
        {
          $set: {
            status: "archived",
            updatedAt: new Date("2026-02-25T00:00:00.000Z")
          }
        },
        { timestamps: false }
      );

      // Keep only this service
      await TrackedService.deleteMany({ _id: { $ne: tempId } });

      const res = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          billingPeriodStart: "2026-03-01T00:00:00.000Z",
          billingPeriodEnd: "2026-04-01T00:00:00.000Z",
          currency: "USD"
        });

      assert.equal(res.status, 201);
      const bill = res.body.data.billingRecord;

      // Subscription fee of $100.00 was excluded because service was archived prior to March 1
      // Only the usage charge of 5 runs * $1.00 = $5.00 is billed
      assert.equal(bill.subtotal, "5.00");
      assert.equal(bill.total, "5.00");
      assert.equal(bill.lineItems.length, 1);
      assert.equal(bill.lineItems[0].chargeType, "usage");
      assert.equal(bill.lineItems[0].amount, "5.00");
    });

    it("should isolate billing by currency (USD vs EUR)", async () => {
      // Ingest USD usage
      const uRes = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          serviceId: meteredServiceA.id,
          unit: "tokens",
          quantity: "100000",
          occurredAt: "2026-03-10T12:00:00.000Z"
        });
      assert.equal(uRes.status, 201);

      // Generate USD bill
      const resUsd = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          billingPeriodStart: "2026-03-01T00:00:00.000Z",
          billingPeriodEnd: "2026-04-01T00:00:00.000Z",
          currency: "USD"
        });

      assert.equal(resUsd.status, 201);
      assert.equal(resUsd.body.data.billingRecord.currency, "USD");
      // EUR service (Hetzner Cloud) must NOT appear in USD bill
      const eurLine = resUsd.body.data.billingRecord.lineItems.find((i) => i.serviceName === "Hetzner Cloud");
      assert.equal(eurLine, undefined);

      // Generate EUR bill for the same period
      const resEur = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          billingPeriodStart: "2026-03-01T00:00:00.000Z",
          billingPeriodEnd: "2026-04-01T00:00:00.000Z",
          currency: "EUR"
        });

      assert.equal(resEur.status, 201);
      assert.equal(resEur.body.data.billingRecord.currency, "EUR");
      assert.equal(resEur.body.data.billingRecord.subtotal, "40.00");
      assert.equal(resEur.body.data.billingRecord.lineItems.length, 1);
      assert.equal(resEur.body.data.billingRecord.lineItems[0].serviceName, "Hetzner Cloud");
    });

    it("should return HTTP 200 with isExisting: true on repeated generation for the same period (idempotent)", async () => {
      const payload = {
        billingPeriodStart: "2026-03-01T00:00:00.000Z",
        billingPeriodEnd: "2026-04-01T00:00:00.000Z",
        currency: "USD"
      };

      // 1st call: Creates bill (201 Created)
      const res1 = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send(payload);

      assert.equal(res1.status, 201);
      assert.equal(res1.body.data.isExisting, false);
      const billId1 = res1.body.data.billingRecord.id;

      // 2nd call: Idempotent replay (200 OK)
      const res2 = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send(payload);

      assert.equal(res2.status, 200);
      assert.equal(res2.body.data.isExisting, true);
      assert.equal(res2.body.data.billingRecord.id, billId1);
      assert.equal(res2.body.data.billingRecord.invoiceNumber, res1.body.data.billingRecord.invoiceNumber);

      // DB should contain exactly 1 BillingRecord for Tenant A
      const count = await BillingRecord.countDocuments({ tenantId: tenantAId, currency: "USD" });
      assert.equal(count, 1);
    });

    it("should safely handle concurrent billing generation without duplicate records or 500 errors", async () => {
      const payload = {
        billingPeriodStart: "2026-03-01T00:00:00.000Z",
        billingPeriodEnd: "2026-04-01T00:00:00.000Z",
        currency: "USD"
      };

      const [res1, res2] = await Promise.all([
        request(app)
          .post("/api/billing/generate")
          .set("Authorization", `Bearer ${ownerTokenA}`)
          .send(payload),
        request(app)
          .post("/api/billing/generate")
          .set("Authorization", `Bearer ${ownerTokenA}`)
          .send(payload)
      ]);

      assert.ok([200, 201].includes(res1.status));
      assert.ok([200, 201].includes(res2.status));
      assert.equal(res1.body.success, true);
      assert.equal(res2.body.success, true);

      // Both must refer to the exact same billing record ID
      assert.equal(res1.body.data.billingRecord.id, res2.body.data.billingRecord.id);

      const count = await BillingRecord.countDocuments({ tenantId: tenantAId, currency: "USD" });
      assert.equal(count, 1);
    });

    it("should not double-bill reconciled usage in a subsequent billing period", async () => {
      await TrackedService.deleteMany({ _id: { $ne: meteredServiceA.id } });

      // Period 1 usage: March
      const u1 = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          serviceId: meteredServiceA.id,
          unit: "tokens",
          quantity: "50000",
          occurredAt: "2026-03-10T12:00:00.000Z"
        });
      assert.equal(u1.status, 201);

      // Bill 1: March
      const bill1Res = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          billingPeriodStart: "2026-03-01T00:00:00.000Z",
          billingPeriodEnd: "2026-04-01T00:00:00.000Z",
          currency: "USD"
        });
      assert.equal(bill1Res.status, 201);
      assert.equal(bill1Res.body.data.billingRecord.lineItems[0].quantity, "50000");

      // Period 2 usage: April
      const u2 = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          serviceId: meteredServiceA.id,
          unit: "tokens",
          quantity: "80000",
          occurredAt: "2026-04-10T12:00:00.000Z"
        });
      assert.equal(u2.status, 201);

      // Bill 2: April
      const bill2Res = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          billingPeriodStart: "2026-04-01T00:00:00.000Z",
          billingPeriodEnd: "2026-05-01T00:00:00.000Z",
          currency: "USD"
        });
      assert.equal(bill2Res.status, 201);
      // Bill 2 must ONLY have 80,000 tokens (not 130,000)
      assert.equal(bill2Res.body.data.billingRecord.lineItems[0].quantity, "80000");
      assert.equal(bill2Res.body.data.billingRecord.lineItems[0].amount, "1.60");
    });

    it("should reject billing generation with missing or invalid dates (400)", async () => {
      // Missing start
      const r1 = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({ billingPeriodEnd: "2026-04-01T00:00:00.000Z" });
      assert.equal(r1.status, 400);

      // Malformed start
      const r2 = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          billingPeriodStart: "not-a-date",
          billingPeriodEnd: "2026-04-01T00:00:00.000Z"
        });
      assert.equal(r2.status, 400);

      // startDate >= endDate
      const r3 = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          billingPeriodStart: "2026-04-01T00:00:00.000Z",
          billingPeriodEnd: "2026-03-01T00:00:00.000Z"
        });
      assert.equal(r3.status, 400);
      assert.match(r3.body.message, /must be before/i);
    });

    it("should reject billing generation with invalid currency code (400)", async () => {
      const res = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          billingPeriodStart: "2026-03-01T00:00:00.000Z",
          billingPeriodEnd: "2026-04-01T00:00:00.000Z",
          currency: "TOOLONG"
        });
      assert.equal(res.status, 400);
      assert.match(res.body.message, /3-letter ISO code/i);
    });

    it("should reject non-admin/non-owner member from generating bills (403)", async () => {
      const res = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${memberTokenA}`)
        .send({
          billingPeriodStart: "2026-03-01T00:00:00.000Z",
          billingPeriodEnd: "2026-04-01T00:00:00.000Z"
        });

      assert.equal(res.status, 403);
      assert.match(res.body.message, /requires one of the following roles/i);
    });

    it("should reject unauthenticated request with 401", async () => {
      const res = await request(app)
        .post("/api/billing/generate")
        .send({
          billingPeriodStart: "2026-03-01T00:00:00.000Z",
          billingPeriodEnd: "2026-04-01T00:00:00.000Z"
        });
      assert.equal(res.status, 401);
    });
  });

  describe("GET /api/billing", () => {
    beforeEach(async () => {
      // Generate 2 bills for Tenant A
      await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          billingPeriodStart: "2026-01-01T00:00:00.000Z",
          billingPeriodEnd: "2026-02-01T00:00:00.000Z",
          currency: "USD"
        });

      await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          billingPeriodStart: "2026-02-01T00:00:00.000Z",
          billingPeriodEnd: "2026-03-01T00:00:00.000Z",
          currency: "USD"
        });
    });

    it("should list billing records for the active workspace with pagination", async () => {
      const res = await request(app)
        .get("/api/billing?page=1&limit=10")
        .set("Authorization", `Bearer ${ownerTokenA}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.billingRecords.length, 2);
      assert.equal(res.body.data.pagination.total, 2);
      assert.equal(res.body.data.pagination.page, 1);
    });

    it("should allow regular members to view workspace billing records", async () => {
      const res = await request(app)
        .get("/api/billing")
        .set("Authorization", `Bearer ${memberTokenA}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.billingRecords.length, 2);
    });

    it("should filter billing records by status and date range", async () => {
      const res = await request(app)
        .get("/api/billing?status=issued&startDate=2026-02-01T00:00:00.000Z")
        .set("Authorization", `Bearer ${ownerTokenA}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.billingRecords.length, 1);
      assert.equal(
        new Date(res.body.data.billingRecords[0].billingPeriodStart).toISOString(),
        "2026-02-01T00:00:00.000Z"
      );
    });

    it("should enforce workspace isolation (Tenant B cannot see Tenant A's billing records)", async () => {
      const res = await request(app)
        .get("/api/billing")
        .set("Authorization", `Bearer ${ownerTokenB}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.billingRecords.length, 0);
      assert.equal(res.body.data.pagination.total, 0);
    });
  });

  describe("GET /api/billing/:id and GET /api/billing/:id/usage", () => {
    let billAId;

    beforeEach(async () => {
      // Ingest usage for Tenant A
      const uRes = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          serviceId: meteredServiceA.id,
          unit: "tokens",
          quantity: "50000",
          occurredAt: "2026-03-05T12:00:00.000Z"
        });
      assert.equal(uRes.status, 201);

      // Generate Bill for Tenant A
      const genRes = await request(app)
        .post("/api/billing/generate")
        .set("Authorization", `Bearer ${ownerTokenA}`)
        .send({
          billingPeriodStart: "2026-03-01T00:00:00.000Z",
          billingPeriodEnd: "2026-04-01T00:00:00.000Z",
          currency: "USD"
        });

      billAId = genRes.body.data.billingRecord.id;
    });

    it("should retrieve a billing record by ID with full line items", async () => {
      const res = await request(app)
        .get(`/api/billing/${billAId}`)
        .set("Authorization", `Bearer ${ownerTokenA}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.billingRecord.id, billAId);
      assert.ok(res.body.data.billingRecord.lineItems.length > 0);
    });

    it("should retrieve all reconciled usage records for a specific billing record", async () => {
      const res = await request(app)
        .get(`/api/billing/${billAId}/usage`)
        .set("Authorization", `Bearer ${ownerTokenA}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.billingRecordId, billAId);
      assert.equal(res.body.data.count, 1);
      assert.equal(res.body.data.usageRecords.length, 1);
      assert.equal(res.body.data.usageRecords[0].quantity, "50000");
      assert.equal(res.body.data.usageRecords[0].serviceName, "OpenAI GPT-4");
      assert.ok(res.body.data.usageRecords[0].billedAt);
    });

    it("should return 400 for malformed ObjectId", async () => {
      const res = await request(app)
        .get("/api/billing/invalid-id")
        .set("Authorization", `Bearer ${ownerTokenA}`);
      assert.equal(res.status, 400);
    });

    it("should return 404 for nonexistent valid ObjectId", async () => {
      const fakeId = "507f1f77bcf86cd799439011";
      const res = await request(app)
        .get(`/api/billing/${fakeId}`)
        .set("Authorization", `Bearer ${ownerTokenA}`);
      assert.equal(res.status, 404);
    });

    it("should enforce workspace isolation on GET /api/billing/:id (Tenant B receives 404)", async () => {
      const res = await request(app)
        .get(`/api/billing/${billAId}`)
        .set("Authorization", `Bearer ${ownerTokenB}`);
      assert.equal(res.status, 404);
    });

    it("should enforce workspace isolation on GET /api/billing/:id/usage (Tenant B receives 404)", async () => {
      const res = await request(app)
        .get(`/api/billing/${billAId}/usage`)
        .set("Authorization", `Bearer ${ownerTokenB}`);
      assert.equal(res.status, 404);
    });
  });
});
