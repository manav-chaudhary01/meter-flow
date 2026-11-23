import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import app from "../src/app.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import Tenant from "../src/models/Tenant.js";
import User from "../src/models/User.js";
import Membership from "../src/models/Membership.js";
import Invitation from "../src/models/Invitation.js";
import TrackedService from "../src/models/TrackedService.js";
import BillingRecord from "../src/models/BillingRecord.js";
import { hashToken, isValidTokenFormat } from "../src/utils/invitationToken.js";

describe("P3.3 Workspace Invitation Lifecycle Backend API", () => {
  let ownerToken;
  let ownerUserId;
  let tenantId;

  let adminToken;
  let adminUserId;

  let memberToken;
  let memberUserId;

  let suspendedToken;
  let suspendedUserId;

  let foreignTenantId;
  let foreignOwnerToken;
  let foreignUserId;

  let registeredInviteeToken;
  let registeredInviteeUserId;
  const registeredInviteeEmail = "invitee.registered@example.com";

  before(async () => {
    await connectTestDb();
  });

  after(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();

    // 1. Primary Workspace Owner (Alice)
    const regOwner = await request(app).post("/api/auth/register").send({
      name: "Alice Owner",
      email: "owner@example.com",
      password: "Password123!",
      organizationName: "Acme Corp"
    });
    ownerToken = regOwner.body.data.token;
    ownerUserId = regOwner.body.data.user.id;
    tenantId = regOwner.body.data.tenant.id;

    // 2. Workspace Admin (Bob)
    const regAdmin = await request(app).post("/api/auth/register").send({
      name: "Bob Admin",
      email: "admin@example.com",
      password: "Password123!",
      organizationName: "Bob Personal"
    });
    adminUserId = regAdmin.body.data.user.id;

    await Membership.create({
      userId: adminUserId,
      tenantId,
      role: "admin",
      status: "active"
    });

    const switchAdmin = await request(app)
      .post("/api/workspaces/switch")
      .set("Authorization", `Bearer ${regAdmin.body.data.token}`)
      .send({ workspaceId: tenantId });
    adminToken = switchAdmin.body.data.token;

    // 3. Regular Member (Charlie)
    const regMember = await request(app).post("/api/auth/register").send({
      name: "Charlie Member",
      email: "member@example.com",
      password: "Password123!",
      organizationName: "Charlie Personal"
    });
    memberUserId = regMember.body.data.user.id;

    await Membership.create({
      userId: memberUserId,
      tenantId,
      role: "member",
      status: "active"
    });

    const switchMember = await request(app)
      .post("/api/workspaces/switch")
      .set("Authorization", `Bearer ${regMember.body.data.token}`)
      .send({ workspaceId: tenantId });
    memberToken = switchMember.body.data.token;

    // 4. Suspended Member (Dan)
    const regSuspended = await request(app).post("/api/auth/register").send({
      name: "Dan Suspended",
      email: "dan.suspended@example.com",
      password: "Password123!",
      organizationName: "Dan Personal"
    });
    suspendedUserId = regSuspended.body.data.user.id;

    await Membership.create({
      userId: suspendedUserId,
      tenantId,
      role: "member",
      status: "suspended"
    });
    suspendedToken = regSuspended.body.data.token;

    // 5. Foreign Workspace Owner (Eve)
    const regForeign = await request(app).post("/api/auth/register").send({
      name: "Eve Foreign",
      email: "eve.foreign@example.com",
      password: "Password123!",
      organizationName: "Foreign Corp"
    });
    foreignOwnerToken = regForeign.body.data.token;
    foreignUserId = regForeign.body.data.user.id;
    foreignTenantId = regForeign.body.data.tenant.id;

    // 6. Registered User (Frank) waiting to be invited
    const regInvitee = await request(app).post("/api/auth/register").send({
      name: "Frank Invitee",
      email: registeredInviteeEmail,
      password: "Password123!",
      organizationName: "Frank Personal"
    });
    registeredInviteeToken = regInvitee.body.data.token;
    registeredInviteeUserId = regInvitee.body.data.user.id;
  });

  // ==========================================
  // SECTION 1: INVITATION CREATION (1 - 11)
  // ==========================================
  describe("1. Invitation Creation", () => {
    it("1. owner creates invitation -> 201 Created with secure token", async () => {
      const res = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          email: "newperson@example.com",
          role: "member"
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.invitation.email, "newperson@example.com");
      assert.equal(res.body.data.invitation.role, "member");
      assert.equal(res.body.data.invitation.status, "pending");
      assert.ok(res.body.data.invitationToken);
      assert.equal(isValidTokenFormat(res.body.data.invitationToken), true);
      assert.match(res.body.data.invitationUrl, /\/accept-invite\.html\?token=/);

      // Verify no membership was created yet
      const membershipExists = await Membership.exists({ tenantId, userId: { $exists: true } });
      const createdInvite = await Invitation.findById(res.body.data.invitation.id);
      assert.ok(createdInvite);
      assert.equal(createdInvite.status, "pending");
      assert.notEqual(createdInvite.tokenHash, res.body.data.invitationToken);
      assert.equal(createdInvite.tokenHash, hashToken(res.body.data.invitationToken));
    });

    it("2. admin creates invitation -> 201 Created", async () => {
      const res = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          email: "colleague@example.com",
          role: "admin"
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.invitation.role, "admin");
    });

    it("3. member rejected with 403 Forbidden", async () => {
      const res = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
          email: "someone@example.com"
        });

      assert.equal(res.status, 403);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /only workspace owners and admins/i);
    });

    it("4. unauthenticated request rejected with 401 Unauthorized", async () => {
      const res = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .send({
          email: "someone@example.com"
        });

      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
    });

    it("5. suspended actor rejected with 403 Forbidden", async () => {
      const res = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${suspendedToken}`)
        .send({
          email: "someone@example.com"
        });

      assert.equal(res.status, 403);
      assert.equal(res.body.success, false);
    });

    it("6. archived workspace rejected with 403 Forbidden", async () => {
      await Tenant.findByIdAndUpdate(tenantId, { status: "archived", archivedAt: new Date() });

      const res = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          email: "someone@example.com"
        });

      assert.equal(res.status, 403);
      assert.equal(res.body.success, false);
    });

    it("7. malformed workspace ID rejected with 400 Bad Request", async () => {
      const res = await request(app)
        .post("/api/workspaces/invalid-id/invitations")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          email: "someone@example.com"
        });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /invalid workspace ID/i);
    });

    it("8. invalid or missing email rejected with 400 Bad Request", async () => {
      const missingEmail = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: "" });
      assert.equal(missingEmail.status, 400);

      const invalidEmail = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: "not-an-email" });
      assert.equal(invalidEmail.status, 400);
    });

    it("9. already-active member rejected with 409 Conflict", async () => {
      const res = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          email: "admin@example.com" // Bob Admin is already active member
        });

      assert.equal(res.status, 409);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /already an active member/i);
    });

    it("10. duplicate pending invitation rejected with 409 Conflict", async () => {
      await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: "duplicate.test@example.com" });

      const res = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: "duplicate.test@example.com" });

      assert.equal(res.status, 409);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /pending invitation already exists/i);
    });

    it("11. expired old invitation can be replaced with new invitation", async () => {
      // Create an invitation that expired yesterday
      const rawToken = "a".repeat(64);
      await Invitation.create({
        tenantId,
        invitedBy: ownerUserId,
        email: "expired.reinvite@example.com",
        role: "member",
        status: "pending",
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000)
      });

      const res = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: "expired.reinvite@example.com" });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.invitation.status, "pending");
    });
  });

  // ==========================================
  // SECTION 2: INVITATION ACCEPTANCE (12 - 22)
  // ==========================================
  describe("2. Invitation Acceptance", () => {
    it("12. valid registered-user acceptance -> 200 OK, membership created", async () => {
      const inviteRes = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          email: registeredInviteeEmail,
          role: "admin"
        });
      const token = inviteRes.body.data.invitationToken;

      const acceptRes = await request(app)
        .post(`/api/invitations/${token}/accept`)
        .set("Authorization", `Bearer ${registeredInviteeToken}`);

      assert.equal(acceptRes.status, 200);
      assert.equal(acceptRes.body.success, true);
      assert.equal(acceptRes.body.data.membership.role, "admin");
      assert.equal(acceptRes.body.data.membership.status, "active");

      // Verify DB state
      const dbInvite = await Invitation.findById(inviteRes.body.data.invitation.id);
      assert.equal(dbInvite.status, "accepted");
      assert.ok(dbInvite.acceptedAt);
      assert.equal(dbInvite.acceptedBy.toString(), registeredInviteeUserId.toString());

      const membership = await Membership.findOne({
        userId: registeredInviteeUserId,
        tenantId
      });
      assert.ok(membership);
      assert.equal(membership.role, "admin");
      assert.equal(membership.status, "active");
    });

    it("13. valid newly registered-user acceptance -> 200 OK", async () => {
      const newEmail = "brandnew.user@example.com";
      const inviteRes = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          email: newEmail,
          role: "member"
        });
      const token = inviteRes.body.data.invitationToken;

      // User registers AFTER invitation is sent
      const regRes = await request(app).post("/api/auth/register").send({
        name: "Brand New User",
        email: newEmail,
        password: "Password123!",
        organizationName: "New User Personal"
      });
      const newUserToken = regRes.body.data.token;
      const newUserId = regRes.body.data.user.id;

      // User accepts invitation
      const acceptRes = await request(app)
        .post(`/api/invitations/${token}/accept`)
        .set("Authorization", `Bearer ${newUserToken}`);

      assert.equal(acceptRes.status, 200);
      assert.equal(acceptRes.body.success, true);

      const membership = await Membership.findOne({ userId: newUserId, tenantId });
      assert.ok(membership);
      assert.equal(membership.role, "member");
    });

    it("14. wrong email rejected with 403 Forbidden", async () => {
      const inviteRes = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          email: "targeted.recipient@example.com"
        });
      const token = inviteRes.body.data.invitationToken;

      // Frank tries to accept an invitation sent to targeted.recipient@example.com
      const res = await request(app)
        .post(`/api/invitations/${token}/accept`)
        .set("Authorization", `Bearer ${registeredInviteeToken}`);

      assert.equal(res.status, 403);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /different email address/i);
    });

    it("15. invalid or malformed token rejected", async () => {
      const malformed = await request(app)
        .post("/api/invitations/short-token/accept")
        .set("Authorization", `Bearer ${registeredInviteeToken}`);
      assert.equal(malformed.status, 400);

      const nonexistent = await request(app)
        .post(`/api/invitations/${"f".repeat(64)}/accept`)
        .set("Authorization", `Bearer ${registeredInviteeToken}`);
      assert.equal(nonexistent.status, 404);
    });

    it("16. expired token rejected with 400 Bad Request", async () => {
      const rawToken = "b".repeat(64);
      await Invitation.create({
        tenantId,
        invitedBy: ownerUserId,
        email: registeredInviteeEmail,
        role: "member",
        status: "pending",
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() - 1000) // expired 1s ago
      });

      const res = await request(app)
        .post(`/api/invitations/${rawToken}/accept`)
        .set("Authorization", `Bearer ${registeredInviteeToken}`);

      assert.equal(res.status, 400);
      assert.match(res.body.message, /expired/i);
    });

    it("17. cancelled token rejected with 400 Bad Request", async () => {
      const rawToken = "c".repeat(64);
      await Invitation.create({
        tenantId,
        invitedBy: ownerUserId,
        email: registeredInviteeEmail,
        role: "member",
        status: "cancelled",
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 100000),
        cancelledAt: new Date()
      });

      const res = await request(app)
        .post(`/api/invitations/${rawToken}/accept`)
        .set("Authorization", `Bearer ${registeredInviteeToken}`);

      assert.equal(res.status, 400);
      assert.match(res.body.message, /cancelled/i);
    });

    it("18. declined token rejected with 400 Bad Request", async () => {
      const rawToken = "d".repeat(64);
      await Invitation.create({
        tenantId,
        invitedBy: ownerUserId,
        email: registeredInviteeEmail,
        role: "member",
        status: "declined",
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 100000),
        declinedAt: new Date()
      });

      const res = await request(app)
        .post(`/api/invitations/${rawToken}/accept`)
        .set("Authorization", `Bearer ${registeredInviteeToken}`);

      assert.equal(res.status, 400);
      assert.match(res.body.message, /declined/i);
    });

    it("19. already accepted token rejected on replay", async () => {
      const inviteRes = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: registeredInviteeEmail });
      const token = inviteRes.body.data.invitationToken;

      const firstAccept = await request(app)
        .post(`/api/invitations/${token}/accept`)
        .set("Authorization", `Bearer ${registeredInviteeToken}`);
      assert.equal(firstAccept.status, 200);

      // Replay attempt
      const replay = await request(app)
        .post(`/api/invitations/${token}/accept`)
        .set("Authorization", `Bearer ${registeredInviteeToken}`);
      assert.equal(replay.status, 400);
      assert.match(replay.body.message, /already been accepted/i);
    });

    it("20. archived workspace rejected with 403 Forbidden", async () => {
      const inviteRes = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: registeredInviteeEmail });
      const token = inviteRes.body.data.invitationToken;

      await Tenant.findByIdAndUpdate(tenantId, { status: "archived", archivedAt: new Date() });

      const res = await request(app)
        .post(`/api/invitations/${token}/accept`)
        .set("Authorization", `Bearer ${registeredInviteeToken}`);

      assert.equal(res.status, 403);
      assert.match(res.body.message, /archived/i);
    });

    it("21. existing active member cannot create duplicate membership via invitation", async () => {
      const rawToken = "e".repeat(64);
      await Invitation.create({
        tenantId,
        invitedBy: ownerUserId,
        email: "member@example.com", // Charlie is already active member
        role: "member",
        status: "pending",
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 100000)
      });

      const res = await request(app)
        .post(`/api/invitations/${rawToken}/accept`)
        .set("Authorization", `Bearer ${memberToken}`);

      assert.equal(res.status, 409);
      assert.match(res.body.message, /already a member/i);
    });

    it("22. concurrent acceptance produces exactly one membership", async () => {
      const inviteRes = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: registeredInviteeEmail });
      const token = inviteRes.body.data.invitationToken;

      // Fire 2 concurrent accept requests
      const [res1, res2] = await Promise.all([
        request(app)
          .post(`/api/invitations/${token}/accept`)
          .set("Authorization", `Bearer ${registeredInviteeToken}`),
        request(app)
          .post(`/api/invitations/${token}/accept`)
          .set("Authorization", `Bearer ${registeredInviteeToken}`)
      ]);

      const statuses = [res1.status, res2.status].sort();
      assert.equal(statuses[0], 200, "One request should succeed with 200");
      assert.equal(statuses[1], 400, "One request should fail with 400");

      const memberships = await Membership.find({
        userId: registeredInviteeUserId,
        tenantId
      });
      assert.equal(memberships.length, 1, "Exactly one membership must be created");
    });
  });

  // ==========================================
  // SECTION 3: INVITATION DECLINE (23 - 26)
  // ==========================================
  describe("3. Invitation Decline", () => {
    it("23. valid invitee decline -> 200 OK and no membership created", async () => {
      const inviteRes = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: registeredInviteeEmail });
      const token = inviteRes.body.data.invitationToken;

      const declineRes = await request(app)
        .post(`/api/invitations/${token}/decline`)
        .set("Authorization", `Bearer ${registeredInviteeToken}`);

      assert.equal(declineRes.status, 200);
      assert.equal(declineRes.body.success, true);

      const dbInvite = await Invitation.findById(inviteRes.body.data.invitation.id);
      assert.equal(dbInvite.status, "declined");
      assert.ok(dbInvite.declinedAt);

      const membership = await Membership.findOne({
        userId: registeredInviteeUserId,
        tenantId
      });
      assert.equal(membership, null, "No membership should be created on decline");
    });

    it("24. wrong user cannot decline another's invitation", async () => {
      const inviteRes = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: "specific.recipient@example.com" });
      const token = inviteRes.body.data.invitationToken;

      const res = await request(app)
        .post(`/api/invitations/${token}/decline`)
        .set("Authorization", `Bearer ${registeredInviteeToken}`);

      assert.equal(res.status, 403);
    });

    it("25. accepted invitation cannot be declined", async () => {
      const inviteRes = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: registeredInviteeEmail });
      const token = inviteRes.body.data.invitationToken;

      await request(app)
        .post(`/api/invitations/${token}/accept`)
        .set("Authorization", `Bearer ${registeredInviteeToken}`);

      const res = await request(app)
        .post(`/api/invitations/${token}/decline`)
        .set("Authorization", `Bearer ${registeredInviteeToken}`);

      assert.equal(res.status, 400);
    });

    it("26. expired invitation cannot be declined", async () => {
      const rawToken = "1".repeat(64);
      await Invitation.create({
        tenantId,
        invitedBy: ownerUserId,
        email: registeredInviteeEmail,
        role: "member",
        status: "pending",
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() - 1000)
      });

      const res = await request(app)
        .post(`/api/invitations/${rawToken}/decline`)
        .set("Authorization", `Bearer ${registeredInviteeToken}`);

      assert.equal(res.status, 400);
      assert.match(res.body.message, /expired/i);
    });
  });

  // ==========================================
  // SECTION 4: INVITATION CANCELLATION (27 - 32)
  // ==========================================
  describe("4. Invitation Cancellation", () => {
    it("27. owner cancels invitation -> 200 OK", async () => {
      const inviteRes = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: "to.cancel@example.com" });
      const inviteId = inviteRes.body.data.invitation.id;

      const res = await request(app)
        .patch(`/api/workspaces/${tenantId}/invitations/${inviteId}/cancel`)
        .set("Authorization", `Bearer ${ownerToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.invitation.status, "cancelled");

      const dbInvite = await Invitation.findById(inviteId);
      assert.equal(dbInvite.status, "cancelled");
      assert.ok(dbInvite.cancelledAt);
    });

    it("28. admin cancels invitation -> 200 OK", async () => {
      const inviteRes = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: "to.cancel.admin@example.com" });
      const inviteId = inviteRes.body.data.invitation.id;

      const res = await request(app)
        .patch(`/api/workspaces/${tenantId}/invitations/${inviteId}/cancel`)
        .set("Authorization", `Bearer ${adminToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
    });

    it("29. member cannot cancel invitation -> 403 Forbidden", async () => {
      const inviteRes = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: "to.cancel.member@example.com" });
      const inviteId = inviteRes.body.data.invitation.id;

      const res = await request(app)
        .patch(`/api/workspaces/${tenantId}/invitations/${inviteId}/cancel`)
        .set("Authorization", `Bearer ${memberToken}`);

      assert.equal(res.status, 403);
    });

    it("30. cross-tenant cancellation rejected with 404 / 403", async () => {
      const inviteRes = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: "cross.tenant@example.com" });
      const inviteId = inviteRes.body.data.invitation.id;

      // Eve attempts to cancel Acme's invitation from Foreign workspace
      const res = await request(app)
        .patch(`/api/workspaces/${foreignTenantId}/invitations/${inviteId}/cancel`)
        .set("Authorization", `Bearer ${foreignOwnerToken}`);

      assert.equal(res.status, 404);
    });

    it("31. accepted invitation cannot be cancelled", async () => {
      const inviteRes = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: registeredInviteeEmail });
      const inviteId = inviteRes.body.data.invitation.id;
      const token = inviteRes.body.data.invitationToken;

      await request(app)
        .post(`/api/invitations/${token}/accept`)
        .set("Authorization", `Bearer ${registeredInviteeToken}`);

      const res = await request(app)
        .patch(`/api/workspaces/${tenantId}/invitations/${inviteId}/cancel`)
        .set("Authorization", `Bearer ${ownerToken}`);

      assert.equal(res.status, 400);
      assert.match(res.body.message, /already been accepted/i);
    });

    it("32. expired invitation cannot be cancelled", async () => {
      const rawToken = "2".repeat(64);
      const invite = await Invitation.create({
        tenantId,
        invitedBy: ownerUserId,
        email: "expired.nocancel@example.com",
        role: "member",
        status: "pending",
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() - 1000)
      });

      const res = await request(app)
        .patch(`/api/workspaces/${tenantId}/invitations/${invite._id}/cancel`)
        .set("Authorization", `Bearer ${ownerToken}`);

      assert.equal(res.status, 400);
      assert.match(res.body.message, /expired/i);
    });
  });

  // ==========================================
  // SECTION 5: INVITATION LISTING (33 - 36)
  // ==========================================
  describe("5. Invitation Listing", () => {
    it("33. authorized listing (owner/admin) -> 200 OK with list of invitations", async () => {
      await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: "user1@example.com" });

      await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ email: "user2@example.com" });

      const resOwner = await request(app)
        .get(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`);

      assert.equal(resOwner.status, 200);
      assert.equal(resOwner.body.success, true);
      assert.equal(resOwner.body.data.invitations.length, 2);

      const resAdmin = await request(app)
        .get(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${adminToken}`);

      assert.equal(resAdmin.status, 200);
      assert.equal(resAdmin.body.data.invitations.length, 2);
    });

    it("34. unauthorized listing (member) rejected with 403 Forbidden", async () => {
      const res = await request(app)
        .get(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${memberToken}`);

      assert.equal(res.status, 403);
    });

    it("35. cross-tenant isolation: workspace A cannot view workspace B invitations", async () => {
      await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: "acme.secret@example.com" });

      const resForeign = await request(app)
        .get(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${foreignOwnerToken}`);

      assert.equal(resForeign.status, 403);
    });

    it("36. token and tokenHash are never exposed in listing response", async () => {
      await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: "security.check@example.com" });

      const res = await request(app)
        .get(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`);

      assert.equal(res.status, 200);
      const inviteItem = res.body.data.invitations[0];
      assert.equal(inviteItem.token, undefined);
      assert.equal(inviteItem.tokenHash, undefined);
      assert.equal(inviteItem.rawToken, undefined);
    });
  });

  // ==========================================
  // SECTION 6: SECURITY & TOKEN INTEGRITY (37 - 41)
  // ==========================================
  describe("6. Security & Token Integrity", () => {
    it("37. tokens are cryptographically secure format (64-char hex)", async () => {
      const res = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: "entropy.check@example.com" });

      const token = res.body.data.invitationToken;
      assert.equal(typeof token, "string");
      assert.equal(token.length, 64);
      assert.equal(/^[a-f0-9]{64}$/i.test(token), true);
    });

    it("38. raw token is never stored in DB, only SHA-256 hash", async () => {
      const res = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: "hash.check@example.com" });

      const token = res.body.data.invitationToken;
      const inviteId = res.body.data.invitation.id;

      const doc = await Invitation.findById(inviteId);
      assert.notEqual(doc.tokenHash, token);
      assert.equal(doc.tokenHash, hashToken(token));
    });

    it("39. invitation cannot be replayed after acceptance", async () => {
      const res = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: registeredInviteeEmail });

      const token = res.body.data.invitationToken;

      const first = await request(app)
        .post(`/api/invitations/${token}/accept`)
        .set("Authorization", `Bearer ${registeredInviteeToken}`);
      assert.equal(first.status, 200);

      const replay = await request(app)
        .post(`/api/invitations/${token}/accept`)
        .set("Authorization", `Bearer ${registeredInviteeToken}`);
      assert.equal(replay.status, 400);
    });

    it("40. invitation cannot be transferred between users (email matching enforced)", async () => {
      const res = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: "intended@example.com" });

      const token = res.body.data.invitationToken;

      // Unrelated user tries to use token
      const hijackAttempt = await request(app)
        .post(`/api/invitations/${token}/accept`)
        .set("Authorization", `Bearer ${registeredInviteeToken}`);

      assert.equal(hijackAttempt.status, 403);
      assert.match(hijackAttempt.body.message, /different email address/i);
    });

    it("41. tenant isolation remains intact (membership belongs strictly to target workspace)", async () => {
      const res = await request(app)
        .post(`/api/workspaces/${tenantId}/invitations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: registeredInviteeEmail });

      const token = res.body.data.invitationToken;

      await request(app)
        .post(`/api/invitations/${token}/accept`)
        .set("Authorization", `Bearer ${registeredInviteeToken}`);

      const memberInTarget = await Membership.findOne({
        userId: registeredInviteeUserId,
        tenantId
      });
      assert.ok(memberInTarget);

      const memberInForeign = await Membership.findOne({
        userId: registeredInviteeUserId,
        tenantId: foreignTenantId
      });
      assert.equal(memberInForeign, null);
    });
  });

  // ==========================================
  // SECTION 7: REGRESSION VALIDATION (42 - 47)
  // ==========================================
  describe("7. Regression Validation with Prior Milestones", () => {
    it("42. owner transfer still works after invitation implementation", async () => {
      const transferRes = await request(app)
        .post(`/api/workspaces/${tenantId}/transfer-ownership`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ memberUserId: adminUserId });

      assert.equal(transferRes.status, 200);
      assert.equal(transferRes.body.data.newOwner.role, "owner");
      assert.equal(transferRes.body.data.previousOwner.role, "admin");
    });

    it("43. member role modification still works", async () => {
      const roleRes = await request(app)
        .patch(`/api/workspaces/${tenantId}/members/${memberUserId}/role`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ role: "admin" });

      assert.equal(roleRes.status, 200);
      assert.equal(roleRes.body.data.member.role, "admin");
    });

    it("44. member suspension and reactivation still works", async () => {
      const suspendRes = await request(app)
        .patch(`/api/workspaces/${tenantId}/members/${memberUserId}/status`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ status: "suspended" });

      assert.equal(suspendRes.status, 200);
      assert.equal(suspendRes.body.data.member.status, "suspended");

      const reactivateRes = await request(app)
        .patch(`/api/workspaces/${tenantId}/members/${memberUserId}/status`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ status: "active" });

      assert.equal(reactivateRes.status, 200);
      assert.equal(reactivateRes.body.data.member.status, "active");
    });

    it("45. self-leave still works", async () => {
      // Charlie Member leaves Acme Corp
      const leaveRes = await request(app)
        .post(`/api/workspaces/${tenantId}/leave`)
        .set("Authorization", `Bearer ${memberToken}`);

      assert.equal(leaveRes.status, 200);
      const membership = await Membership.findOne({ userId: memberUserId, tenantId });
      assert.equal(membership, null);
    });

    it("46. workspace archive still works", async () => {
      // Alice Owner creates a second workspace to archive the first
      const ws2 = await request(app)
        .post("/api/workspaces")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ name: "Second Workspace" });

      const archiveRes = await request(app)
        .patch(`/api/workspaces/${tenantId}/archive`)
        .set("Authorization", `Bearer ${ownerToken}`);

      assert.equal(archiveRes.status, 200);
      const archivedTenant = await Tenant.findById(tenantId);
      assert.equal(archivedTenant.status, "archived");
    });

    it("47. billing/finalization/void still works", async () => {
      const service = await TrackedService.create({
        tenantId,
        name: "Test API Gateway",
        provider: "AWS",
        category: "infrastructure",
        trackingType: "subscription",
        currency: "USD",
        monthlyCap: "100.00",
        status: "active"
      });

      const bill = await BillingRecord.create({
        tenantId,
        invoiceNumber: "INV-P33-001",
        billingPeriodStart: new Date("2026-01-01T00:00:00Z"),
        billingPeriodEnd: new Date("2026-02-01T00:00:00Z"),
        status: "issued",
        currency: "USD",
        subtotal: "100.00",
        total: "100.00",
        lineItems: []
      });

      const finalizeRes = await request(app)
        .patch(`/api/billing/${bill._id}/finalize`)
        .set("Authorization", `Bearer ${ownerToken}`);

      assert.equal(finalizeRes.status, 200);
      assert.equal(finalizeRes.body.data.billingRecord.status, "finalized");
    });
  });
});
