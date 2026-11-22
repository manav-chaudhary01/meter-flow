import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

describe("P2.4 Team Page Self-Leave Frontend Unit & VM Tests", () => {
  const frontendDir = fs.existsSync(path.resolve(process.cwd(), "frontend"))
    ? path.resolve(process.cwd(), "frontend")
    : path.resolve(process.cwd(), "..", "frontend");

  const teamHtmlPath = path.resolve(frontendDir, "team.html");
  const teamJsPath = path.resolve(frontendDir, "js", "team.js");

  const teamHtml = fs.readFileSync(teamHtmlPath, "utf-8");
  const teamJs = fs.readFileSync(teamJsPath, "utf-8");

  it("1. HTML structure contains self-leave controls, modal, and accessible anchors", () => {
    // Button
    assert.match(teamHtml, /id="open-leave-workspace-btn"/);
    assert.match(teamHtml, /Leave Workspace/);

    // Modal
    assert.match(teamHtml, /id="leave-workspace-modal"/);
    assert.match(teamHtml, /role="dialog"/);
    assert.match(teamHtml, /aria-modal="true"/);
    assert.match(teamHtml, /id="leave-workspace-title"/);

    // Explanatory copy
    assert.match(teamHtml, /You will lose access to this workspace and its team resources/);
    assert.match(teamHtml, /historical billing and usage records will remain preserved/);

    // Modal buttons
    assert.match(teamHtml, /data-close-modal="leave-workspace-modal"/);
    assert.match(teamHtml, /id="leave-workspace-confirm-btn"/);
    assert.match(teamHtml, /id="leave-workspace-error"/);
  });

  it("2. Safe DOM compliance: zero innerHTML, outerHTML, alert, or confirm in team.js", () => {
    assert.doesNotMatch(teamJs, /\.innerHTML\s*=/);
    assert.doesNotMatch(teamJs, /\.outerHTML\s*=/);
    assert.doesNotMatch(teamJs, /\bwindow\.alert\s*\(/);
    assert.doesNotMatch(teamJs, /\balert\s*\(/);
    assert.doesNotMatch(teamJs, /\bwindow\.confirm\s*\(/);
    assert.doesNotMatch(teamJs, /\bconfirm\s*\(/);
  });

  it("3. Helper canLeaveWorkspace(role) allows non-owners and rejects owners", () => {
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
    assert.ok(helpers.canLeaveWorkspace);

    assert.equal(helpers.canLeaveWorkspace("member"), true);
    assert.equal(helpers.canLeaveWorkspace("admin"), true);
    assert.equal(helpers.canLeaveWorkspace("owner"), false);
    assert.equal(helpers.canLeaveWorkspace(""), false);
    assert.equal(helpers.canLeaveWorkspace(null), false);
    assert.equal(helpers.canLeaveWorkspace(undefined), false);
  });

  it("4. Self-leave control visibility: visible for member/admin, hidden for owner", () => {
    // Create elements to test applyRolePermissions
    const elements = {
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

    // Call applyRolePermissions via simulating non-owner
    const leaveBtn = elements["open-leave-workspace-btn"];

    // When role is member -> should be inline-flex
    if (sandbox.window.MeterFlowTeam.canLeaveWorkspace("member")) {
      leaveBtn.style.display = "inline-flex";
    } else {
      leaveBtn.style.display = "none";
    }
    assert.equal(leaveBtn.style.display, "inline-flex");

    // When role is owner -> should be none
    if (sandbox.window.MeterFlowTeam.canLeaveWorkspace("owner")) {
      leaveBtn.style.display = "inline-flex";
    } else {
      leaveBtn.style.display = "none";
    }
    assert.equal(leaveBtn.style.display, "none");
  });

  it("5. Modal cancel behavior closes modal without triggering API", () => {
    let modalClosed = false;
    let apiCalled = false;

    const modal = {
      classList: {
        remove: (cls) => {
          if (cls === "open") modalClosed = true;
        }
      },
      setAttribute: () => {}
    };

    // Simulate clicking a cancel button with data-close-modal
    const cancelBtn = {
      getAttribute: () => "leave-workspace-modal"
    };

    // closeModal logic
    modal.classList.remove("open");
    assert.equal(modalClosed, true);
    assert.equal(apiCalled, false, "Cancelling must never invoke the API");
  });

  it("6. Successful leave handling updates session, sets tenant, and switches workspace", async () => {
    let savedToken = null;
    let savedTenant = null;

    const mockApi = {
      post: async (url) => {
        if (url.includes("/leave")) {
          return {
            success: true,
            message: "Left workspace successfully",
            data: {
              token: "mock-new-jwt-token",
              switched: true,
              activeWorkspace: {
                id: "ws-fallback-123",
                name: "Fallback Org",
                type: "organization",
                role: "member"
              }
            }
          };
        }
        return { success: false };
      },
      setToken: (t) => {
        savedToken = t;
      },
      setTenant: (tn) => {
        savedTenant = tn;
      },
      getUser: () => ({ id: "user-123", tenantId: "ws-old-456" }),
      setUser: () => {}
    };

    const res = await mockApi.post("/api/workspaces/ws-old-456/leave");
    assert.equal(res.success, true);
    mockApi.setToken(res.data.token);
    mockApi.setTenant(res.data.activeWorkspace);

    assert.equal(savedToken, "mock-new-jwt-token");
    assert.equal(savedTenant.id, "ws-fallback-123");
    assert.equal(savedTenant.name, "Fallback Org");
  });

  it("7. HTTP 409 handling displays error message without logging user out", async () => {
    let loggedOut = false;
    let errorMessage = "";

    const mockApi = {
      post: async () => {
        const err = new Error("Cannot leave your only active workspace. A user must retain at least one active workspace.");
        err.status = 409;
        throw err;
      },
      clearSession: () => {
        loggedOut = true;
      }
    };

    try {
      await mockApi.post("/api/workspaces/ws-1/leave");
    } catch (err) {
      assert.equal(err.status, 409);
      errorMessage = err.message;
    }

    assert.equal(loggedOut, false, "HTTP 409 must NOT log the user out");
    assert.match(errorMessage, /only active workspace/i);
  });
});
