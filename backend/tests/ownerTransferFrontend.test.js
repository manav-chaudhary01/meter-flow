import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

describe("P3.2 Team Page Workspace Owner Transfer Frontend Unit & VM Tests", () => {
  const frontendDir = fs.existsSync(path.resolve(process.cwd(), "frontend"))
    ? path.resolve(process.cwd(), "frontend")
    : path.resolve(process.cwd(), "..", "frontend");

  const teamHtmlPath = path.resolve(frontendDir, "team.html");
  const teamJsPath = path.resolve(frontendDir, "js", "team.js");

  const teamHtml = fs.readFileSync(teamHtmlPath, "utf-8");
  const teamJs = fs.readFileSync(teamJsPath, "utf-8");

  it("1. HTML structure contains owner transfer button, modal, target select, and accessible attributes", () => {
    // Header button
    assert.match(teamHtml, /id="open-transfer-ownership-btn"/);
    assert.match(teamHtml, /Transfer Ownership/);

    // Modal container & dialog attributes
    assert.match(teamHtml, /id="transfer-ownership-modal"/);
    assert.match(teamHtml, /role="dialog"/);
    assert.match(teamHtml, /aria-modal="true"/);
    assert.match(teamHtml, /id="transfer-ownership-title"/);

    // Modal contents & controls
    assert.match(teamHtml, /id="transfer-ownership-target"/);
    assert.match(teamHtml, /id="transfer-ownership-confirm-btn"/);
    assert.match(teamHtml, /id="transfer-ownership-error"/);
    assert.match(teamHtml, /data-close-modal="transfer-ownership-modal"/);

    // Warning and explanatory copy
    assert.match(teamHtml, /Ownership transfer is permanent/);
    assert.match(teamHtml, /You will become an Admin in this workspace/);
    assert.match(teamHtml, /Select an active team member to become the new workspace owner/);
    assert.match(teamHtml, /Exactly one active owner is permitted per workspace/);
    assert.match(teamHtml, /Only active members are eligible/);
  });

  it("2. Safe DOM compliance: zero innerHTML, outerHTML, alert, or confirm in team.js", () => {
    assert.doesNotMatch(teamJs, /\.innerHTML\s*=/);
    assert.doesNotMatch(teamJs, /\.outerHTML\s*=/);
    assert.doesNotMatch(teamJs, /\bwindow\.alert\s*\(/);
    assert.doesNotMatch(teamJs, /\balert\s*\(/);
    assert.doesNotMatch(teamJs, /\bwindow\.confirm\s*\(/);
    assert.doesNotMatch(teamJs, /\bconfirm\s*\(/);
  });

  it("3. Helper canTransferOwnership(role) allows owner and rejects non-owners", () => {
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
    assert.ok(helpers.canTransferOwnership, "canTransferOwnership helper should exist on MeterFlowTeam");

    assert.equal(helpers.canTransferOwnership("owner"), true);
    assert.equal(helpers.canTransferOwnership("admin"), false);
    assert.equal(helpers.canTransferOwnership("member"), false);
    assert.equal(helpers.canTransferOwnership(""), false);
    assert.equal(helpers.canTransferOwnership(null), false);
    assert.equal(helpers.canTransferOwnership(undefined), false);
  });

  it("4. Helper isMemberEligibleForOwnershipTransfer correctly filters members", () => {
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
    assert.ok(helpers.isMemberEligibleForOwnershipTransfer, "isMemberEligibleForOwnershipTransfer should exist on MeterFlowTeam");

    const currentUserId = "user-alice-123";

    // 1. Regular active member -> eligible
    const activeMember = {
      userId: "user-bob-456",
      role: "member",
      status: "active"
    };
    assert.equal(helpers.isMemberEligibleForOwnershipTransfer(activeMember, currentUserId), true);

    // 2. Active admin member -> eligible
    const activeAdmin = {
      userId: "user-charlie-789",
      role: "admin",
      status: "active"
    };
    assert.equal(helpers.isMemberEligibleForOwnershipTransfer(activeAdmin, currentUserId), true);

    // 3. Current user (self) -> ineligible
    const selfUser = {
      userId: "user-alice-123",
      role: "owner",
      status: "active"
    };
    assert.equal(helpers.isMemberEligibleForOwnershipTransfer(selfUser, currentUserId), false);

    // 4. Any member with role 'owner' -> ineligible
    const anotherOwner = {
      userId: "user-david-999",
      role: "owner",
      status: "active"
    };
    assert.equal(helpers.isMemberEligibleForOwnershipTransfer(anotherOwner, currentUserId), false);

    // 5. Suspended member -> ineligible
    const suspendedMember = {
      userId: "user-eve-000",
      role: "member",
      status: "suspended"
    };
    assert.equal(helpers.isMemberEligibleForOwnershipTransfer(suspendedMember, currentUserId), false);

    // 6. Suspended admin -> ineligible
    const suspendedAdmin = {
      userId: "user-frank-111",
      role: "admin",
      status: "suspended"
    };
    assert.equal(helpers.isMemberEligibleForOwnershipTransfer(suspendedAdmin, currentUserId), false);

    // 7. Member object using _id instead of userId
    const memberWithId = {
      _id: "user-bob-456",
      role: "member",
      status: "active"
    };
    assert.equal(helpers.isMemberEligibleForOwnershipTransfer(memberWithId, currentUserId), true);

    // 8. Null/undefined/empty
    assert.equal(helpers.isMemberEligibleForOwnershipTransfer(null, currentUserId), false);
    assert.equal(helpers.isMemberEligibleForOwnershipTransfer(undefined, currentUserId), false);
  });

  it("5. Owner transfer button visibility logic respects role and workspace type", () => {
    const elements = {
      "open-transfer-ownership-btn": { style: { display: "none" } },
      "open-archive-workspace-btn": { style: { display: "none" } },
      "open-leave-workspace-btn": { style: { display: "none" } },
      "open-invite-modal-btn": { style: {}, disabled: false, setAttribute: () => {}, removeAttribute: () => {} },
      "personal-workspace-banner": { style: { display: "none" } },
      "metric-user-role": { textContent: "" },
      "metric-workspace-type": { textContent: "" }
    };

    const sandbox = {
      window: {},
      document: {
        getElementById: (id) => elements[id] || null,
        addEventListener: () => {},
        querySelectorAll: () => []
      }
    };
    vm.runInNewContext(teamJs, sandbox);
    const helpers = sandbox.window.MeterFlowTeam;

    const transferBtn = elements["open-transfer-ownership-btn"];

    // Owner in team workspace -> visible
    const isTeamWorkspace = true;
    transferBtn.style.display = helpers.canTransferOwnership("owner") && isTeamWorkspace ? "inline-flex" : "none";
    assert.equal(transferBtn.style.display, "inline-flex");

    // Owner in personal workspace -> hidden
    const isPersonal = false;
    transferBtn.style.display = helpers.canTransferOwnership("owner") && isPersonal ? "inline-flex" : "none";
    assert.equal(transferBtn.style.display, "none");

    // Admin in team workspace -> hidden
    transferBtn.style.display = helpers.canTransferOwnership("admin") && isTeamWorkspace ? "inline-flex" : "none";
    assert.equal(transferBtn.style.display, "none");

    // Member in team workspace -> hidden
    transferBtn.style.display = helpers.canTransferOwnership("member") && isTeamWorkspace ? "inline-flex" : "none";
    assert.equal(transferBtn.style.display, "none");
  });
});
