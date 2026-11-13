import { describe, it } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import request from "supertest";
import app from "../src/app.js";

describe("Frontend Static Serving & Security Boundaries", () => {
  it("GET / should serve the dashboard index.html with 200 OK", async () => {
    const res = await request(app).get("/");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.text, /Dashboard — MeterFlow/);
    assert.match(res.text, /id="workspace-select"/);
  });

  it("GET /login should serve login.html with 200 OK", async () => {
    const res = await request(app).get("/login");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.text, /Sign In — MeterFlow/);
    assert.match(res.text, /id="login-form"/);
  });

  it("GET /register should serve register.html with 200 OK", async () => {
    const res = await request(app).get("/register");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.text, /Create Workspace — MeterFlow/);
    assert.match(res.text, /id="register-form"/);
  });

  it("GET /css/styles.css should serve the stylesheet with text/css content-type", async () => {
    const res = await request(app).get("/css/styles.css");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/css/);
    assert.match(res.text, /--color-primary/);
  });

  it("GET /js/api.js should serve the API client module with application/javascript", async () => {
    const res = await request(app).get("/js/api.js");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /javascript/);
    assert.match(res.text, /MeterFlowAPI/);
  });

  it("GET /js/auth.js should serve the auth module with application/javascript", async () => {
    const res = await request(app).get("/js/auth.js");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /javascript/);
    assert.match(res.text, /MeterFlowAuth/);
  });

  it("GET /js/dashboard.js should serve the dashboard controller with application/javascript", async () => {
    const res = await request(app).get("/js/dashboard.js");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /javascript/);
    assert.match(res.text, /initDashboard/);
  });

  it("GET /services should serve services.html with 200 OK and CRUD modals", async () => {
    const res = await request(app).get("/services");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.text, /Tracked Services — MeterFlow/);
    assert.match(res.text, /id="services-table-body"/);
    assert.match(res.text, /id="create-service-form"/);
    assert.match(res.text, /id="edit-service-form"/);
    assert.match(res.text, /id="edit-tracking-type"[^>]*disabled/);
    assert.match(res.text, /id="archive-modal"/);
    assert.match(res.text, /id="archive-confirm-btn"/);
  });

  it("GET /js/services.js should serve the services controller with safe DOM & valid CRUD helpers", async () => {
    const res = await request(app).get("/js/services.js");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /javascript/);
    assert.match(res.text, /initServicesPage/);
    assert.match(res.text, /renderServicesTable/);
    assert.match(res.text, /openEditModal/);
    assert.match(res.text, /openArchiveModal/);
    assert.doesNotMatch(res.text, /\.innerHTML\s*=/);
    assert.doesNotMatch(res.text, /\bwindow\.confirm\s*\(/);
    assert.doesNotMatch(res.text, /\bwindow\.alert\s*\(/);

    // Execute served frontend controller in isolated VM context to test pure CRUD helpers directly
    const sandbox = { window: {} };
    vm.runInNewContext(res.text, sandbox);
    const helpers = sandbox.window.MeterFlowServices;
    assert.ok(helpers, "MeterFlowServices helpers should be exposed");

    assert.equal(helpers.canManageWorkspace("owner"), true);
    assert.equal(helpers.canManageWorkspace("admin"), true);
    assert.equal(helpers.canManageWorkspace("member"), false);

    // Client-side validation checks matching backend rules
    const missingName = helpers.validateServiceForm("create", {
      name: " ",
      trackingType: "metered",
      currency: "USD",
      unit: "requests",
      unitPrice: "0.01"
    });
    assert.match(missingName.error, /Service name is required/);

    const badCurrency = helpers.validateServiceForm("create", {
      name: "Vector DB",
      trackingType: "metered",
      currency: "U1",
      unit: "GB",
      unitPrice: "0.10"
    });
    assert.match(badCurrency.error, /3-letter ISO code/);

    const badPrice = helpers.validateServiceForm("create", {
      name: "Vector DB",
      trackingType: "metered",
      currency: "USD",
      unit: "GB",
      unitPrice: "-0.5"
    });
    assert.match(badPrice.error, /non-negative/);

    const nonNumericPrice = helpers.validateServiceForm("create", {
      name: "Vector DB",
      trackingType: "metered",
      currency: "USD",
      unit: "GB",
      unitPrice: "abc"
    });
    assert.match(nonNumericPrice.error, /valid numeric decimal/);

    const validHybrid = helpers.validateServiceForm("create", {
      name: "Managed Postgres",
      trackingType: "hybrid",
      currency: "eur",
      unit: "GB-hours",
      unitPrice: "0.00025",
      subscriptionAmount: "0",
      billingInterval: "monthly"
    });
    assert.equal(validHybrid.valid, true);

    const meteredPayload = helpers.buildServicePayload("create", {
      name: " Inference API ",
      provider: " OpenAI ",
      category: "",
      trackingType: "metered",
      currency: "usd",
      unit: " 1k-tokens ",
      unitPrice: "0.0300",
      subscriptionAmount: "99.00",
      billingInterval: "monthly"
    });
    assert.equal(meteredPayload.name, "Inference API");
    assert.equal(meteredPayload.category, "general");
    assert.equal(meteredPayload.currency, "USD");
    assert.equal(meteredPayload.unit, "1k-tokens");
    assert.equal(meteredPayload.unitPrice, "0.0300");
    assert.equal("subscriptionAmount" in meteredPayload, false);
    assert.equal("billingInterval" in meteredPayload, false);

    const editPayload = helpers.buildServicePayload(
      "edit",
      {
        name: "Updated API",
        provider: "Anthropic",
        category: "ai",
        currency: "usd",
        status: "active",
        unit: "tokens",
        unitPrice: "0"
      },
      "metered"
    );
    assert.equal("trackingType" in editPayload, false);
    assert.equal(editPayload.status, "active");
    assert.equal(editPayload.unitPrice, "0");

    assert.equal(
      helpers.formatPricingRate({
        trackingType: "metered",
        currency: "USD",
        unitPrice: "0",
        unit: "requests"
      }),
      "USD 0 / requests"
    );
  });

  it("GET /usage should serve usage.html with 200 OK, metric cards, and modals", async () => {
    const res = await request(app).get("/usage");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.text, /Usage Ingestion & History — MeterFlow/);
    assert.match(res.text, /id="ingest-usage-form"/);
    assert.match(res.text, /id="usage-table-body"/);
    assert.match(res.text, /id="metric-total-events"/);
    assert.match(res.text, /id="metric-aggregate-volume"/);
    assert.match(res.text, /id="metric-distinct-services"/);
    assert.match(res.text, /id="filter-service"/);
    assert.match(res.text, /id="filter-start-date"/);
    assert.match(res.text, /id="filter-end-date"/);
    assert.match(res.text, /id="ingest-idempotency-key"/);
    assert.match(res.text, /id="generate-key-btn"/);
    assert.match(res.text, /id="metadata-modal"/);
  });

  it("GET /js/usage.js should serve the usage controller with safe DOM & valid ingestion helpers", async () => {
    const res = await request(app).get("/js/usage.js");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /javascript/);
    assert.match(res.text, /initUsagePage/);
    assert.match(res.text, /renderUsageTable/);
    assert.match(res.text, /loadUsageSummary/);
    assert.match(res.text, /buildIngestPayload/);
    assert.doesNotMatch(res.text, /\.innerHTML\s*=/);

    // Run in isolated VM to verify pure validation and payload helpers
    const sandbox = { window: {} };
    vm.runInNewContext(res.text, sandbox);
    const helpers = sandbox.window.MeterFlowUsage;
    assert.ok(helpers, "MeterFlowUsage helpers should be exposed on window");

    // 1. Quantity validation
    assert.match(helpers.validateQuantity("").error, /Quantity is required/);
    assert.match(helpers.validateQuantity("-5").error, /non-negative/);
    assert.match(helpers.validateQuantity("abc").error, /valid numeric decimal/);
    assert.equal(helpers.validateQuantity("0").value, "0");
    assert.equal(helpers.validateQuantity("1500.50").value, "1500.50");

    // 2. Metadata validation
    assert.equal(helpers.validateMetadata("").value, null);
    assert.equal(helpers.validateMetadata("   ").value, null);
    const parsedMeta = helpers.validateMetadata('{"endpoint": "/chat", "model": "gemini"}').value;
    assert.equal(parsedMeta.endpoint, "/chat");
    assert.equal(parsedMeta.model, "gemini");
    assert.match(helpers.validateMetadata('["not", "an", "object"]').error, /key-value JSON object/);
    assert.match(helpers.validateMetadata('{bad json').error, /Invalid JSON format/);

    // 3. Form validation
    const testMeteredService = {
      id: "673f91000000000000000001",
      name: "Claude Tokens",
      trackingType: "metered",
      unit: "tokens",
      status: "active"
    };

    const testSubService = {
      id: "673f91000000000000000002",
      name: "GitHub Copilot",
      trackingType: "subscription",
      status: "active"
    };

    const testArchivedService = {
      id: "673f91000000000000000003",
      name: "Old Search API",
      trackingType: "metered",
      unit: "queries",
      status: "archived"
    };

    assert.match(
      helpers.validateIngestForm({ serviceId: "" }, null).error,
      /select a tracked service/
    );

    assert.match(
      helpers.validateIngestForm({ serviceId: testArchivedService.id }, testArchivedService).error,
      /archived service/
    );

    assert.match(
      helpers.validateIngestForm({ serviceId: testSubService.id }, testSubService).error,
      /subscription-only/
    );

    assert.match(
      helpers.validateIngestForm(
        { serviceId: testMeteredService.id, quantity: "100", unit: "megabytes" },
        testMeteredService
      ).error,
      /Unit mismatch/
    );

    const validCheck = helpers.validateIngestForm(
      {
        serviceId: testMeteredService.id,
        quantity: "5000",
        unit: "tokens",
        source: "backend-worker",
        idempotencyKey: "evt-test-123",
        metadata: '{"model": "opus"}'
      },
      testMeteredService
    );
    assert.equal(validCheck.valid, true);

    // 4. Payload builder
    const payload = helpers.buildIngestPayload(
      {
        serviceId: testMeteredService.id,
        quantity: " 5000 ",
        unit: "tokens",
        source: "api-agent",
        occurredAt: "2026-10-30T10:00:00.000Z",
        idempotencyKey: " key-123 ",
        externalEventId: " ext-987 ",
        metadata: '{"cost": 0.05}'
      },
      testMeteredService
    );
    assert.equal(payload.serviceId, testMeteredService.id);
    assert.equal(payload.quantity, "5000");
    assert.equal(payload.unit, "tokens");
    assert.equal(payload.source, "api-agent");
    assert.equal(payload.idempotencyKey, "key-123");
    assert.equal(payload.externalEventId, "ext-987");
    assert.equal(payload.metadata.cost, 0.05);

    // 5. Date filter range parser
    const badRange = helpers.parseDateFilterRange("2026-10-20", "2026-10-10");
    assert.match(badRange.error, /cannot be after/);

    const validRange = helpers.parseDateFilterRange("2026-10-01", "2026-10-15");
    assert.ok(validRange.startDateISO.startsWith("2026-10-01"));
    assert.ok(validRange.endDateISO.startsWith("2026-10-15T23:59:59"));
  });

  it("GET /billing should serve billing.html with 200 OK, metric cards, and modals", async () => {
    const res = await request(app).get("/billing");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.text, /Invoices & Billing — MeterFlow/);
    assert.match(res.text, /id="billing-table-body"/);
    assert.match(res.text, /id="generate-bill-form"/);
    assert.match(res.text, /id="metric-invoice-count"/);
    assert.match(res.text, /id="metric-total-invoiced"/);
    assert.match(res.text, /id="metric-billing-currency"/);
    assert.match(res.text, /id="generate-modal"/);
    assert.match(res.text, /id="details-modal"/);
    assert.match(res.text, /id="usage-modal"/);
    assert.match(res.text, /id="details-view-usage-btn"/);
  });

  it("GET /js/billing.js should serve the billing controller with safe DOM & valid pure helpers", async () => {
    const res = await request(app).get("/js/billing.js");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /javascript/);
    assert.match(res.text, /initBillingPage/);
    assert.match(res.text, /renderBillingTable/);
    assert.match(res.text, /openDetailsModal/);
    assert.match(res.text, /openReconciledUsageModal/);
    assert.doesNotMatch(res.text, /\.innerHTML\s*=/);
    assert.doesNotMatch(res.text, /\bwindow\.confirm\s*\(/);
    assert.doesNotMatch(res.text, /\bwindow\.alert\s*\(/);

    // Run in isolated VM to verify pure validation, formatting, and payload helpers
    const sandbox = { window: {} };
    vm.runInNewContext(res.text, sandbox);
    const helpers = sandbox.window.MeterFlowBilling;
    assert.ok(helpers, "MeterFlowBilling helpers should be exposed on window");

    // 1. RBAC permissions
    assert.equal(helpers.canGenerateBilling("owner"), true);
    assert.equal(helpers.canGenerateBilling("admin"), true);
    assert.equal(helpers.canGenerateBilling("member"), false);
    assert.equal(helpers.canGenerateBilling("viewer"), false);

    // 2. Monetary & date formatting
    assert.equal(helpers.formatCurrency("1250.50", "USD"), "USD 1,250.50");
    assert.equal(helpers.formatCurrency("0", "USD"), "USD 0.00");
    assert.equal(helpers.formatCurrency(null, "EUR"), "EUR 0.00");
    assert.equal(helpers.formatDateTime(""), "--");
    assert.equal(helpers.formatDateOnly(""), "--");

    // 3. Form validation
    assert.match(
      helpers.validateGenerateForm({ billingPeriodStart: "", billingPeriodEnd: "2026-10-31", currency: "USD" }).error,
      /start date is required/i
    );
    assert.match(
      helpers.validateGenerateForm({ billingPeriodStart: "2026-10-01", billingPeriodEnd: "", currency: "USD" }).error,
      /end date is required/i
    );
    assert.match(
      helpers.validateGenerateForm({ billingPeriodStart: "invalid", billingPeriodEnd: "2026-10-31", currency: "USD" }).error,
      /invalid format/i
    );
    assert.match(
      helpers.validateGenerateForm({ billingPeriodStart: "2026-10-31", billingPeriodEnd: "2026-10-01", currency: "USD" }).error,
      /strictly before/i
    );
    assert.match(
      helpers.validateGenerateForm({ billingPeriodStart: "2026-10-01", billingPeriodEnd: "2026-10-31", currency: "US" }).error,
      /3-letter ISO code/i
    );
    assert.equal(
      helpers.validateGenerateForm({ billingPeriodStart: "2026-10-01T00:00:00Z", billingPeriodEnd: "2026-10-31T23:59:59Z", currency: "usd" }).valid,
      true
    );

    // 4. Payload construction
    const payload = helpers.buildGeneratePayload({
      billingPeriodStart: "2026-10-01T00:00:00.000Z",
      billingPeriodEnd: "2026-10-31T23:59:59.999Z",
      currency: "usd"
    });
    assert.equal(payload.billingPeriodStart, "2026-10-01T00:00:00.000Z");
    assert.equal(payload.billingPeriodEnd, "2026-10-31T23:59:59.999Z");
    assert.equal(payload.currency, "USD");

    // 5. Date filter range parser
    const badRange = helpers.parseDateFilterRange("2026-10-31", "2026-10-01");
    assert.match(badRange.error, /cannot be after/);

    const validRange = helpers.parseDateFilterRange("2026-10-01", "2026-10-31");
    assert.ok(validRange.startDateISO.startsWith("2026-10-01"));
    assert.ok(validRange.endDateISO.startsWith("2026-10-31T23:59:59"));
  });

  it("GET /budgets should serve budgets.html with 200 OK", async () => {
    const res = await request(app).get("/budgets");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.text, /Budgets, Alerts & Forecasting — MeterFlow/);
    assert.match(res.text, /id="budgets-container"/);
    assert.match(res.text, /id="create-budget-form"/);
  });

  it("GET new JavaScript controller modules should return application/javascript", async () => {
    const jsFiles = ["services.js", "usage.js", "billing.js", "budgets.js"];
    for (const file of jsFiles) {
      const res = await request(app).get(`/js/${file}`);
      assert.equal(res.status, 200, `Failed for /js/${file}`);
      assert.match(res.headers["content-type"], /javascript/);
    }
  });

  it("all frontend HTML pages should comply with Helmet CSP (no inline scripts or onclick)", async () => {
    const pages = ["/", "/login", "/register", "/services", "/usage", "/billing", "/budgets"];
    for (const page of pages) {
      const res = await request(app).get(page);
      assert.equal(res.status, 200);
      // No inline event handlers like onclick=
      assert.doesNotMatch(res.text, /\sonclick\s*=/i, `Inline onclick detected in ${page}`);
      // No inline script tags with executable bodies (allow <script src="...">)
      assert.doesNotMatch(res.text, /<script(?![^>]*src=)[^>]*>[\s\S]+?<\/script>/i, `Inline script block detected in ${page}`);
    }
  });

  it("undefined /api/... routes must return 404 JSON, NOT HTML index", async () => {
    const res = await request(app).get("/api/undefined-route-check");
    assert.equal(res.status, 404);
    assert.match(res.headers["content-type"], /application\/json/);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Cannot GET \/api\/undefined-route-check/);
  });

  it("should not expose backend source files or .env through static assets", async () => {
    const envRes = await request(app).get("/.env");
    assert.equal(envRes.status, 404);

    const serverRes = await request(app).get("/server.js");
    assert.equal(serverRes.status, 404);

    const packageRes = await request(app).get("/package.json");
    assert.equal(packageRes.status, 404);
  });
});
