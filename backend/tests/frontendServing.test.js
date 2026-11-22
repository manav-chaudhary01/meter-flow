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
    assert.match(res.text, /Every MeterFlow account starts with an initial workspace/);
  });

  it("GET /css/styles.css should serve the stylesheet with text/css content-type", async () => {
    const res = await request(app).get("/css/styles.css");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/css/);
    assert.match(res.text, /--color-primary/);
  });

  it("GET /js/api.js should serve the API client module with safe DOM and robust session handling", async () => {
    const res = await request(app).get("/js/api.js");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /javascript/);
    assert.match(res.text, /MeterFlowAPI/);
    assert.doesNotMatch(res.text, /\.innerHTML\s*=/);
    assert.doesNotMatch(res.text, /\.outerHTML\s*=/);
    assert.doesNotMatch(res.text, /\bwindow\.alert\s*\(/);
    assert.doesNotMatch(res.text, /\balert\s*\(/);
    assert.doesNotMatch(res.text, /\bwindow\.confirm\s*\(/);
    assert.doesNotMatch(res.text, /\bconfirm\s*\(/);

    // Run in isolated VM to verify JWT parsing, session handling, and auth error formatting
    const storage = new Map();
    const mockLocalStorage = {
      getItem: (k) => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
      clear: () => storage.clear()
    };
    const sandbox = {
      window: { location: { origin: "http://localhost:3000", pathname: "/" } },
      localStorage: mockLocalStorage,
      atob: (str) => Buffer.from(str, "base64").toString("binary"),
      Buffer
    };
    sandbox.window.localStorage = mockLocalStorage;
    vm.runInNewContext(res.text, sandbox);
    const api = sandbox.window.MeterFlowAPI;
    assert.ok(api, "MeterFlowAPI should be exposed on window");

    // 1. parseJwtPayload tests
    const samplePayload = { userId: "user-123", tenantId: "tenant-456", exp: Math.floor(Date.now() / 1000) + 3600 };
    const base64Payload = Buffer.from(JSON.stringify(samplePayload)).toString("base64url");
    const validToken = `header.${base64Payload}.signature`;

    const parsed = api.parseJwtPayload(validToken);
    assert.equal(parsed.userId, "user-123");
    assert.equal(parsed.tenantId, "tenant-456");
    assert.equal(api.parseJwtPayload("not-a-token"), null);
    assert.equal(api.parseJwtPayload("a.b"), null);
    assert.equal(api.parseJwtPayload(null), null);

    // 2. isAuthenticated tests
    // Case A: Storage empty -> false
    assert.equal(api.isAuthenticated(), false);

    // Case B: Token exists but user is null -> false, session auto-cleared
    api.setToken(validToken);
    assert.equal(api.isAuthenticated(), false);
    assert.equal(api.getToken(), null); // verified cleared

    // Case C: Expired token -> false, session auto-cleared
    const expiredPayload = { userId: "user-123", exp: Math.floor(Date.now() / 1000) - 3600 };
    const expiredToken = `header.${Buffer.from(JSON.stringify(expiredPayload)).toString("base64url")}.sig`;
    api.setToken(expiredToken);
    api.setUser({ id: "user-123", email: "test@example.com" });
    assert.equal(api.isAuthenticated(), false);
    assert.equal(api.getToken(), null);
    assert.equal(api.getUser(), null);

    // Case D: Valid unexpired token and user -> true
    api.setToken(validToken);
    api.setUser({ id: "user-123", email: "test@example.com" });
    assert.equal(api.isAuthenticated(), true);

    // 3. formatAuthErrorMessage tests
    assert.match(api.formatAuthErrorMessage({ status: 401 }), /session has expired/i);
    assert.match(api.formatAuthErrorMessage({ status: 403, message: "Access denied: your workspace membership is suspended or inactive" }), /suspended or inactive/i);
    assert.match(api.formatAuthErrorMessage({ status: 403, message: "Access denied: you are not an active member of this workspace" }), /not an active member/i);
    assert.match(api.formatAuthErrorMessage({ status: 403, message: "Forbidden: this action requires one of the following roles: owner, admin" }), /administrative action/i);
    assert.equal(api.formatAuthErrorMessage({ status: 500, message: "Internal server error" }), "Internal server error");
  });

  it("GET /js/auth.js should serve the auth module with client validation and auth guards", async () => {
    const res = await request(app).get("/js/auth.js");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /javascript/);
    assert.match(res.text, /MeterFlowAuth/);
    assert.doesNotMatch(res.text, /\.innerHTML\s*=/);
    assert.doesNotMatch(res.text, /\.outerHTML\s*=/);
    assert.doesNotMatch(res.text, /\bwindow\.alert\s*\(/);
    assert.doesNotMatch(res.text, /\balert\s*\(/);
    assert.doesNotMatch(res.text, /\bwindow\.confirm\s*\(/);
    assert.doesNotMatch(res.text, /\bconfirm\s*\(/);

    // Run in isolated VM to verify validation helpers
    const sandbox = {
      window: {},
      document: {
        getElementById: () => null,
        addEventListener: () => {}
      }
    };
    vm.runInNewContext(res.text, sandbox);
    const auth = sandbox.window.MeterFlowAuth;
    assert.ok(auth, "MeterFlowAuth should be exposed on window");

    // 1. validateLoginForm
    assert.equal(auth.validateLoginForm({ email: "", password: "" }).valid, false);
    assert.match(auth.validateLoginForm({ email: "", password: "pwd" }).error, /enter both email and password/i);
    assert.match(auth.validateLoginForm({ email: "invalid-email", password: "pwd" }).error, /valid email/i);
    assert.equal(auth.validateLoginForm({ email: "user@example.com", password: "pwd" }).valid, true);

    // 2. validateRegisterForm
    assert.equal(auth.validateRegisterForm({ name: "", email: "", password: "", organizationName: "" }).valid, false);
    assert.match(auth.validateRegisterForm({ name: "A", email: "user@example.com", password: "password", organizationName: "Org" }).error, /at least 2 characters/i);
    assert.match(auth.validateRegisterForm({ name: "User", email: "bad-email", password: "password", organizationName: "Org" }).error, /valid email/i);
    assert.match(auth.validateRegisterForm({ name: "User", email: "user@example.com", password: "123", organizationName: "Org" }).error, /at least 6 characters/i);
    assert.equal(auth.validateRegisterForm({ name: "User", email: "user@example.com", password: "secretPassword", organizationName: "Acme Corp" }).valid, true);

    // 3. validateRenameWorkspaceForm
    assert.equal(auth.validateRenameWorkspaceForm({ name: "" }).valid, false);
    assert.match(auth.validateRenameWorkspaceForm({ name: "" }).error, /name is required/i);
    assert.match(auth.validateRenameWorkspaceForm({ name: "   " }).error, /name is required/i);
    assert.match(auth.validateRenameWorkspaceForm({ name: "A" }).error, /between 2 and 100/i);
    assert.match(auth.validateRenameWorkspaceForm({ name: "A".repeat(101) }).error, /between 2 and 100/i);
    assert.equal(auth.validateRenameWorkspaceForm({ name: "Acme Production" }).valid, true);
    assert.equal(auth.validateRenameWorkspaceForm({ name: "  Trimmed Org  " }).valid, true);
    assert.equal(auth.validateRenameWorkspaceForm({ name: "  Trimmed Org  " }).data.name, "Trimmed Org");
  });

  it("GET /js/dashboard.js should serve the dashboard controller with safe DOM & valid pure helpers", async () => {
    const res = await request(app).get("/js/dashboard.js");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /javascript/);
    assert.match(res.text, /initDashboard/);
    assert.match(res.text, /renderSummaryCards/);
    assert.match(res.text, /renderInvoicesTable/);
    assert.match(res.text, /renderBudgetsList/);
    assert.match(res.text, /renderAlertsList/);
    assert.doesNotMatch(res.text, /\.innerHTML\s*=/);
    assert.doesNotMatch(res.text, /\.outerHTML\s*=/);
    assert.doesNotMatch(res.text, /\bwindow\.confirm\s*\(/);
    assert.doesNotMatch(res.text, /\bwindow\.alert\s*\(/);

    // Run in isolated VM to verify pure validation, spend calculation, and formatting helpers
    const sandbox = { window: {} };
    vm.runInNewContext(res.text, sandbox);
    const helpers = sandbox.window.MeterFlowDashboard;
    assert.ok(helpers, "MeterFlowDashboard helpers should be exposed on window");

    // 1. RBAC permissions
    assert.equal(helpers.canManage("owner"), true);
    assert.equal(helpers.canManage("admin"), true);
    assert.equal(helpers.canManage("member"), false);
    assert.equal(helpers.canManage("viewer"), false);

    // 2. Currency & Date formatting
    assert.match(helpers.formatCurrency("1250.50", "USD"), /1,250\.50/);
    assert.match(helpers.formatCurrency("0.00", "USD"), /0\.00/);
    assert.equal(helpers.formatDate(""), "N/A");
    assert.match(helpers.formatDate("2026-11-01T00:00:00.000Z"), /Nov 1, 2026/);
    assert.equal(helpers.formatPeriod("", ""), "N/A");
    assert.match(helpers.formatPeriod("2026-11-01T12:00:00.000Z", "2026-11-20T12:00:00.000Z"), /Nov 1, 2026.*–.*Nov 20, 2026/);

    // 3. Precise spend calculation
    const spend = helpers.calculateTotalSpend([
      { total: "100.25", currency: "USD" },
      { total: "50.75", currency: "USD" },
      { total: "200.00", currency: "USD" }
    ]);
    assert.equal(spend.total, "351.00");
    assert.equal(spend.currency, "USD");
    assert.equal(spend.count, 3);

    // Empty records check
    const emptySpend = helpers.calculateTotalSpend([]);
    assert.equal(emptySpend.total, "0.00");
    assert.equal(emptySpend.count, 0);

    // 4. Metric counts
    const svcs = helpers.countActiveServices([
      { status: "active", trackingType: "metered" },
      { status: "active", trackingType: "subscription" },
      { status: "archived", trackingType: "metered" }
    ]);
    assert.equal(svcs.total, 2);
    assert.equal(svcs.metered, 1);
    assert.equal(svcs.subscription, 1);

    const activeBudgets = helpers.countActiveBudgets([
      { status: "active" },
      { status: "active" },
      { status: "archived" }
    ]);
    assert.equal(activeBudgets, 2);

    const activeAlerts = helpers.countActiveAlerts([
      { status: "active" },
      { status: "acknowledged" }
    ]);
    assert.equal(activeAlerts, 1);

    // 5. Visual classes & badges
    assert.equal(helpers.buildProgressClass(45), "fill-safe");
    assert.equal(helpers.buildProgressClass(85), "fill-warning");
    assert.equal(helpers.buildProgressClass(110), "fill-danger");

    assert.equal(helpers.buildInvoiceStatusBadge("finalized").className, "badge badge-success");
    assert.equal(helpers.buildInvoiceStatusBadge("issued").className, "badge badge-warning");
    assert.equal(helpers.buildInvoiceStatusBadge("void").className, "badge badge-danger");

    const reachedBadge = helpers.buildAlertBadge({ alertType: "threshold_reached", threshold: 80 });
    assert.equal(reachedBadge.className, "badge badge-warning");
    assert.match(reachedBadge.text, /80% REACHED/);

    const exceededBadge = helpers.buildAlertBadge({ alertType: "threshold_exceeded", threshold: 100 });
    assert.equal(exceededBadge.className, "badge badge-danger");
    assert.match(exceededBadge.text, /100% EXCEEDED/);

    // 6. Forecast text builder
    const onTrackText = helpers.buildForecastText({
      currency: "USD",
      forecast: { hasSufficientData: true, isProjectedToExceed: false, forecastSpend: "450.00" }
    });
    assert.match(onTrackText, /On track/);

    const overrunText = helpers.buildForecastText({
      currency: "USD",
      forecast: { hasSufficientData: true, isProjectedToExceed: true, forecastSpend: "1200.00" }
    });
    assert.match(overrunText, /Projected to reach/);
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

  it("GET /budgets should serve budgets.html with 200 OK, metric cards, and modals", async () => {
    const res = await request(app).get("/budgets");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.text, /Budgets, Alerts & Forecasting — MeterFlow/);
    assert.match(res.text, /id="budgets-container"/);
    assert.match(res.text, /id="create-budget-form"/);
    assert.match(res.text, /id="metric-active-budgets"/);
    assert.match(res.text, /id="metric-total-budget"/);
    assert.match(res.text, /id="metric-triggered-alerts"/);
    assert.match(res.text, /id="alerts-list-container"/);
    assert.match(res.text, /id="filter-alert-status"/);
    assert.match(res.text, /id="create-budget-modal"/);
    assert.match(res.text, /id="edit-budget-modal"/);
    assert.match(res.text, /id="deactivate-budget-modal"/);
    assert.match(res.text, /id="deactivate-confirm-btn"/);
  });

  it("GET /js/budgets.js should serve the budgets controller with safe DOM & valid pure helpers", async () => {
    const res = await request(app).get("/js/budgets.js");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /javascript/);
    assert.match(res.text, /initBudgetsPage/);
    assert.match(res.text, /renderBudgets/);
    assert.match(res.text, /renderAlerts/);
    assert.match(res.text, /evaluateBudgetAction/);
    assert.doesNotMatch(res.text, /\.innerHTML\s*=/);
    assert.doesNotMatch(res.text, /\bwindow\.confirm\s*\(/);
    assert.doesNotMatch(res.text, /\bwindow\.alert\s*\(/);

    // Run in isolated VM to verify pure validation, thresholds, formatting, and payload helpers
    const sandbox = { window: {} };
    vm.runInNewContext(res.text, sandbox);
    const helpers = sandbox.window.MeterFlowBudgets;
    assert.ok(helpers, "MeterFlowBudgets helpers should be exposed on window");

    // 1. RBAC permissions
    assert.equal(helpers.canManageBudgets("owner"), true);
    assert.equal(helpers.canManageBudgets("admin"), true);
    assert.equal(helpers.canManageBudgets("member"), false);
    assert.equal(helpers.canManageBudgets("viewer"), false);

    // 2. Threshold parsing
    const defaultThresh = helpers.parseThresholds("");
    assert.deepEqual(JSON.parse(JSON.stringify(defaultThresh.thresholds)), [50, 80, 90, 100]);

    const customThresh = helpers.parseThresholds("80, 50, 100, 90, 80");
    assert.deepEqual(JSON.parse(JSON.stringify(customThresh.thresholds)), [50, 80, 90, 100]);

    const badThresh = helpers.parseThresholds("50, 250");
    assert.match(badThresh.error, /between 1 and 200/i);

    const zeroThresh = helpers.parseThresholds("0, 50");
    assert.match(zeroThresh.error, /between 1 and 200/i);

    // 3. Amount validation
    assert.match(helpers.validateBudgetAmount("").error, /required/i);
    assert.match(helpers.validateBudgetAmount("-50").error, /positive number/i);
    assert.match(helpers.validateBudgetAmount("0").error, /positive number/i);
    assert.match(helpers.validateBudgetAmount("abc").error, /valid finite number/i);
    assert.equal(helpers.validateBudgetAmount("1500.50").value, "1500.50");

    // 4. Form validation (create mode)
    assert.match(
      helpers.validateBudgetForm("create", { name: "A", amount: "100", currency: "USD", startDate: "2026-03-01", endDate: "2026-04-01" }).error,
      /minimum 2 characters/i
    );
    assert.match(
      helpers.validateBudgetForm("create", { name: "Q1 Budget", amount: "100", currency: "US", startDate: "2026-03-01", endDate: "2026-04-01" }).error,
      /3-letter ISO code/i
    );
    assert.match(
      helpers.validateBudgetForm("create", { name: "Q1 Budget", amount: "100", currency: "USD", startDate: "2026-04-01", endDate: "2026-03-01" }).error,
      /strictly before/i
    );
    assert.equal(
      helpers.validateBudgetForm("create", {
        name: "Q1 Infrastructure",
        amount: "1000.00",
        currency: "usd",
        periodType: "monthly",
        startDate: "2026-03-01T00:00:00Z",
        endDate: "2026-04-01T00:00:00Z",
        thresholds: "50, 80, 90, 100"
      }).valid,
      true
    );

    // 5. Payload builder
    const createPayload = helpers.buildCreatePayload({
      name: "Q1 Infrastructure",
      amount: "1000",
      currency: "usd",
      periodType: "monthly",
      startDate: "2026-03-01T00:00:00.000Z",
      endDate: "2026-04-01T00:00:00.000Z",
      thresholds: "50, 75, 90"
    });
    assert.equal(createPayload.name, "Q1 Infrastructure");
    assert.equal(createPayload.amount, "1000.00");
    assert.equal(createPayload.currency, "USD");
    assert.deepEqual(JSON.parse(JSON.stringify(createPayload.thresholds)), [50, 75, 90]);

    const editPayload = helpers.buildEditPayload({
      name: "Updated Q1 Infrastructure",
      amount: "1250",
      status: "active",
      thresholds: "50, 80, 100"
    });
    assert.equal(editPayload.name, "Updated Q1 Infrastructure");
    assert.equal(editPayload.amount, "1250.00");
    assert.equal(editPayload.status, "active");
    assert.deepEqual(JSON.parse(JSON.stringify(editPayload.thresholds)), [50, 80, 100]);

    // 6. Formatting helpers
    assert.equal(helpers.formatCurrency("1500.00", "USD"), "USD 1,500.00");
    assert.equal(helpers.formatCurrency(null, "EUR"), "EUR 0.00");
    assert.equal(helpers.formatDateTime(""), "--");
    assert.equal(helpers.formatDateOnly(""), "--");
  });

  it("GET /team should serve team.html with 200 OK and expected DOM anchors", async () => {
    const res = await request(app).get("/team");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.text, /Team &amp; Members — MeterFlow/);
    assert.match(res.text, /id="team-table"/);
    assert.match(res.text, /<th scope="col">Status<\/th>/);
    assert.match(res.text, /id="open-invite-modal-btn"/);
    assert.match(res.text, /\+ Add Member/);
    assert.match(res.text, /Add Workspace Member/);
    assert.match(res.text, /Enter the email address of an existing MeterFlow user/);
    assert.match(res.text, /id="invite-member-modal"/);
    assert.match(res.text, /id="remove-member-modal"/);
    assert.match(res.text, /id="create-workspace-modal"/);
    assert.match(res.text, /id="open-create-workspace-btn"/);
    assert.match(res.text, /id="personal-workspace-banner"/);
  });

  it("GET /js/team.js should serve the team controller with safe DOM & valid pure helpers", async () => {
    const res = await request(app).get("/js/team.js");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /javascript/);
    assert.doesNotMatch(res.text, /\.innerHTML\s*=/);
    assert.doesNotMatch(res.text, /\.outerHTML\s*=/);
    assert.doesNotMatch(res.text, /\bwindow\.alert\s*\(/);
    assert.doesNotMatch(res.text, /\balert\s*\(/);
    assert.doesNotMatch(res.text, /\bwindow\.confirm\s*\(/);
    assert.doesNotMatch(res.text, /\bconfirm\s*\(/);

    // Run in isolated VM to verify pure validation and RBAC helpers
    const sandbox = {
      window: {},
      document: {
        getElementById: () => null,
        addEventListener: () => {},
        querySelectorAll: () => []
      }
    };
    vm.runInNewContext(res.text, sandbox);
    const helpers = sandbox.window.MeterFlowTeam;
    assert.ok(helpers, "MeterFlowTeam should be exposed on window");

    // 1. validateWorkspaceForm
    assert.equal(helpers.validateWorkspaceForm({ name: "", type: "organization" }).valid, false);
    assert.match(helpers.validateWorkspaceForm({ name: "", type: "organization" }).error, /name is required/i);
    assert.equal(helpers.validateWorkspaceForm({ name: "A", type: "organization" }).valid, false);
    assert.match(helpers.validateWorkspaceForm({ name: "A", type: "organization" }).error, /between 2 and 100/i);
    assert.equal(helpers.validateWorkspaceForm({ name: "Valid Team", type: "invalid_type" }).valid, false);
    assert.match(helpers.validateWorkspaceForm({ name: "Valid Team", type: "invalid_type" }).error, /personal.*organization/i);
    assert.equal(helpers.validateWorkspaceForm({ name: "Valid Org", type: "organization" }).valid, true);
    assert.equal(helpers.validateWorkspaceForm({ name: "Valid Personal", type: "personal" }).valid, true);

    // 2. validateInviteMemberForm
    assert.equal(helpers.validateInviteMemberForm({ email: "", role: "member" }).valid, false);
    assert.match(helpers.validateInviteMemberForm({ email: "", role: "member" }).error, /email is required/i);
    assert.equal(helpers.validateInviteMemberForm({ email: "invalid-email", role: "member" }).valid, false);
    assert.match(helpers.validateInviteMemberForm({ email: "invalid-email", role: "member" }).error, /valid email/i);
    assert.equal(helpers.validateInviteMemberForm({ email: "user@example.com", role: "superadmin" }).valid, false);
    assert.match(helpers.validateInviteMemberForm({ email: "user@example.com", role: "superadmin" }).error, /admin.*member/i);
    assert.equal(helpers.validateInviteMemberForm({ email: "user@example.com", role: "admin" }).valid, true);
    assert.equal(helpers.validateInviteMemberForm({ email: "user@example.com", role: "member" }).valid, true);

    // 2b. validateModifyRole
    assert.equal(helpers.validateModifyRole("").valid, false);
    assert.match(helpers.validateModifyRole("").error, /admin.*member/i);
    assert.equal(helpers.validateModifyRole("owner").valid, false);
    assert.match(helpers.validateModifyRole("owner").error, /cannot assign owner/i);
    assert.equal(helpers.validateModifyRole("invalid-role").valid, false);
    assert.match(helpers.validateModifyRole("invalid-role").error, /admin.*member/i);
    assert.equal(helpers.validateModifyRole("admin").valid, true);
    assert.equal(helpers.validateModifyRole("admin").role, "admin");
    assert.equal(helpers.validateModifyRole("member").valid, true);
    assert.equal(helpers.validateModifyRole("member").role, "member");

    // 2c. validateModifyStatus
    assert.equal(helpers.validateModifyStatus("").valid, false);
    assert.match(helpers.validateModifyStatus("").error, /active.*suspended/i);
    assert.equal(helpers.validateModifyStatus("admin").valid, false);
    assert.match(helpers.validateModifyStatus("admin").error, /active.*suspended/i);
    assert.equal(helpers.validateModifyStatus("active").valid, true);
    assert.equal(helpers.validateModifyStatus("active").status, "active");
    assert.equal(helpers.validateModifyStatus("suspended").valid, true);
    assert.equal(helpers.validateModifyStatus("suspended").status, "suspended");

    // 3. canManageTeam
    assert.equal(helpers.canManageTeam("owner"), true);
    assert.equal(helpers.canManageTeam("admin"), true);
    assert.equal(helpers.canManageTeam("member"), false);
    assert.equal(helpers.canManageTeam("viewer"), false);

    // 3b. canModifyMemberRole (currentUserRole, targetMemberRole)
    assert.equal(helpers.canModifyMemberRole("owner", "member"), true);
    assert.equal(helpers.canModifyMemberRole("owner", "admin"), true);
    assert.equal(helpers.canModifyMemberRole("owner", "owner"), false);
    assert.equal(helpers.canModifyMemberRole("admin", "member"), false);
    assert.equal(helpers.canModifyMemberRole("admin", "admin"), false);
    assert.equal(helpers.canModifyMemberRole("admin", "owner"), false);
    assert.equal(helpers.canModifyMemberRole("member", "member"), false);
    assert.equal(helpers.canModifyMemberRole("member", "admin"), false);
    assert.equal(helpers.canModifyMemberRole("member", "owner"), false);

    // 3c. canModifyMemberStatus (currentUserRole, targetMemberRole, isSelf)
    assert.equal(helpers.canModifyMemberStatus("owner", "member", false), true);
    assert.equal(helpers.canModifyMemberStatus("owner", "admin", false), true);
    assert.equal(helpers.canModifyMemberStatus("owner", "owner", false), false);
    assert.equal(helpers.canModifyMemberStatus("owner", "member", true), false);
    assert.equal(helpers.canModifyMemberStatus("admin", "member", false), true);
    assert.equal(helpers.canModifyMemberStatus("admin", "admin", false), false);
    assert.equal(helpers.canModifyMemberStatus("admin", "owner", false), false);
    assert.equal(helpers.canModifyMemberStatus("admin", "member", true), false);
    assert.equal(helpers.canModifyMemberStatus("member", "member", false), false);
    assert.equal(helpers.canModifyMemberStatus("member", "admin", false), false);
    assert.equal(helpers.canModifyMemberStatus("member", "owner", false), false);

    // 4. canRemoveMember (currentUserRole, targetMemberRole, isWorkspaceOwner)
    assert.equal(helpers.canRemoveMember("owner", "admin", false), true);
    assert.equal(helpers.canRemoveMember("owner", "member", false), true);
    assert.equal(helpers.canRemoveMember("owner", "owner", true), false);
    assert.equal(helpers.canRemoveMember("admin", "member", false), true);
    assert.equal(helpers.canRemoveMember("admin", "admin", false), false);
    assert.equal(helpers.canRemoveMember("admin", "owner", true), false);
    assert.equal(helpers.canRemoveMember("member", "member", false), false);
    assert.equal(helpers.canRemoveMember("member", "admin", false), false);

    // 5. formatMemberRole
    assert.equal(helpers.formatMemberRole("owner").label, "Owner");
    assert.match(helpers.formatMemberRole("owner").className, /badge-primary/);
    assert.equal(helpers.formatMemberRole("admin").label, "Admin");
    assert.match(helpers.formatMemberRole("admin").className, /badge-info/);
    assert.equal(helpers.formatMemberRole("member").label, "Member");
    assert.match(helpers.formatMemberRole("member").className, /badge-neutral/);

    // 5b. formatMemberStatus
    assert.equal(helpers.formatMemberStatus("active").label, "Active");
    assert.match(helpers.formatMemberStatus("active").className, /badge-success/);
    assert.equal(helpers.formatMemberStatus("suspended").label, "Suspended");
    assert.match(helpers.formatMemberStatus("suspended").className, /badge-warning/);

    // 6. getInitials & formatDate
    assert.equal(helpers.getInitials("Alice Smith"), "AS");
    assert.equal(helpers.getInitials("Bob"), "B");
    assert.equal(helpers.getInitials(""), "U");
    assert.equal(helpers.formatDate(null), "—");
    assert.equal(helpers.formatDate("invalid-date"), "—");
  });

  it("GET new JavaScript controller modules should return application/javascript", async () => {
    const jsFiles = ["services.js", "usage.js", "billing.js", "budgets.js", "team.js"];
    for (const file of jsFiles) {
      const res = await request(app).get(`/js/${file}`);
      assert.equal(res.status, 200, `Failed for /js/${file}`);
      assert.match(res.headers["content-type"], /javascript/);
    }
  });

  it("all frontend HTML pages should comply with Helmet CSP (no inline scripts or onclick)", async () => {
    const pages = ["/", "/login", "/register", "/services", "/usage", "/billing", "/budgets", "/team"];
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

  it("all frontend JS modules should have zero unsafe innerHTML, outerHTML, window.alert, or window.confirm", async () => {
    const modules = ["api.js", "auth.js", "dashboard.js", "services.js", "usage.js", "billing.js", "budgets.js", "team.js"];
    for (const mod of modules) {
      const res = await request(app).get(`/js/${mod}`);
      assert.equal(res.status, 200, `Failed fetching /js/${mod}`);
      assert.doesNotMatch(res.text, /\.innerHTML\s*=/, `unsafe innerHTML assignment detected in /js/${mod}`);
      assert.doesNotMatch(res.text, /\.outerHTML\s*=/, `unsafe outerHTML assignment detected in /js/${mod}`);
      assert.doesNotMatch(res.text, /\bwindow\.alert\s*\(/, `window.alert detected in /js/${mod}`);
      assert.doesNotMatch(res.text, /\balert\s*\(/, `alert() call detected in /js/${mod}`);
      assert.doesNotMatch(res.text, /\bwindow\.confirm\s*\(/, `window.confirm detected in /js/${mod}`);
      assert.doesNotMatch(res.text, /\bconfirm\s*\(/, `confirm() call detected in /js/${mod}`);
    }
  });

  it("all authenticated HTML pages should include consistent header, user profile, and workspace switching elements", async () => {
    const pages = ["/", "/services", "/usage", "/billing", "/budgets", "/team"];
    for (const page of pages) {
      const res = await request(app).get(page);
      assert.equal(res.status, 200, `Failed fetching ${page}`);
      assert.match(res.text, /id="workspace-select"/, `workspace-select missing in ${page}`);
      assert.match(res.text, /id="workspace-role-badge"/, `workspace-role-badge missing in ${page}`);
      assert.match(res.text, /id="open-create-workspace-btn"/, `open-create-workspace-btn missing in ${page}`);
      assert.match(res.text, /id="create-workspace-modal"/, `create-workspace-modal missing in ${page}`);
      assert.match(res.text, /id="open-rename-workspace-btn"/, `open-rename-workspace-btn missing in ${page}`);
      assert.match(res.text, /id="rename-workspace-modal"/, `rename-workspace-modal missing in ${page}`);
      assert.match(res.text, /id="header-user-name"/, `header-user-name missing in ${page}`);
      assert.match(res.text, /id="header-user-role"/, `header-user-role missing in ${page}`);
      assert.match(res.text, /id="logout-btn"/, `logout-btn missing in ${page}`);
      assert.match(res.text, /id="mobile-menu-btn"/, `mobile-menu-btn missing in ${page}`);
      assert.match(res.text, /class="sidebar"/, `sidebar missing in ${page}`);
      assert.match(res.text, /class="sidebar-nav"/, `sidebar-nav missing in ${page}`);
    }
  });
});
