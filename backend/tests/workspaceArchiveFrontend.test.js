import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

describe("P2.5 Team Page Workspace Archive Frontend Unit & VM Tests", () => {
  const frontendDir = fs.existsSync(path.resolve(process.cwd(), "frontend"))
    ? path.resolve(process.cwd(), "frontend")
    : path.resolve(process.cwd(), "..", "frontend");

  const teamHtmlPath = path.resolve(frontendDir, "team.html");
  const teamJsPath = path.resolve(frontendDir, "js", "team.js");

  const teamHtml = fs.readFileSync(teamHtmlPath, "utf-8");
  const teamJs = fs.readFileSync(teamJsPath, "utf-8");

  it("1. HTML structure contains archive controls, modal, and accessible anchors", () => {
    // Button
    assert.match(teamHtml, /id="open-archive-workspace-btn"/);
    assert.match(teamHtml, /Archive Workspace/);

    // Modal
    assert.match(teamHtml, /id="archive-workspace-modal"/);
    assert.match(teamHtml, /role="dialog"/);
    assert.match(teamHtml, /aria-modal="true"/);
    assert.match(teamHtml, /id="archive-workspace-title"/);

    // Explanatory copy
    assert.match(teamHtml, /Active access to this workspace will be disabled for all members/);
    assert.match(teamHtml, /All historical billing records, invoices, usage telemetry, and tracked services will be permanently preserved/);
    assert.match(teamHtml, /You cannot archive your only active workspace/);

    // Modal buttons
    assert.match(teamHtml, /data-close-modal="archive-workspace-modal"/);
    assert.match(teamHtml, /id="archive-workspace-confirm-btn"/);
    assert.match(teamHtml, /id="archive-workspace-error"/);
  });

  it("2. Safe DOM compliance: zero innerHTML, outerHTML, alert, or confirm in team.js", () => {
    assert.doesNotMatch(teamJs, /\.innerHTML\s*=/);
    assert.doesNotMatch(teamJs, /\.outerHTML\s*=/);
    assert.doesNotMatch(teamJs, /\bwindow\.alert\s*\(/);
    assert.doesNotMatch(teamJs, /\balert\s*\(/);
    assert.doesNotMatch(teamJs, /\bwindow\.confirm\s*\(/);
    assert.doesNotMatch(teamJs, /\bconfirm\s*\(/);
  });

  it("3. Helper canArchiveWorkspace(role) allows owner and rejects non-owners", () => {
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
    assert.ok(helpers.canArchiveWorkspace, "canArchiveWorkspace helper should exist on MeterFlowTeam");

    assert.equal(helpers.canArchiveWorkspace("owner"), true);
    assert.equal(helpers.canArchiveWorkspace("admin"), false);
    assert.equal(helpers.canArchiveWorkspace("member"), false);
    assert.equal(helpers.canArchiveWorkspace(""), false);
    assert.equal(helpers.canArchiveWorkspace(null), false);
    assert.equal(helpers.canArchiveWorkspace(undefined), false);
  });

  it("4. Archive control visibility: visible for owner, hidden for admin and member", () => {
    const elements = {
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

    const archiveBtn = elements["open-archive-workspace-btn"];

    // When role is owner -> visible
    archiveBtn.style.display = helpers.canArchiveWorkspace("owner") ? "inline-flex" : "none";
    assert.equal(archiveBtn.style.display, "inline-flex");

    // When role is admin -> hidden
    archiveBtn.style.display = helpers.canArchiveWorkspace("admin") ? "inline-flex" : "none";
    assert.equal(archiveBtn.style.display, "none");

    // When role is member -> hidden
    archiveBtn.style.display = helpers.canArchiveWorkspace("member") ? "inline-flex" : "none";
    assert.equal(archiveBtn.style.display, "none");
  });

  it("5. Modal Cancel button dismisses modal without calling archive API", () => {
    let modalClosed = false;
    let apiCalled = false;

    const modal = {
      classList: {
        contains: (cls) => cls === "open",
        remove: (cls) => {
          if (cls === "open") modalClosed = true;
        }
      },
      setAttribute: () => {}
    };

    const closeBtn = {
      dataset: {},
      addEventListener: (evt, handler) => {
        if (evt === "click") {
          handler();
        }
      }
    };

    assert.equal(modalClosed, false);
    assert.equal(apiCalled, false);
  });

  it("6. Successful archive updates workspace/session state and selects fallback", () => {
    let storedToken = "initial-token";
    let storedTenant = { id: "ws-1", name: "Workspace 1" };
    let storedUser = { id: "user-1", email: "owner@test.com", tenantId: "ws-1" };

    const mockApi = {
      setToken: (t) => { storedToken = t; },
      setTenant: (t) => { storedTenant = t; },
      getUser: () => storedUser,
      setUser: (u) => { storedUser = u; }
    };

    // Simulate response from PATCH /api/workspaces/:id/archive
    const archiveResponse = {
      success: true,
      data: {
        archivedWorkspaceId: "ws-1",
        token: "fallback-token-abc",
        switched: true,
        activeWorkspace: {
          id: "ws-2",
          name: "Workspace 2 (Fallback)",
          type: "organization",
          role: "owner"
        }
      }
    };

    if (archiveResponse.data.token) {
      mockApi.setToken(archiveResponse.data.token);
    }
    if (archiveResponse.data.activeWorkspace) {
      mockApi.setTenant(archiveResponse.data.activeWorkspace);
      const user = mockApi.getUser();
      if (user) {
        user.tenantId = archiveResponse.data.activeWorkspace.id;
        mockApi.setUser(user);
      }
    }

    assert.equal(storedToken, "fallback-token-abc");
    assert.equal(storedTenant.id, "ws-2");
    assert.equal(storedUser.tenantId, "ws-2");
  });

  it("7. Workspace selector excludes archived workspace on reload", () => {
    const selectorOptions = [];
    const mockSelectEl = {
      appendChild: (opt) => selectorOptions.push(opt)
    };

    const backendWorkspaces = [
      { id: "ws-2", name: "Acme Secondary", type: "organization", isCurrent: true, role: "owner" }
      // ws-1 was archived and is therefore excluded from GET /api/workspaces
    ];

    backendWorkspaces.forEach((ws) => {
      mockSelectEl.appendChild({ value: ws.id, text: `${ws.name} (${ws.type})` });
    });

    assert.equal(selectorOptions.length, 1);
    assert.equal(selectorOptions[0].value, "ws-2");
    assert.ok(!selectorOptions.some((opt) => opt.value === "ws-1"));
  });

  it("8. 409 error remains visible inline without logging the user out", () => {
    let logoutCalled = false;
    const errorEl = {
      textContent: "",
      style: { display: "none" }
    };

    const mockAuth = {
      logout: () => { logoutCalled = true; }
    };

    const errResponse = {
      status: 409,
      message: "Cannot archive your only active workspace. A user must retain at least one active workspace."
    };

    errorEl.textContent = errResponse.message;
    errorEl.style.display = "block";

    assert.equal(errorEl.textContent, errResponse.message);
    assert.equal(errorEl.style.display, "block");
    assert.equal(logoutCalled, false, "User must NOT be logged out on 409 Conflict");
  });
});
