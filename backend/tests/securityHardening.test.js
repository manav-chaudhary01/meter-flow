import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import TrackedService from "../src/models/TrackedService.js";
import UsageRecord from "../src/models/UsageRecord.js";
import Budget from "../src/models/Budget.js";

describe("Application Security, CSP, Input Validation & Error Sanitization Audit", () => {
  let authToken;
  let tenantId;
  let userId;
  let testServiceId;

  before(async () => {
    await connectTestDb();
  });

  after(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();

    // Register test user & tenant
    const regRes = await request(app).post("/api/auth/register").send({
      name: "Security Auditor",
      email: "auditor@meterflow.test",
      password: "StrongPassword123!",
      organizationName: "Security Org"
    });

    assert.equal(regRes.status, 201);
    authToken = regRes.body.data.token;
    tenantId = regRes.body.data.tenant.id;
    userId = regRes.body.data.user.id;

    // Create a tracked service for tests
    const svcRes = await request(app)
      .post("/api/services")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        name: "Security LLM Engine",
        provider: "Anthropic",
        category: "ai",
        trackingType: "metered",
        currency: "USD",
        unit: "tokens",
        unitPrice: "0.000015"
      });

    assert.equal(svcRes.status, 201);
    testServiceId = svcRes.body.data.service.id;
  });

  describe("1. HTTP Security Headers & Content Security Policy (CSP)", () => {
    it("should send strict Content-Security-Policy headers denying unsafe scripts and framing", async () => {
      const res = await request(app).get("/api/health");
      assert.equal(res.status, 200);

      const csp = res.headers["content-security-policy"];
      assert.ok(csp, "Content-Security-Policy header must be present");
      assert.match(csp, /default-src\s+'self'/);
      assert.match(csp, /script-src\s+'self'/);
      assert.match(csp, /script-src-attr\s+'none'/);
      assert.match(csp, /object-src\s+'none'/);
      assert.match(csp, /base-uri\s+'self'/);
      assert.match(csp, /frame-ancestors\s+'none'/);
    });

    it("should enforce anti-clickjacking and MIME type protection headers", async () => {
      const res = await request(app).get("/");
      assert.equal(res.status, 200);

      assert.equal(res.headers["x-frame-options"], "DENY");
      assert.equal(res.headers["x-content-type-options"], "nosniff");
      assert.ok(res.headers["referrer-policy"], "Referrer-Policy header must be present");
    });
  });

  describe("2. Request Body Parser Limit & Syntax Error Sanitization", () => {
    it("should reject malformed JSON body with HTTP 400 and clean JSON error message", async () => {
      const res = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${authToken}`)
        .set("Content-Type", "application/json")
        .send('{"name": "Bad JSON", "price": }');

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /Malformed JSON payload/i);
      // Ensure no raw stack trace or server internals leaked
      assert.equal(res.body.stack, undefined);
    });

    it("should reject oversized JSON payloads (> 500kb) with HTTP 413", async () => {
      // Create a payload larger than 500kb
      const hugeString = "A".repeat(600 * 1024);
      const res = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          name: "Oversized Service",
          category: hugeString
        });

      assert.equal(res.status, 413);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /Payload too large/i);
    });
  });

  describe("3. Query Parameter Pollution & Operator Injection Immunity", () => {
    it("should reject query operator injection in service category filter with 400", async () => {
      // ?category[$ne]=null would cause MongoDB query injection or TypeError crash
      const res = await request(app)
        .get("/api/services?category[$ne]=null")
        .set("Authorization", `Bearer ${authToken}`);

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /Invalid query parameter|Invalid category filter/i);
    });

    it("should reject query operator injection in service status filter with 400", async () => {
      const res = await request(app)
        .get("/api/services?status[$ne]=active")
        .set("Authorization", `Bearer ${authToken}`);

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /Invalid query parameter|Status filter must be/i);
    });

    it("should reject query operator injection in billing status filter with 400", async () => {
      const res = await request(app)
        .get("/api/billing?status[$ne]=draft")
        .set("Authorization", `Bearer ${authToken}`);

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /Invalid query parameter|Invalid status filter/i);
    });

    it("should reject query operator injection in budgets status and currency filters with 400", async () => {
      const resStatus = await request(app)
        .get("/api/budgets?status[$gt]=")
        .set("Authorization", `Bearer ${authToken}`);

      assert.equal(resStatus.status, 400);
      assert.equal(resStatus.body.success, false);
      assert.match(resStatus.body.message, /Invalid query parameter|Invalid status filter/i);

      const resCurr = await request(app)
        .get("/api/budgets?currency[$ne]=USD")
        .set("Authorization", `Bearer ${authToken}`);

      assert.equal(resCurr.status, 400);
      assert.equal(resCurr.body.success, false);
      assert.match(resCurr.body.message, /Invalid query parameter|Invalid currency filter/i);
    });

    it("should reject query operator injection in budget alerts status filter with 400", async () => {
      const res = await request(app)
        .get("/api/budgets/alerts?status[$ne]=pending")
        .set("Authorization", `Bearer ${authToken}`);

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /Invalid query parameter|Invalid status filter/i);
    });

    it("should reject query operator injection in usage history serviceId filter with 400", async () => {
      const res = await request(app)
        .get("/api/usage?serviceId[$ne]=null")
        .set("Authorization", `Bearer ${authToken}`);

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /Invalid query parameter|Invalid serviceId parameter/i);
    });

    it("should reject invalid groupBy query in usage summary with 400", async () => {
      const resOp = await request(app)
        .get("/api/usage/summary?groupBy[$ne]=service")
        .set("Authorization", `Bearer ${authToken}`);

      assert.equal(resOp.status, 400);
      assert.equal(resOp.body.success, false);
      assert.match(resOp.body.message, /Invalid query parameter|groupBy must be/i);

      const resInvalid = await request(app)
        .get("/api/usage/summary?groupBy=unsupported_dimension")
        .set("Authorization", `Bearer ${authToken}`);

      assert.equal(resInvalid.status, 400);
      assert.equal(resInvalid.body.success, false);
      assert.match(resInvalid.body.message, /groupBy must be/i);
    });

    it("should reject HTTP parameter pollution with repeated query parameters", async () => {
      const res = await request(app)
        .get("/api/services?status=active&status=archived")
        .set("Authorization", `Bearer ${authToken}`);

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /Parameter pollution detected/i);
    });
  });

  describe("4. Prototype Pollution Defenses & Usage Metadata Hardening", () => {
    it("should reject prototype pollution attempts via __proto__ in metadata with 400", async () => {
      const res = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          serviceId: testServiceId,
          quantity: "100",
          unit: "tokens",
          metadata: JSON.parse('{"__proto__": {"isAdmin": true}, "client": "bot"}')
        });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /Prohibited metadata key/i);

      // Verify node process global Object prototype was not polluted
      const cleanObj = {};
      assert.equal(cleanObj.isAdmin, undefined);
    });

    it("should reject prototype pollution attempts via constructor.prototype in metadata with 400", async () => {
      const res = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          serviceId: testServiceId,
          quantity: "100",
          unit: "tokens",
          metadata: {
            constructor: {
              prototype: {
                hacked: true
              }
            }
          }
        });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /Prohibited metadata key/i);

      const cleanObj = {};
      assert.equal(cleanObj.hacked, undefined);
    });

    it("should reject MongoDB query operators in metadata keys ($where, $regex) with 400", async () => {
      const res = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          serviceId: testServiceId,
          quantity: "100",
          unit: "tokens",
          metadata: {
            $where: "sleep(5000)"
          }
        });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /Prohibited metadata key/i);
    });

    it("should reject metadata payloads with excessive nesting depth (> 5 levels) with 400", async () => {
      const deepMetadata = {
        l1: { l2: { l3: { l4: { l5: { l6: "too deep" } } } } }
      };

      const res = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          serviceId: testServiceId,
          quantity: "100",
          unit: "tokens",
          metadata: deepMetadata
        });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /nesting depth/i);
    });
  });

  describe("5. Static Asset Defenses & Path Traversal Immunity", () => {
    it("should block directory traversal requests targeting server files or .env", async () => {
      const paths = [
        "/..%2F.env",
        "/%2e%2e/.env",
        "/..%2fpackage.json",
        "/backend/src/app.js",
        "/.env",
        "/.git/config"
      ];

      for (const p of paths) {
        const res = await request(app).get(p);
        assert.ok([403, 404].includes(res.status), `Path ${p} should return 403 or 404, got ${res.status}`);
        assert.doesNotMatch(res.text, /JWT_SECRET/, `Path ${p} must never expose JWT_SECRET`);
        assert.doesNotMatch(res.text, /mongoose\.connect/, `Path ${p} must never expose database connect source`);
      }
    });
  });

  describe("6. XSS Adversarial String Storage & Injection Neutralization", () => {
    it("should safely store XSS strings verbatim without executing or breaking JSON responses", async () => {
      const xssServiceName = "<script>alert('XSS-SERVICE')</script>";
      const xssCategory = "\"><img src=x onerror=alert('XSS-CAT')>";

      const createRes = await request(app)
        .post("/api/services")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          name: xssServiceName,
          category: xssCategory,
          trackingType: "metered",
          unit: "calls",
          unitPrice: "0.05"
        });

      assert.equal(createRes.status, 201);
      assert.equal(createRes.body.data.service.name, xssServiceName);
      assert.equal(createRes.body.data.service.category, xssCategory);

      // Verify retrieval returns verbatim text safely encoded in JSON
      const listRes = await request(app)
        .get("/api/services")
        .set("Authorization", `Bearer ${authToken}`);

      assert.equal(listRes.status, 200);
      const found = listRes.body.data.services.find((s) => s.name === xssServiceName);
      assert.ok(found, "XSS string must be preserved verbatim in data payload");
    });

    it("should safely handle XSS strings in budget creation and alert evaluation", async () => {
      const xssBudgetName = "<svg/onload=alert('XSS-BUDGET')>";
      const createRes = await request(app)
        .post("/api/budgets")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          name: xssBudgetName,
          amount: "500.00",
          currency: "USD",
          periodType: "monthly",
          startDate: "2026-11-01T00:00:00.000Z",
          endDate: "2026-11-30T23:59:59.999Z"
        });

      assert.equal(createRes.status, 201);
      assert.equal(createRes.body.data.budget.name, xssBudgetName);

      const getRes = await request(app)
        .get(`/api/budgets/${createRes.body.data.budget.id}`)
        .set("Authorization", `Bearer ${authToken}`);

      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.data.budget.name, xssBudgetName);
    });

    it("should safely handle adversarial strings in usage ingestion source and idempotency keys", async () => {
      const xssSource = "<script>console.log('xss-source')</script>";
      const res = await request(app)
        .post("/api/usage")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          serviceId: testServiceId,
          quantity: "25",
          unit: "tokens",
          source: xssSource,
          idempotencyKey: "evt-<script>-123"
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.data.record.source, xssSource);
      assert.equal(res.body.data.record.idempotencyKey, "evt-<script>-123");
    });
  });

  describe("7. Production Error Message Sanitization", () => {
    it("should sanitize 500 error messages when NODE_ENV is production", async () => {
      const originalEnv = process.env.NODE_ENV;
      const originalConsoleError = console.error;
      process.env.NODE_ENV = "production";
      console.error = () => {}; // suppress intentional simulated test error output

      try {
        const { errorHandler } = await import("../src/app.js");
        let responseStatus = null;
        let responseJson = null;

        const mockReq = { method: "GET", originalUrl: "/api/test" };
        const mockRes = {
          status(code) {
            responseStatus = code;
            return this;
          },
          json(payload) {
            responseJson = payload;
            return this;
          }
        };

        const internalError = new Error("Database password leaked in trace: secret_pass_123");
        internalError.status = 500;

        errorHandler(internalError, mockReq, mockRes, () => {});

        assert.equal(responseStatus, 500);
        assert.equal(responseJson.success, false);
        assert.equal(responseJson.message, "Internal server error");
        assert.doesNotMatch(JSON.stringify(responseJson), /secret_pass_123/);
      } finally {
        process.env.NODE_ENV = originalEnv;
        console.error = originalConsoleError;
      }
    });
  });
});
