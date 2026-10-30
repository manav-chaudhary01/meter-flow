import { describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";

describe("Health API & Application Boundaries", () => {
  it("GET /api/health should return 200 with running status message", async () => {
    const res = await request(app).get("/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.message, "MeterFlow API is running");
  });

  it("should return 404 for undefined routes", async () => {
    const res = await request(app).get("/api/unknown-endpoint-xyz");
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Cannot GET \/api\/unknown-endpoint-xyz/);
  });
});
