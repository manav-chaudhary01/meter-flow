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
