import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

describe("P3.3 Team Page & Accept Invite Frontend Unit & VM Tests", () => {
  const frontendDir = fs.existsSync(path.resolve(process.cwd(), "frontend"))
    ? path.resolve(process.cwd(), "frontend")
    : path.resolve(process.cwd(), "..", "frontend");

  const teamHtmlPath = path.resolve(frontendDir, "team.html");
  const teamJsPath = path.resolve(frontendDir, "js", "team.js");
  const acceptInviteHtmlPath = path.resolve(frontendDir, "accept-invite.html");
  const acceptInviteJsPath = path.resolve(frontendDir, "js", "accept-invite.js");

  const teamHtml = fs.readFileSync(teamHtmlPath, "utf-8");
  const teamJs = fs.readFileSync(teamJsPath, "utf-8");
  const acceptInviteHtml = fs.readFileSync(acceptInviteHtmlPath, "utf-8");
  const acceptInviteJs = fs.readFileSync(acceptInviteJsPath, "utf-8");

  it("1. Team HTML contains updated invite terminology, modal, pending section, and cancel modal", () => {
    // Header invite button
    assert.match(teamHtml, /id="open-invite-modal-btn"/);
    assert.match(teamHtml, /\+ Invite Member/);

    // Invite Modal
    assert.match(teamHtml, /id="invite-member-modal"/);
    assert.match(teamHtml, /Invite Workspace Member/);
    assert.match(teamHtml, /id="invite-member-submit-btn"/);
    assert.match(teamHtml, /Send Invitation/);

    // Pending Invitations Card & Table
    assert.match(teamHtml, /id="pending-invitations-card"/);
    assert.match(teamHtml, /Pending Invitations/);
    assert.match(teamHtml, /id="invitations-table"/);
    assert.match(teamHtml, /id="invitations-table-body"/);
    assert.match(teamHtml, /id="invitations-count-badge"/);

    // Cancel Invitation Modal
    assert.match(teamHtml, /id="cancel-invitation-modal"/);
    assert.match(teamHtml, /id="cancel-invitation-confirm-btn"/);
    assert.match(teamHtml, /id="cancel-invitation-email"/);
  });

  it("2. Accept-Invite HTML contains accessible structure and action states", () => {
    // Container & Heading
    assert.match(acceptInviteHtml, /id="invite-heading"/);
    assert.match(acceptInviteHtml, /Workspace Invitation/);
    assert.match(acceptInviteHtml, /id="invite-details-container"/);

    // Alert banners
    assert.match(acceptInviteHtml, /id="invite-error-banner"/);
    assert.match(acceptInviteHtml, /id="invite-success-banner"/);
    assert.match(acceptInviteHtml, /id="invite-warning-banner"/);

    // Actions
    assert.match(acceptInviteHtml, /id="invite-actions-authenticated"/);
    assert.match(acceptInviteHtml, /id="accept-invite-btn"/);
    assert.match(acceptInviteHtml, /id="decline-invite-btn"/);

    assert.match(acceptInviteHtml, /id="invite-actions-unauthenticated"/);
    assert.match(acceptInviteHtml, /id="invite-login-link"/);
    assert.match(acceptInviteHtml, /id="invite-register-link"/);

    assert.match(acceptInviteHtml, /id="invite-actions-mismatched"/);
    assert.match(acceptInviteHtml, /id="switch-account-btn"/);

    assert.match(acceptInviteHtml, /id="invite-actions-terminal"/);
  });

  it("3. Safe DOM compliance: zero innerHTML, outerHTML, alert, or confirm across team.js and accept-invite.js", () => {
    assert.doesNotMatch(teamJs, /\.innerHTML\s*=/);
    assert.doesNotMatch(teamJs, /\.outerHTML\s*=/);
    assert.doesNotMatch(teamJs, /\bwindow\.alert\s*\(/);
    assert.doesNotMatch(teamJs, /\balert\s*\(/);
    assert.doesNotMatch(teamJs, /\bwindow\.confirm\s*\(/);
    assert.doesNotMatch(teamJs, /\bconfirm\s*\(/);

    assert.doesNotMatch(acceptInviteJs, /\.innerHTML\s*=/);
    assert.doesNotMatch(acceptInviteJs, /\.outerHTML\s*=/);
    assert.doesNotMatch(acceptInviteJs, /\bwindow\.alert\s*\(/);
    assert.doesNotMatch(acceptInviteJs, /\balert\s*\(/);
    assert.doesNotMatch(acceptInviteJs, /\bwindow\.confirm\s*\(/);
    assert.doesNotMatch(acceptInviteJs, /\bconfirm\s*\(/);
  });

  it("4. Helper canManageInvitations(role) in team.js allows owner and admin, rejects member", () => {
    const sandbox = {
      window: {},
      document: {
        getElementById: () => null,
        addEventListener: () => {},
        querySelectorAll: () => []
      }
    };
    vm.runInNewContext(teamJs, sandbox);
    const helpers = sandbox.window.MeterFlowTeam;
    assert.ok(helpers.canManageInvitations, "canManageInvitations helper should exist on MeterFlowTeam");

    assert.equal(helpers.canManageInvitations("owner"), true);
    assert.equal(helpers.canManageInvitations("admin"), true);
    assert.equal(helpers.canManageInvitations("member"), false);
    assert.equal(helpers.canManageInvitations(""), false);
    assert.equal(helpers.canManageInvitations(null), false);
    assert.equal(helpers.canManageInvitations(undefined), false);
  });

  it("5. Helper getTokenFromUrl(searchStr) in accept-invite.js correctly extracts token", () => {
    const sandbox = {
      window: {},
      URLSearchParams: globalThis.URLSearchParams,
      document: {
        getElementById: () => null,
        addEventListener: () => {}
      }
    };
    vm.runInNewContext(acceptInviteJs, sandbox);
    const helpers = sandbox.window.MeterFlowAcceptInvite;
    assert.ok(helpers.getTokenFromUrl, "getTokenFromUrl helper should exist on MeterFlowAcceptInvite");

    assert.equal(helpers.getTokenFromUrl("?token=abc12345"), "abc12345");
    assert.equal(helpers.getTokenFromUrl("?foo=bar&token=mytoken99&baz=qux"), "mytoken99");
    assert.equal(helpers.getTokenFromUrl("?token="), "");
    assert.equal(helpers.getTokenFromUrl(""), "");
    assert.equal(helpers.getTokenFromUrl(null), "");
  });

  it("6. Helper isMatchingUser(currentUserEmail, invitedEmail) handles email comparison safely", () => {
    const sandbox = {
      window: {},
      URLSearchParams: globalThis.URLSearchParams,
      document: {
        getElementById: () => null,
        addEventListener: () => {}
      }
    };
    vm.runInNewContext(acceptInviteJs, sandbox);
    const helpers = sandbox.window.MeterFlowAcceptInvite;

    assert.equal(helpers.isMatchingUser("user@example.com", "user@example.com"), true);
    assert.equal(helpers.isMatchingUser("USER@EXAMPLE.COM", "user@example.com"), true);
    assert.equal(helpers.isMatchingUser("  User@Example.Com  ", "user@example.com"), true);
    assert.equal(helpers.isMatchingUser("other@example.com", "user@example.com"), false);
    assert.equal(helpers.isMatchingUser("", "user@example.com"), false);
    assert.equal(helpers.isMatchingUser(null, "user@example.com"), false);
    assert.equal(helpers.isMatchingUser("user@example.com", null), false);
  });

  it("7. Helper getInvitationState(invitation, currentUser) evaluates state machine correctly", () => {
    const sandbox = {
      window: {},
      URLSearchParams: globalThis.URLSearchParams,
      document: {
        getElementById: () => null,
        addEventListener: () => {}
      }
    };
    vm.runInNewContext(acceptInviteJs, sandbox);
    const helpers = sandbox.window.MeterFlowAcceptInvite;

    const pendingInvite = {
      email: "invitee@example.com",
      status: "pending"
    };

    // Terminal status
    assert.equal(helpers.getInvitationState({ ...pendingInvite, status: "accepted" }, { email: "invitee@example.com" }), "terminal");
    assert.equal(helpers.getInvitationState({ ...pendingInvite, status: "declined" }, { email: "invitee@example.com" }), "terminal");
    assert.equal(helpers.getInvitationState({ ...pendingInvite, status: "expired" }, { email: "invitee@example.com" }), "terminal");
    assert.equal(helpers.getInvitationState({ ...pendingInvite, status: "cancelled" }, { email: "invitee@example.com" }), "terminal");

    // Unauthenticated
    assert.equal(helpers.getInvitationState(pendingInvite, null), "unauthenticated");
    assert.equal(helpers.getInvitationState(pendingInvite, {}), "unauthenticated");

    // Authenticated Match
    assert.equal(helpers.getInvitationState(pendingInvite, { email: "invitee@example.com" }), "authenticated_match");
    assert.equal(helpers.getInvitationState(pendingInvite, { email: "INVITEE@EXAMPLE.COM" }), "authenticated_match");

    // Mismatched Account
    assert.equal(helpers.getInvitationState(pendingInvite, { email: "different@example.com" }), "mismatched");

    // Invalid/null invitation
    assert.equal(helpers.getInvitationState(null, { email: "user@example.com" }), "error");
  });
});
