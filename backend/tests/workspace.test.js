import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";

describe("Workspace Architecture & Membership API", () => {
  let userAToken;
  let userBToken;
  let userAId;
  let userBId;
  let orgAId;
  let orgBId;

  before(async () => {
    await connectTestDb();
  });

  after(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();

    // Register User A
    const regA = await request(app).post("/api/auth/register").send({
      name: "Alice Developer",
      email: "alice@example.com",
      password: "password123",
      organizationName: "Alice Cloud Org"
    });
    userAToken = regA.body.data.token;
    userAId = regA.body.data.user.id;
    orgAId = regA.body.data.tenant.id;

    // Register User B
    const regB = await request(app).post("/api/auth/register").send({
      name: "Bob Operator",
      email: "bob@example.com",
      password: "password123",
      organizationName: "Bob Infra Ltd"
    });
    userBToken = regB.body.data.token;
    userBId = regB.body.data.user.id;
    orgBId = regB.body.data.tenant.id;
  });

  describe("GET /api/workspaces", () => {
    it("should list accessible workspaces and identify active workspace", async () => {
      const res = await request(app)
        .get("/api/workspaces")
        .set("Authorization", `Bearer ${userAToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(Array.isArray(res.body.data.workspaces));
      assert.equal(res.body.data.workspaces.length, 1);

      const ws = res.body.data.workspaces[0];
      assert.equal(ws.id, orgAId);
      assert.equal(ws.name, "Alice Cloud Org");
      assert.equal(ws.type, "organization");
      assert.equal(ws.role, "owner");
      assert.equal(ws.isCurrent, true);
    });
  });

  describe("POST /api/workspaces", () => {
    it("should create a personal workspace for user", async () => {
      const res = await request(app)
        .post("/api/workspaces")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          name: "Alice Personal",
          type: "personal"
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.workspace.name, "Alice Personal");
      assert.equal(res.body.data.workspace.type, "personal");
      assert.equal(res.body.data.workspace.role, "owner");

      // Verify listing now shows 2 workspaces
      const listRes = await request(app)
        .get("/api/workspaces")
        .set("Authorization", `Bearer ${userAToken}`);

      assert.equal(listRes.body.data.workspaces.length, 2);
    });

    it("should prevent creating a second personal workspace", async () => {
      // First personal workspace
      const first = await request(app)
        .post("/api/workspaces")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          name: "Alice Personal 1",
          type: "personal"
        });
      assert.equal(first.status, 201);

      // Attempting second personal workspace
      const second = await request(app)
        .post("/api/workspaces")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          name: "Alice Personal 2",
          type: "personal"
        });

      assert.equal(second.status, 409);
      assert.equal(second.body.success, false);
      assert.match(second.body.message, /already has a personal workspace/i);
    });

    it("should allow creating multiple organization workspaces", async () => {
      const org2 = await request(app)
        .post("/api/workspaces")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          name: "Alice Second Team",
          type: "organization"
        });

      assert.equal(org2.status, 201);
      assert.equal(org2.body.data.workspace.type, "organization");
    });

    it("should reject invalid workspace types or invalid names", async () => {
      const invalidType = await request(app)
        .post("/api/workspaces")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          name: "Invalid Workspace",
          type: "unsupported-type"
        });
      assert.equal(invalidType.status, 400);

      const emptyName = await request(app)
        .post("/api/workspaces")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          name: "",
          type: "organization"
        });
      assert.equal(emptyName.status, 400);
    });
  });

  describe("POST /api/workspaces/switch", () => {
    let alicePersonalId;

    beforeEach(async () => {
      const res = await request(app)
        .post("/api/workspaces")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          name: "Alice Personal Workspace",
          type: "personal"
        });
      alicePersonalId = res.body.data.workspace.id;
    });

    it("should switch to an authorized workspace and issue new token", async () => {
      const switchRes = await request(app)
        .post("/api/workspaces/switch")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          workspaceId: alicePersonalId
        });

      assert.equal(switchRes.status, 200);
      assert.equal(switchRes.body.success, true);
      assert.ok(switchRes.body.data.token);
      assert.equal(switchRes.body.data.workspace.id, alicePersonalId);

      const switchedToken = switchRes.body.data.token;

      // Verify /api/auth/me shows the updated tenantId
      const meRes = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${switchedToken}`);

      assert.equal(meRes.status, 200);
      assert.equal(meRes.body.data.tenantId, alicePersonalId);

      // Verify workspace list shows switched workspace as isCurrent: true
      const listRes = await request(app)
        .get("/api/workspaces")
        .set("Authorization", `Bearer ${switchedToken}`);

      const currentWs = listRes.body.data.workspaces.find((w) => w.isCurrent);
      assert.equal(currentWs.id, alicePersonalId);
    });

    it("should reject switching to a workspace without membership (403)", async () => {
      // Alice attempts to switch to Bob's organization workspace
      const res = await request(app)
        .post("/api/workspaces/switch")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          workspaceId: orgBId
        });

      assert.equal(res.status, 403);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /not an active member/i);
    });

    it("should reject switching with malformed workspaceId (400)", async () => {
      const res = await request(app)
        .post("/api/workspaces/switch")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          workspaceId: "not-a-valid-id"
        });

      assert.equal(res.status, 400);
    });
  });

  describe("Workspace Membership & Role Enforcement", () => {
    it("should allow owner to add a member to an organization workspace", async () => {
      const addRes = await request(app)
        .post(`/api/workspaces/${orgAId}/members`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          email: "bob@example.com",
          role: "member"
        });

      assert.equal(addRes.status, 201);
      assert.equal(addRes.body.success, true);
      assert.equal(addRes.body.data.member.email, "bob@example.com");
      assert.equal(addRes.body.data.member.role, "member");

      // Verify Bob can now see Alice's org in his workspace list
      const bobList = await request(app)
        .get("/api/workspaces")
        .set("Authorization", `Bearer ${userBToken}`);

      const sharedOrg = bobList.body.data.workspaces.find((w) => w.id === orgAId);
      assert.ok(sharedOrg);
      assert.equal(sharedOrg.role, "member");

      // Verify Bob can switch to Alice's org
      const bobSwitch = await request(app)
        .post("/api/workspaces/switch")
        .set("Authorization", `Bearer ${userBToken}`)
        .send({ workspaceId: orgAId });

      assert.equal(bobSwitch.status, 200);
    });

    it("should prevent duplicate membership in the same workspace", async () => {
      // Add Bob once
      await request(app)
        .post(`/api/workspaces/${orgAId}/members`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ email: "bob@example.com", role: "member" });

      // Attempt to add Bob again
      const dupRes = await request(app)
        .post(`/api/workspaces/${orgAId}/members`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ email: "bob@example.com", role: "admin" });

      assert.equal(dupRes.status, 409);
      assert.match(dupRes.body.message, /already a member/i);
    });

    it("should prevent adding members to a personal workspace", async () => {
      const pRes = await request(app)
        .post("/api/workspaces")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ name: "Alice Solo", type: "personal" });

      const personalId = pRes.body.data.workspace.id;

      const addRes = await request(app)
        .post(`/api/workspaces/${personalId}/members`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ email: "bob@example.com", role: "member" });

      assert.equal(addRes.status, 400);
      assert.match(addRes.body.message, /personal workspaces cannot have additional members/i);
    });

    it("should prevent regular members from adding other members (403)", async () => {
      // Alice adds Bob as member
      await request(app)
        .post(`/api/workspaces/${orgAId}/members`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ email: "bob@example.com", role: "member" });

      // Register Charlie
      await request(app).post("/api/auth/register").send({
        name: "Charlie",
        email: "charlie@example.com",
        password: "password123",
        organizationName: "Charlie Org"
      });

      // Bob (role: member) attempts to add Charlie to Alice's org
      const bobAdd = await request(app)
        .post(`/api/workspaces/${orgAId}/members`)
        .set("Authorization", `Bearer ${userBToken}`)
        .send({ email: "charlie@example.com", role: "member" });

      assert.equal(bobAdd.status, 403);
      assert.match(bobAdd.body.message, /only workspace owners and admins/i);
    });

    it("should prevent removing the workspace owner", async () => {
      // Bob attempts to remove Alice (owner) from Alice's org
      // First make Bob an admin
      await request(app)
        .post(`/api/workspaces/${orgAId}/members`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ email: "bob@example.com", role: "admin" });

      const removeOwnerRes = await request(app)
        .delete(`/api/workspaces/${orgAId}/members/${userAId}`)
        .set("Authorization", `Bearer ${userBToken}`);

      assert.equal(removeOwnerRes.status, 403);
      assert.match(removeOwnerRes.body.message, /cannot remove the workspace owner/i);
    });

    it("should allow owner to remove a member", async () => {
      await request(app)
        .post(`/api/workspaces/${orgAId}/members`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ email: "bob@example.com", role: "member" });

      const delRes = await request(app)
        .delete(`/api/workspaces/${orgAId}/members/${userBId}`)
        .set("Authorization", `Bearer ${userAToken}`);

      assert.equal(delRes.status, 200);
      assert.equal(delRes.body.success, true);

      // Verify Bob can no longer switch to orgA
      const bobSwitch = await request(app)
        .post("/api/workspaces/switch")
        .set("Authorization", `Bearer ${userBToken}`)
        .send({ workspaceId: orgAId });

      assert.equal(bobSwitch.status, 403);
    });
  });

  describe("Cross-Workspace Resource Isolation with Switched Workspaces", () => {
    it("should strictly scope resources when a user switches between workspaces", async () => {
      // Alice creates a personal workspace and switches to it
      const pRes = await request(app)
        .post("/api/workspaces")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ name: "Alice Personal", type: "personal" });

      const personalId = pRes.body.data.workspace.id;

      const switchRes = await request(app)
        .post("/api/workspaces/switch")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ workspaceId: personalId });

      const personalToken = switchRes.body.data.token;

      // Alice creates a resource in her personal workspace
      const createPersonalRes = await request(app)
        .post("/api/resources")
        .set("Authorization", `Bearer ${personalToken}`)
        .send({ name: "Personal VPS", unit: "instance-month", price: "15.00" });

      assert.equal(createPersonalRes.status, 201);
      const personalResourceId = createPersonalRes.body.data.resource._id;

      // Alice switches back to her organization workspace
      const switchBackRes = await request(app)
        .post("/api/workspaces/switch")
        .set("Authorization", `Bearer ${personalToken}`)
        .send({ workspaceId: orgAId });

      const orgToken = switchBackRes.body.data.token;

      // When listing resources in org context, personal resource must NOT appear
      const orgResourcesList = await request(app)
        .get("/api/resources")
        .set("Authorization", `Bearer ${orgToken}`);

      assert.equal(orgResourcesList.body.data.resources.length, 0);

      // Attempting to fetch personal resource with org token returns 404
      const getPersonalFromOrg = await request(app)
        .get(`/api/resources/${personalResourceId}`)
        .set("Authorization", `Bearer ${orgToken}`);

      assert.equal(getPersonalFromOrg.status, 404);
    });
  });
});
