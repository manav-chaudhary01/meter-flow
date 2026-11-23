import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

describe("P3.1 Invoice Finalization & Void Frontend Unit & VM Tests", () => {
  const frontendDir = fs.existsSync(path.resolve(process.cwd(), "frontend"))
    ? path.resolve(process.cwd(), "frontend")
    : path.resolve(process.cwd(), "..", "frontend");

  const billingHtmlPath = path.resolve(frontendDir, "billing.html");
  const billingJsPath = path.resolve(frontendDir, "js", "billing.js");

  const billingHtml = fs.readFileSync(billingHtmlPath, "utf-8");
  const billingJs = fs.readFileSync(billingJsPath, "utf-8");

  it("1. HTML structure contains accessible Finalize and Void modals and anchors", () => {
    // Finalize Modal
    assert.match(billingHtml, /id="finalize-invoice-modal"/);
    assert.match(billingHtml, /role="dialog"/);
    assert.match(billingHtml, /aria-modal="true"/);
    assert.match(billingHtml, /id="finalize-invoice-title"/);
    assert.match(billingHtml, /id="finalize-invoice-number"/);
    assert.match(billingHtml, /id="finalize-invoice-error"/);
    assert.match(billingHtml, /id="finalize-invoice-confirm-btn"/);
    assert.match(billingHtml, /data-close-modal="finalize-invoice-modal"/);

    // Void Modal
    assert.match(billingHtml, /id="void-invoice-modal"/);
    assert.match(billingHtml, /id="void-invoice-title"/);
    assert.match(billingHtml, /id="void-invoice-number"/);
    assert.match(billingHtml, /id="void-invoice-error"/);
    assert.match(billingHtml, /id="void-invoice-confirm-btn"/);
    assert.match(billingHtml, /data-close-modal="void-invoice-modal"/);

    // Details Modal Action Buttons
    assert.match(billingHtml, /id="details-finalize-btn"/);
    assert.match(billingHtml, /id="details-void-btn"/);

    // Filter Options
    assert.match(billingHtml, /<option value="finalized">Finalized<\/option>/);
    assert.match(billingHtml, /<option value="void">Void<\/option>/);
  });

  it("2. Safe DOM compliance: zero innerHTML, outerHTML, alert, or confirm in billing.js", () => {
    assert.doesNotMatch(billingJs, /\.innerHTML\s*=/);
    assert.doesNotMatch(billingJs, /\.outerHTML\s*=/);
    assert.doesNotMatch(billingJs, /\bwindow\.alert\s*\(/);
    assert.doesNotMatch(billingJs, /\balert\s*\(/);
    assert.doesNotMatch(billingJs, /\bwindow\.confirm\s*\(/);
    assert.doesNotMatch(billingJs, /\bconfirm\s*\(/);
  });

  it("3. Helper canManageInvoiceLifecycle allows owner and admin, rejects member", () => {
    const sandbox = { window: {} };
    vm.runInNewContext(billingJs, sandbox);
    const helpers = sandbox.window.MeterFlowBilling;

    assert.equal(helpers.canManageInvoiceLifecycle("owner"), true);
    assert.equal(helpers.canManageInvoiceLifecycle("admin"), true);
    assert.equal(helpers.canManageInvoiceLifecycle("member"), false);
    assert.equal(helpers.canManageInvoiceLifecycle("viewer"), false);
    assert.equal(helpers.canManageInvoiceLifecycle(""), false);
    assert.equal(helpers.canManageInvoiceLifecycle(null), false);
  });

  it("4. Helper canFinalizeInvoice permits only authorized roles on issued or draft invoices", () => {
    const sandbox = { window: {} };
    vm.runInNewContext(billingJs, sandbox);
    const helpers = sandbox.window.MeterFlowBilling;

    // Authorized roles
    assert.equal(helpers.canFinalizeInvoice("issued", "owner"), true);
    assert.equal(helpers.canFinalizeInvoice("draft", "owner"), true);
    assert.equal(helpers.canFinalizeInvoice("issued", "admin"), true);
    assert.equal(helpers.canFinalizeInvoice("draft", "admin"), true);

    // Terminal statuses
    assert.equal(helpers.canFinalizeInvoice("finalized", "owner"), false);
    assert.equal(helpers.canFinalizeInvoice("void", "owner"), false);
    assert.equal(helpers.canFinalizeInvoice("finalized", "admin"), false);
    assert.equal(helpers.canFinalizeInvoice("void", "admin"), false);

    // Unauthorized member role
    assert.equal(helpers.canFinalizeInvoice("issued", "member"), false);
    assert.equal(helpers.canFinalizeInvoice("draft", "member"), false);
    assert.equal(helpers.canFinalizeInvoice("finalized", "member"), false);
    assert.equal(helpers.canFinalizeInvoice("void", "member"), false);
  });

  it("5. Helper canVoidInvoice permits only authorized roles on issued or draft invoices", () => {
    const sandbox = { window: {} };
    vm.runInNewContext(billingJs, sandbox);
    const helpers = sandbox.window.MeterFlowBilling;

    // Authorized roles
    assert.equal(helpers.canVoidInvoice("issued", "owner"), true);
    assert.equal(helpers.canVoidInvoice("draft", "owner"), true);
    assert.equal(helpers.canVoidInvoice("issued", "admin"), true);
    assert.equal(helpers.canVoidInvoice("draft", "admin"), true);

    // Terminal statuses
    assert.equal(helpers.canVoidInvoice("finalized", "owner"), false);
    assert.equal(helpers.canVoidInvoice("void", "owner"), false);
    assert.equal(helpers.canVoidInvoice("finalized", "admin"), false);
    assert.equal(helpers.canVoidInvoice("void", "admin"), false);

    // Unauthorized member role
    assert.equal(helpers.canVoidInvoice("issued", "member"), false);
    assert.equal(helpers.canVoidInvoice("draft", "member"), false);
  });

  it("6. Helper isInvoiceTerminal correctly identifies finalized and void statuses", () => {
    const sandbox = { window: {} };
    vm.runInNewContext(billingJs, sandbox);
    const helpers = sandbox.window.MeterFlowBilling;

    assert.equal(helpers.isInvoiceTerminal("finalized"), true);
    assert.equal(helpers.isInvoiceTerminal("void"), true);
    assert.equal(helpers.isInvoiceTerminal("issued"), false);
    assert.equal(helpers.isInvoiceTerminal("draft"), false);
    assert.equal(helpers.isInvoiceTerminal("unknown"), false);
  });

  it("7. Status badge classes: finalized is badge-success, void is badge-danger, issued is badge-info, draft is badge-warning", () => {
    assert.match(billingJs, /bill\.status === "finalized"\s*\?\s*"badge-success"/);
    assert.match(billingJs, /bill\.status === "issued"\s*\?\s*"badge-info"/);
    assert.match(billingJs, /bill\.status === "draft"\s*\?\s*"badge-warning"/);
    assert.match(billingJs, /"badge-danger"/);
  });

  it("8. Modal error handling renders inline without session clearing", () => {
    assert.match(billingJs, /finalizeConfirmBtn\.disabled = true/);
    assert.match(billingJs, /errorEl\.textContent = (res\.message|err\.message)/);
    assert.match(billingJs, /errorEl\.style\.display = "block"/);
    assert.match(billingJs, /voidConfirmBtn\.disabled = true/);
  });
});
