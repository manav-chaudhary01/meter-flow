import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";

describe("P1 Product Completeness — Workspace Creation & Team Member Management UI Integration", () => {
  let ownerToken;
  let ownerId;
  let orgWorkspaceId;

  let adminUserToken;
  let adminUserId;

  let regularMemberToken;
  let regularMemberId;

  let outsiderToken;
  let outsiderId;

  before(async () => {
    await connectTestDb();
  });

  after(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();

    // 1. Register Workspace Owner
    const regOwner = await request(app).post("/api/auth/register").send({
      name: "Owner User",
      email: "owner@example.com",
      password: "password123",
      organizationName: "Acme Production",
      workspaceType: "organization"
    });
    assert.equal(regOwner.status, 201);
    ownerToken = regOwner.body.data.token;
    ownerId = regOwner.body.data.user.id;
    orgWorkspaceId = regOwner.body.data.tenant.id;

    // 2. Register Candidate Admin User
    const regAdmin = await request(app).post("/api/auth/register").send({
      name: "Admin User",
      email: "admin@example.com",
      password: "password123",
      organizationName: "Admin Personal Org",
      workspaceType: "personal"
    });
    assert.equal(regAdmin.status, 201);
    adminUserToken = regAdmin.body.data.token;
    adminUserId = regAdmin.body.data.user.id;

    // 3. Register Candidate Regular Member
    const regMember = await request(app).post("/api/auth/register").send({
      name: "Regular Member",
      email: "member@example.com",
      password: "password123",
      organizationName: "Member Personal Org",
      workspaceType: "personal"
    });
    assert.equal(regMember.status, 201);
    regularMemberToken = regMember.body.data.token;
    regularMemberId = regMember.body.data.user.id;

    // 4. Register Candidate Outsider
    const regOutsider = await request(app).post("/api/auth/register").send({
      name: "Outsider User",
      email: "outsider@example.com",
      password: "password123",
      organizationName: "Outsider Org",
      workspaceType: "organization"
    });
    assert.equal(regOutsider.status, 201);
    outsiderToken = regOutsider.body.data.token;
    outsiderId = regOutsider.body.data.user.id;
  });

  describe("In-App Additional Workspace Creation Workflow", () => {
    it("owner creates a secondary organization workspace and immediately switches context", async () => {
      // Create new organization workspace
      const createRes = await request(app)
        .post("/api/workspaces")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          name: "Acme Staging",
          type: "organization"
        });

      assert.equal(createRes.status, 201);
      assert.equal(createRes.body.success, true);
      assert.equal(createRes.body.data.workspace.name, "Acme Staging");
      assert.equal(createRes.body.data.workspace.type, "organization");
      assert.equal(createRes.body.data.workspace.role, "owner");

      const stagingId = createRes.body.data.workspace.id;

      // Switch context to new workspace
      const switchRes = await request(app)
        .post("/api/workspaces/switch")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ workspaceId: stagingId });

      assert.equal(switchRes.status, 200);
      assert.equal(switchRes.body.success, true);
      assert.ok(switchRes.body.data.token);
      assert.equal(switchRes.body.data.workspace.id, stagingId);
      assert.equal(switchRes.body.data.workspace.name, "Acme Staging");

      // Verify member roster in the new workspace contains only the creator as owner
      const membersRes = await request(app)
        .get(`/api/workspaces/${stagingId}/members`)
        .set("Authorization", `Bearer ${switchRes.body.data.token}`);

      assert.equal(membersRes.status, 200);
      assert.equal(membersRes.body.data.members.length, 1);
      assert.equal(membersRes.body.data.members[0].role, "owner");
      assert.equal(membersRes.body.data.members[0].email, "owner@example.com");
    });

    it("enforces validation and single-personal-workspace limit during workspace creation", async () => {
      // 1. Missing name
      const res1 = await request(app)
        .post("/api/workspaces")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ name: "", type: "organization" });
      assert.equal(res1.status, 400);

      // 2. Name too short
      const res2 = await request(app)
        .post("/api/workspaces")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ name: "X", type: "organization" });
      assert.equal(res2.status, 400);

      // 3. Invalid workspace type
      const res3 = await request(app)
        .post("/api/workspaces")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ name: "Invalid Workspace", type: "enterprise" });
      assert.equal(res3.status, 400);

      // 4. Admin User already has a personal workspace from registration; creating second personal workspace must return 409
      const res4 = await request(app)
        .post("/api/workspaces")
        .set("Authorization", `Bearer ${adminUserToken}`)
        .send({ name: "Second Personal", type: "personal" });
      assert.equal(res4.status, 409);
      assert.match(res4.body.message, /already has a personal workspace/i);
    });
  });

  describe("Team Member Roster, Invites & Removals (RBAC)", () => {
    it("workspace owner invites an admin and a regular member to the organization", async () => {
      // 1. Initial roster has 1 member (the owner)
      const initialRoster = await request(app)
        .get(`/api/workspaces/${orgWorkspaceId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`);
      assert.equal(initialRoster.status, 200);
      assert.equal(initialRoster.body.data.members.length, 1);
      assert.equal(initialRoster.body.data.members[0].role, "owner");

      // 2. Owner invites adminUser as 'admin'
      const inviteAdminRes = await request(app)
        .post(`/api/workspaces/${orgWorkspaceId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          email: "admin@example.com",
          role: "admin"
        });
      assert.equal(inviteAdminRes.status, 201);
      assert.equal(inviteAdminRes.body.success, true);
      assert.equal(inviteAdminRes.body.data.member.role, "admin");
      assert.equal(inviteAdminRes.body.data.member.email, "admin@example.com");

      // 3. Owner invites regularMember as 'member'
      const inviteMemberRes = await request(app)
        .post(`/api/workspaces/${orgWorkspaceId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          email: "member@example.com",
          role: "member"
        });
      assert.equal(inviteMemberRes.status, 201);
      assert.equal(inviteMemberRes.body.data.member.role, "member");

      // 4. Verify updated roster has 3 members
      const updatedRoster = await request(app)
        .get(`/api/workspaces/${orgWorkspaceId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`);
      assert.equal(updatedRoster.status, 200);
      assert.equal(updatedRoster.body.data.members.length, 3);
      const roles = updatedRoster.body.data.members.map((m) => m.role);
      assert.ok(roles.includes("owner"));
      assert.ok(roles.includes("admin"));
      assert.ok(roles.includes("member"));
    });

    it("prevents inviting non-existent email, duplicate members, or members to personal workspaces", async () => {
      // 1. Non-existent email -> 404
      const resNotFound = await request(app)
        .post(`/api/workspaces/${orgWorkspaceId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: "doesnotexist@example.com", role: "member" });
      assert.equal(resNotFound.status, 404);
      assert.match(resNotFound.body.message, /user not found/i);

      // 2. Invite member once -> 201
      const resOk = await request(app)
        .post(`/api/workspaces/${orgWorkspaceId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: "member@example.com", role: "member" });
      assert.equal(resOk.status, 201);

      // 3. Duplicate invite -> 409
      const resDup = await request(app)
        .post(`/api/workspaces/${orgWorkspaceId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: "member@example.com", role: "member" });
      assert.equal(resDup.status, 409);
      assert.match(resDup.body.message, /already a member/i);

      // 4. Attempt to invite a member to a Personal Workspace -> 400
      // Create a personal workspace for owner
      const personalWsRes = await request(app)
        .post("/api/workspaces")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ name: "Owner Personal", type: "personal" });
      assert.equal(personalWsRes.status, 201);
      const personalWsId = personalWsRes.body.data.workspace.id;

      const resPersonalInvite = await request(app)
        .post(`/api/workspaces/${personalWsId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: "admin@example.com", role: "member" });
      assert.equal(resPersonalInvite.status, 400);
      assert.match(resPersonalInvite.body.message, /personal workspaces cannot have additional members/i);
    });

    it("enforces RBAC on member removal (owner removes admin, admin removes member, owner cannot be removed)", async () => {
      // Set up org with owner, admin, and member
      await request(app)
        .post(`/api/workspaces/${orgWorkspaceId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: "admin@example.com", role: "admin" });

      await request(app)
        .post(`/api/workspaces/${orgWorkspaceId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: "member@example.com", role: "member" });

      // Admin switches to the org workspace
      const adminSwitch = await request(app)
        .post("/api/workspaces/switch")
        .set("Authorization", `Bearer ${adminUserToken}`)
        .send({ workspaceId: orgWorkspaceId });
      assert.equal(adminSwitch.status, 200);
      const activeAdminToken = adminSwitch.body.data.token;

      // Regular member switches to the org workspace
      const memberSwitch = await request(app)
        .post("/api/workspaces/switch")
        .set("Authorization", `Bearer ${regularMemberToken}`)
        .send({ workspaceId: orgWorkspaceId });
      assert.equal(memberSwitch.status, 200);
      const activeMemberToken = memberSwitch.body.data.token;

      // 1. Regular member attempts to remove admin -> 403
      const memberRemovesAdmin = await request(app)
        .delete(`/api/workspaces/${orgWorkspaceId}/members/${adminUserId}`)
        .set("Authorization", `Bearer ${activeMemberToken}`);
      assert.equal(memberRemovesAdmin.status, 403);

      // 2. Admin attempts to remove workspace owner -> 403
      const adminRemovesOwner = await request(app)
        .delete(`/api/workspaces/${orgWorkspaceId}/members/${ownerId}`)
        .set("Authorization", `Bearer ${activeAdminToken}`);
      assert.equal(adminRemovesOwner.status, 403);
      assert.match(adminRemovesOwner.body.message, /cannot remove the workspace owner/i);

      // 3. Admin removes regular member -> 200 OK
      const adminRemovesMember = await request(app)
        .delete(`/api/workspaces/${orgWorkspaceId}/members/${regularMemberId}`)
        .set("Authorization", `Bearer ${activeAdminToken}`);
      assert.equal(adminRemovesMember.status, 200);
      assert.equal(adminRemovesMember.body.success, true);

      // 4. Owner removes admin -> 200 OK
      const ownerRemovesAdmin = await request(app)
        .delete(`/api/workspaces/${orgWorkspaceId}/members/${adminUserId}`)
        .set("Authorization", `Bearer ${ownerToken}`);
      assert.equal(ownerRemovesAdmin.status, 200);

      // 5. Final roster should only contain owner
      const finalRoster = await request(app)
        .get(`/api/workspaces/${orgWorkspaceId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`);
      assert.equal(finalRoster.body.data.members.length, 1);
      assert.equal(finalRoster.body.data.members[0].role, "owner");
    });

    it("denies access to member roster for non-members", async () => {
      const res = await request(app)
        .get(`/api/workspaces/${orgWorkspaceId}/members`)
        .set("Authorization", `Bearer ${outsiderToken}`);

      assert.equal(res.status, 403);
      assert.match(res.body.message, /access denied/i);
    });
  });

  describe("Frontend App Shell & Navigation Consistency", () => {
    it("all 6 authenticated screens serve valid HTML and link to /team in sidebar", async () => {
      const routes = ["/", "/services", "/usage", "/billing", "/budgets", "/team"];
      for (const route of routes) {
        const res = await request(app).get(route);
        assert.equal(res.status, 200, `Failed for route ${route}`);
        assert.match(res.text, /href="team\.html"/, `team.html link missing in sidebar for ${route}`);
        assert.match(res.text, /id="open-create-workspace-btn"/, `open-create-workspace-btn missing for ${route}`);
        assert.match(res.text, /id="create-workspace-modal"/, `create-workspace-modal missing for ${route}`);
      }
    });

    it("team.html has active class on Team navigation item", async () => {
      const res = await request(app).get("/team");
      assert.equal(res.status, 200);
      assert.match(res.text, /<a href="team\.html" class="nav-item active">/);
    });
  });
});
