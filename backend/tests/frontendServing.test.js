import { describe, it } from "node:test";
import assert from "node:assert/strict";
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

  it("GET /services should serve services.html with 200 OK", async () => {
    const res = await request(app).get("/services");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.text, /Tracked Services — MeterFlow/);
    assert.match(res.text, /id="services-table-body"/);
    assert.match(res.text, /id="create-service-form"/);
  });

  it("GET /js/services.js should serve the services controller with application/javascript", async () => {
    const res = await request(app).get("/js/services.js");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /javascript/);
    assert.match(res.text, /initServicesPage/);
    assert.match(res.text, /renderServicesTable/);
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
