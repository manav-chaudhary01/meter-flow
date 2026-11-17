import { describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";

describe("Responsive UI, Accessibility (WCAG AA) & UX Hardening", () => {
  const pages = [
    { path: "/", name: "Dashboard (index.html)" },
    { path: "/login", name: "Sign In (login.html)" },
    { path: "/register", name: "Register (register.html)" },
    { path: "/services.html", name: "Services Catalog" },
    { path: "/usage.html", name: "Usage Management" },
    { path: "/billing.html", name: "Invoices & Billing" },
    { path: "/budgets.html", name: "Budgets & Alerts" }
  ];

  describe("1. Keyboard Navigation & Skip Links", () => {
    pages.forEach(({ path, name }) => {
      it(`should provide a skip link to main content on ${name}`, async () => {
        const res = await request(app).get(path);
        assert.equal(res.status, 200);
        assert.match(res.text, /<a\s+href="#main-content"\s+class="skip-link">Skip to main content<\/a>/i);
        assert.match(res.text, /<main[^>]+id="main-content"[^>]+tabindex="-1"/i);
      });
    });
  });

  describe("2. Semantic Landmarks & Accessible Names", () => {
    const authenticatedPages = [
      { path: "/", name: "Dashboard" },
      { path: "/services.html", name: "Services" },
      { path: "/usage.html", name: "Usage" },
      { path: "/billing.html", name: "Billing" },
      { path: "/budgets.html", name: "Budgets" }
    ];

    authenticatedPages.forEach(({ path, name }) => {
      it(`should contain semantic landmarks with accessible names on ${name}`, async () => {
        const res = await request(app).get(path);
        assert.equal(res.status, 200);
        assert.match(res.text, /<header\s+class="app-header"/i);
        assert.match(res.text, /<nav\s+class="sidebar-nav"\s+aria-label="Main Navigation"/i);
        assert.match(res.text, /<aside\s+id="sidebar"/i);
        assert.match(res.text, /<button[^>]+id="mobile-menu-btn"[^>]+aria-label="Toggle navigation menu"/i);
      });
    });
  });

  describe("3. Table Keyboard Accessibility & Controlled Horizontal Overflow", () => {
    const tablePages = [
      { path: "/", name: "Dashboard", regionLabel: "Recent Invoices" },
      { path: "/services.html", name: "Services Catalog", regionLabel: "Tracked Services Catalog" },
      { path: "/usage.html", name: "Usage History", regionLabel: "Historical Usage Records" },
      { path: "/billing.html", name: "Billing Records", regionLabel: "Workspace Billing Records" }
    ];

    tablePages.forEach(({ path, name, regionLabel }) => {
      it(`should provide keyboard focusable table wrapper with role and label on ${name}`, async () => {
        const res = await request(app).get(path);
        assert.equal(res.status, 200);
        assert.match(
          res.text,
          new RegExp(`class="table-responsive"[^>]*tabindex="0"[^>]*role="region"[^>]*aria-label="${regionLabel}"`, "i")
        );
        assert.match(res.text, /<table\s+class="data-table"/i);
        assert.match(res.text, /<th\s+scope="col"/i);
      });
    });
  });

  describe("4. Modal Dialog A11y & Focus Attributes", () => {
    it("should configure create, edit, and archive modals with dialog roles on services.html", async () => {
      const res = await request(app).get("/services.html");
      assert.equal(res.status, 200);
      assert.match(res.text, /id="create-modal"\s+class="modal-backdrop"\s+role="dialog"\s+aria-modal="true"\s+aria-labelledby="create-modal-title"/i);
      assert.match(res.text, /id="edit-modal"\s+class="modal-backdrop"\s+role="dialog"\s+aria-modal="true"\s+aria-labelledby="edit-modal-title"/i);
      assert.match(res.text, /id="archive-modal"\s+class="modal-backdrop"\s+role="dialog"\s+aria-modal="true"\s+aria-labelledby="archive-modal-title"/i);
      assert.match(res.text, /aria-label="Close dialog"/i);
    });

    it("should configure ingest and metadata modals with dialog roles on usage.html", async () => {
      const res = await request(app).get("/usage.html");
      assert.equal(res.status, 200);
      assert.match(res.text, /id="ingest-modal"\s+class="modal-backdrop"\s+role="dialog"\s+aria-modal="true"\s+aria-labelledby="ingest-modal-title"/i);
      assert.match(res.text, /id="metadata-modal"\s+class="modal-backdrop"\s+role="dialog"\s+aria-modal="true"\s+aria-labelledby="metadata-modal-title"/i);
    });

    it("should configure generate, details, and usage modals with dialog roles on billing.html", async () => {
      const res = await request(app).get("/billing.html");
      assert.equal(res.status, 200);
      assert.match(res.text, /id="generate-modal"\s+class="modal-backdrop"\s+role="dialog"\s+aria-modal="true"\s+aria-labelledby="generate-modal-title"/i);
      assert.match(res.text, /id="details-modal"\s+class="modal-backdrop"\s+role="dialog"\s+aria-modal="true"\s+aria-labelledby="details-modal-title"/i);
      assert.match(res.text, /id="usage-modal"\s+class="modal-backdrop"\s+role="dialog"\s+aria-modal="true"\s+aria-labelledby="usage-modal-title"/i);
    });

    it("should configure create, edit, and deactivate modals with dialog roles on budgets.html", async () => {
      const res = await request(app).get("/budgets.html");
      assert.equal(res.status, 200);
      assert.match(res.text, /id="create-budget-modal"\s+class="modal-backdrop"\s+role="dialog"\s+aria-modal="true"\s+aria-labelledby="create-budget-title"/i);
      assert.match(res.text, /id="edit-budget-modal"\s+class="modal-backdrop"\s+role="dialog"\s+aria-modal="true"\s+aria-labelledby="edit-budget-title"/i);
      assert.match(res.text, /id="deactivate-budget-modal"\s+class="modal-backdrop"\s+role="dialog"\s+aria-modal="true"\s+aria-labelledby="deactivate-modal-title"/i);
    });
  });

  describe("5. Stylesheet Responsive Tokens, Touch Targets & Reduced Motion", () => {
    it("should include skip link styles and high-contrast focus-visible outline in styles.css", async () => {
      const res = await request(app).get("/css/styles.css");
      assert.equal(res.status, 200);
      assert.match(res.text, /\.skip-link\s*\{/i);
      assert.match(res.text, /\.skip-link:focus/i);
      assert.match(res.text, /a:focus-visible/i);
      assert.match(res.text, /outline:\s*2px solid var\(--color-primary\)/i);
      assert.match(res.text, /outline-offset:\s*2px/i);
    });

    it("should include modal scroll containment on body in styles.css", async () => {
      const res = await request(app).get("/css/styles.css");
      assert.equal(res.status, 200);
      assert.match(res.text, /body\.modal-open\s*\{/i);
      assert.match(res.text, /overscroll-behavior:\s*contain/i);
    });

    it("should enforce minimum 44x44px touch targets on coarse pointers and mobile viewports", async () => {
      const res = await request(app).get("/css/styles.css");
      assert.equal(res.status, 200);
      assert.match(res.text, /@media\s*\(\s*pointer:\s*coarse\s*\)/i);
      assert.match(res.text, /min-height:\s*44px/i);
    });

    it("should include comprehensive responsive breakpoints across desktop, tablet, and mobile", async () => {
      const res = await request(app).get("/css/styles.css");
      assert.equal(res.status, 200);
      assert.match(res.text, /@media\s*\(max-width:\s*1024px\)/i);
      assert.match(res.text, /@media\s*\(max-width:\s*768px\)/i);
      assert.match(res.text, /@media\s*\(max-width:\s*600px\)/i);
      assert.match(res.text, /@media\s*\(max-width:\s*480px\)/i);
      assert.match(res.text, /@media\s*\(max-width:\s*360px\)/i);
    });

    it("should include prefers-reduced-motion media query to respect user motion preferences", async () => {
      const res = await request(app).get("/css/styles.css");
      assert.equal(res.status, 200);
      assert.match(res.text, /@media\s*\(prefers-reduced-motion:\s*reduce\)/i);
      assert.match(res.text, /animation-duration:\s*0\.01ms\s*!important/i);
    });
  });

  describe("6. Safe DOM & Modal Focus Trapping in Client Scripts", () => {
    const scripts = [
      { path: "/js/api.js", name: "api.js" },
      { path: "/js/auth.js", name: "auth.js" },
      { path: "/js/dashboard.js", name: "dashboard.js" },
      { path: "/js/services.js", name: "services.js" },
      { path: "/js/usage.js", name: "usage.js" },
      { path: "/js/billing.js", name: "billing.js" },
      { path: "/js/budgets.js", name: "budgets.js" }
    ];

    scripts.forEach(({ path, name }) => {
      it(`should strictly avoid unsafe sinks (innerHTML, outerHTML, alert, confirm) in ${name}`, async () => {
        const res = await request(app).get(path);
        assert.equal(res.status, 200);
        assert.doesNotMatch(res.text, /\.innerHTML\s*=/);
        assert.doesNotMatch(res.text, /\.outerHTML\s*=/);
        assert.doesNotMatch(res.text, /\bwindow\.alert\s*\(/);
        assert.doesNotMatch(res.text, /\balert\s*\(/);
        assert.doesNotMatch(res.text, /\bwindow\.confirm\s*\(/);
        assert.doesNotMatch(res.text, /\bconfirm\s*\(/);
      });
    });

    const modalScripts = [
      { path: "/js/services.js", name: "services.js" },
      { path: "/js/usage.js", name: "usage.js" },
      { path: "/js/billing.js", name: "billing.js" },
      { path: "/js/budgets.js", name: "budgets.js" }
    ];

    modalScripts.forEach(({ path, name }) => {
      it(`should implement Tab focus trapping, body scroll lock, and Escape handling in ${name}`, async () => {
        const res = await request(app).get(path);
        assert.equal(res.status, 200);
        assert.match(res.text, /document\.body\.classList\.add\("modal-open"\)/i);
        assert.match(res.text, /document\.body\.classList\.remove\("modal-open"\)/i);
        assert.match(res.text, /e\.key === "Escape"/i);
        assert.match(res.text, /e\.key === "Tab"/i);
        assert.match(res.text, /lastFocusedElement/i);
      });
    });
  });
});
