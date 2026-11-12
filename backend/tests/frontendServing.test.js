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

  it("GET /usage should serve usage.html with 200 OK", async () => {
    const res = await request(app).get("/usage");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.text, /Usage Ingestion & History — MeterFlow/);
    assert.match(res.text, /id="ingest-usage-form"/);
    assert.match(res.text, /id="usage-table-body"/);
  });

  it("GET /billing should serve billing.html with 200 OK", async () => {
    const res = await request(app).get("/billing");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.text, /Invoices & Billing — MeterFlow/);
    assert.match(res.text, /id="billing-table-body"/);
    assert.match(res.text, /id="generate-bill-form"/);
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
