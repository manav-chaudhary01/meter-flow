/**
 * MeterFlow Invoices & Billing Controller
 * Handles billing cycle generation, line-item reconciliation, and invoice inspection.
 * Strict DOM Safety: Zero unsafe innerHTML for dynamic API/user content.
 */

(function (window) {
  "use strict";

  // --- Pure Helpers (exposed on window.MeterFlowBilling for verification) ---

  function stringOrEmpty(val) {
    return val === null || val === undefined ? "" : String(val);
  }

  function canGenerateBilling(role) {
    const r = stringOrEmpty(role).trim().toLowerCase();
    return r === "owner" || r === "admin";
  }

  function formatCurrency(amount, currency = "USD") {
    if (amount === null || amount === undefined || amount === "") {
      return `${currency} 0.00`;
    }
    const str = String(amount).trim();
    const num = Number(str);
    if (Number.isNaN(num)) {
      return `${currency} ${str}`;
    }
    return `${currency} ${num.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  function formatDateTime(dateStr) {
    if (!dateStr) return "--";
    try {
      const d = new Date(dateStr);
      if (Number.isNaN(d.getTime())) return String(dateStr);
      return d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    } catch {
      return String(dateStr);
    }
  }

  function formatDateOnly(dateStr) {
    if (!dateStr) return "--";
    try {
      const d = new Date(dateStr);
      if (Number.isNaN(d.getTime())) return String(dateStr);
      return d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
      });
    } catch {
      return String(dateStr);
    }
  }

  function formatPeriod(startStr, endStr) {
    const s = formatDateOnly(startStr);
    const e = formatDateOnly(endStr);
    return `${s} – ${e}`;
  }

  function parseDateFilterRange(startVal, endVal) {
    let startDateISO = undefined;
    let endDateISO = undefined;

    if (startVal) {
      const s = new Date(startVal);
      if (Number.isNaN(s.getTime())) {
        return { error: "Invalid 'From' date format" };
      }
      startDateISO = s.toISOString();
    }

    if (endVal) {
      const e = new Date(endVal);
      if (Number.isNaN(e.getTime())) {
        return { error: "Invalid 'To' date format" };
      }
      if (!String(endVal).includes("T")) {
        e.setUTCHours(23, 59, 59, 999);
      }
      endDateISO = e.toISOString();
    }

    if (startDateISO && endDateISO && new Date(startDateISO) > new Date(endDateISO)) {
      return { error: "'From' date cannot be after 'To' date" };
    }

    return { startDateISO, endDateISO };
  }

  function validateGenerateForm(values) {
    const startStr = stringOrEmpty(values.billingPeriodStart).trim();
    const endStr = stringOrEmpty(values.billingPeriodEnd).trim();
    const currency = stringOrEmpty(values.currency).trim().toUpperCase();

    if (!startStr) {
      return { error: "Period start date is required", fieldId: "gen-start-date" };
    }
    if (!endStr) {
      return { error: "Period end date is required", fieldId: "gen-end-date" };
    }

    const s = new Date(startStr);
    const e = new Date(endStr);

    if (Number.isNaN(s.getTime())) {
      return { error: "Invalid format for period start date", fieldId: "gen-start-date" };
    }
    if (Number.isNaN(e.getTime())) {
      return { error: "Invalid format for period end date", fieldId: "gen-end-date" };
    }
    if (s >= e) {
      return { error: "Period start date must be strictly before end date", fieldId: "gen-start-date" };
    }

    if (!currency || !/^[A-Z]{3}$/.test(currency)) {
      return { error: "Currency must be a valid 3-letter ISO code (e.g. USD, EUR)", fieldId: "gen-currency" };
    }

    return { valid: true };
  }

  function buildGeneratePayload(values) {
    const s = new Date(values.billingPeriodStart);
    const e = new Date(values.billingPeriodEnd);
    const currency = stringOrEmpty(values.currency).trim().toUpperCase() || "USD";

    return {
      billingPeriodStart: s.toISOString(),
      billingPeriodEnd: e.toISOString(),
      currency
    };
  }

  // Expose pure helpers on window
  window.MeterFlowBilling = {
    canGenerateBilling,
    formatCurrency,
    formatDateTime,
    formatDateOnly,
    formatPeriod,
    parseDateFilterRange,
    validateGenerateForm,
    buildGeneratePayload
  };

  // If running in Node VM test context without DOM window.document, exit early
  if (typeof document === "undefined") {
    return;
  }

  const api = window.MeterFlowAPI;
  const auth = window.MeterFlowAuth;

  if (!auth || !api || !auth.requireAuth()) return;

  // --- Page State ---
  let currentWorkspaceRole = "member";
  let currentPage = 1;
  let totalPages = 1;
  let cachedBills = [];
  let currentlyViewedBillId = null;

  document.addEventListener("DOMContentLoaded", initBillingPage);

  async function initBillingPage() {
    setupUserProfile();
    setupMobileMenu();
    setupModals();
    setupFilterEvents();
    setupGenerateForm();
    setupPagination();

    await loadWorkspaces();
    await loadBillingRecords(1);

    const refreshBtn = document.getElementById("refresh-billing-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => loadBillingRecords(currentPage));
    }

    window.addEventListener("workspace-switched", async (e) => {
      const newWs = e.detail?.workspace;
      if (newWs && newWs.role) {
        currentWorkspaceRole = newWs.role;
        applyRolePermissions(currentWorkspaceRole);
      }
      await loadWorkspaces();
      await loadBillingRecords(1);
    });
  }

  function setupUserProfile() {
    const user = api.getUser();
    const logoutBtn = document.getElementById("logout-btn");
    const userNameEl = document.getElementById("header-user-name");
    const userRoleEl = document.getElementById("header-user-role");
    const userAvatarEl = document.getElementById("header-user-avatar");

    if (user) {
      if (userNameEl) userNameEl.textContent = user.name || "User";
      if (userRoleEl) userRoleEl.textContent = user.email || "";
      if (userAvatarEl && user.name) {
        const initials = user.name
          .split(" ")
          .map((part) => part[0])
          .slice(0, 2)
          .join("")
          .toUpperCase();
        userAvatarEl.textContent = initials || "U";
      }
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", (e) => {
        e.preventDefault();
        auth.logout();
      });
    }
  }

  function setupMobileMenu() {
    const mobileBtn = document.getElementById("mobile-menu-btn");
    const sidebar = document.getElementById("sidebar");
    if (mobileBtn && sidebar) {
      mobileBtn.addEventListener("click", () => sidebar.classList.toggle("open"));
      document.addEventListener("click", (e) => {
        if (
          sidebar.classList.contains("open") &&
          !sidebar.contains(e.target) &&
          !mobileBtn.contains(e.target)
        ) {
          sidebar.classList.remove("open");
        }
      });
    }
  }

  async function loadWorkspaces() {
    const selectEl = document.getElementById("workspace-select");
    if (!selectEl) return;

    try {
      const res = await api.get("/api/workspaces");
      if (res.success && res.data && Array.isArray(res.data.workspaces)) {
        selectEl.textContent = "";

        res.data.workspaces.forEach((ws) => {
          const opt = document.createElement("option");
          opt.value = ws.id;
          opt.textContent = `${ws.name} (${ws.type})`;
          if (ws.isCurrent) {
            opt.selected = true;
            currentWorkspaceRole = ws.role || "member";
          }
          selectEl.appendChild(opt);
        });

        applyRolePermissions(currentWorkspaceRole);
      }
    } catch (err) {
      console.error("Failed to load workspaces:", err.message);
    }

    if (!selectEl.dataset.hasChangeListener) {
      selectEl.dataset.hasChangeListener = "true";
      selectEl.addEventListener("change", async (e) => {
        const targetWorkspaceId = e.target.value;
        if (!targetWorkspaceId) return;

        selectEl.disabled = true;
        try {
          const switchRes = await api.post("/api/workspaces/switch", {
            workspaceId: targetWorkspaceId
          });

          if (switchRes.success && switchRes.data) {
            api.setToken(switchRes.data.token);
            api.setTenant(switchRes.data.workspace);

            currentWorkspaceRole = switchRes.data.workspace.role || "member";
            applyRolePermissions(currentWorkspaceRole);

            // Clear previous workspace state before loading new workspace data
            cachedBills = [];
            clearTable();
            await loadBillingRecords(1);
          }
        } catch (switchErr) {
          showGlobalError("Failed to switch workspace: " + (switchErr.message || "Unknown error"));
        } finally {
          selectEl.disabled = false;
        }
      });
    }
  }

  function applyRolePermissions(role) {
    const roleBadgeEl = document.getElementById("workspace-role-badge");
    const openGenBtn = document.getElementById("open-generate-modal-btn");

    if (roleBadgeEl) {
      const normalizedRole = stringOrEmpty(role).toLowerCase();
      roleBadgeEl.textContent = role;
      roleBadgeEl.className = `badge badge-${
        normalizedRole === "owner" ? "primary" : normalizedRole === "admin" ? "info" : "neutral"
      }`;
    }

    const canGen = canGenerateBilling(role);
    if (openGenBtn) {
      openGenBtn.disabled = !canGen;
      if (!canGen) {
        openGenBtn.title = "Requires Admin or Owner role in this workspace";
        openGenBtn.style.opacity = "0.5";
        openGenBtn.style.cursor = "not-allowed";
      } else {
        openGenBtn.title = "";
        openGenBtn.style.opacity = "1";
        openGenBtn.style.cursor = "pointer";
      }
    }
  }

  function setupModals() {
    const openBtn = document.getElementById("open-generate-modal-btn");
    const genModal = document.getElementById("generate-modal");
    const detailsModal = document.getElementById("details-modal");
    const usageModal = document.getElementById("usage-modal");
    const detailsViewUsageBtn = document.getElementById("details-view-usage-btn");

    if (openBtn && genModal) {
      openBtn.addEventListener("click", () => {
        if (!canGenerateBilling(currentWorkspaceRole)) {
          showGlobalError("Only workspace owners and administrators can generate bills.");
          return;
        }

        // Set default start/end dates to current month boundaries
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59);

        const startInput = document.getElementById("gen-start-date");
        const endInput = document.getElementById("gen-end-date");
        if (startInput && !startInput.value) {
          startInput.value = formatDateTimeLocal(firstDay);
        }
        if (endInput && !endInput.value) {
          endInput.value = formatDateTimeLocal(lastDay);
        }

        hideModalError();
        genModal.classList.add("open");
      });
    }

    if (detailsViewUsageBtn) {
      detailsViewUsageBtn.addEventListener("click", () => {
        if (currentlyViewedBillId) {
          if (detailsModal) detailsModal.classList.remove("open");
          openReconciledUsageModal(currentlyViewedBillId);
        }
      });
    }

    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const modalId = btn.getAttribute("data-close-modal");
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.remove("open");
      });
    });

    [genModal, detailsModal, usageModal].forEach((modal) => {
      if (modal) {
        modal.addEventListener("click", (e) => {
          if (e.target === modal) modal.classList.remove("open");
        });
      }
    });
  }

  function formatDateTimeLocal(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
      date.getHours()
    )}:${pad(date.getMinutes())}`;
  }

  function setupGenerateForm() {
    const form = document.getElementById("generate-bill-form");
    const submitBtn = document.getElementById("generate-submit-btn");

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        hideModalError();

        if (!canGenerateBilling(currentWorkspaceRole)) {
          showModalError("Only workspace owners and administrators can generate bills.");
          return;
        }

        const startVal = document.getElementById("gen-start-date")?.value;
        const endVal = document.getElementById("gen-end-date")?.value;
        const currency = document.getElementById("gen-currency")?.value.trim().toUpperCase() || "USD";

        const validation = validateGenerateForm({
          billingPeriodStart: startVal,
          billingPeriodEnd: endVal,
          currency
        });

        if (validation.error) {
          showModalError(validation.error);
          return;
        }

        const payload = buildGeneratePayload({
          billingPeriodStart: startVal,
          billingPeriodEnd: endVal,
          currency
        });

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Generating...";
        }

        try {
          const res = await api.post("/api/billing/generate", payload);

          if (res.success && res.data) {
            document.getElementById("generate-modal")?.classList.remove("open");

            if (res.data.isExisting) {
              showGlobalInfo(
                `Notice: Billing record ${res.data.billingRecord.invoiceNumber} already exists for this exact period. Loaded existing record.`
              );
            } else {
              showGlobalSuccess(
                `Invoice ${res.data.billingRecord.invoiceNumber} generated successfully!`
              );
            }

            await loadBillingRecords(1);
          }
        } catch (err) {
          showModalError(err.message || "Failed to generate billing record.");
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Generate Bill";
          }
        }
      });
    }
  }

  function showModalError(msg) {
    const errorBanner = document.getElementById("generate-modal-error");
    if (errorBanner) {
      errorBanner.textContent = msg;
      errorBanner.style.display = "block";
    }
  }

  function hideModalError() {
    const errorBanner = document.getElementById("generate-modal-error");
    if (errorBanner) {
      errorBanner.textContent = "";
      errorBanner.style.display = "none";
    }
  }

  function setupFilterEvents() {
    const applyBtn = document.getElementById("apply-filters-btn");
    const resetBtn = document.getElementById("reset-filters-btn");
    const statusSelect = document.getElementById("filter-status");

    if (statusSelect) {
      statusSelect.addEventListener("change", () => loadBillingRecords(1));
    }

    if (applyBtn) {
      applyBtn.addEventListener("click", () => loadBillingRecords(1));
    }

    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        if (statusSelect) statusSelect.value = "";
        const startInput = document.getElementById("filter-start-date");
        const endInput = document.getElementById("filter-end-date");
        if (startInput) startInput.value = "";
        if (endInput) endInput.value = "";
        loadBillingRecords(1);
      });
    }
  }

  function setupPagination() {
    const prevBtn = document.getElementById("prev-page-btn");
    const nextBtn = document.getElementById("next-page-btn");

    if (prevBtn) {
      prevBtn.addEventListener("click", () => {
        if (currentPage > 1) loadBillingRecords(currentPage - 1);
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        if (currentPage < totalPages) loadBillingRecords(currentPage + 1);
      });
    }
  }

  function clearTable() {
    const tableBody = document.getElementById("billing-table-body");
    if (tableBody) {
      tableBody.textContent = "";
    }
  }

  async function loadBillingRecords(page = 1) {
    const tableBody = document.getElementById("billing-table-body");
    const emptyState = document.getElementById("billing-empty");
    const paginationBar = document.getElementById("billing-pagination");
    const countBadge = document.getElementById("billing-count-badge");
    const errorBanner = document.getElementById("billing-error-banner");

    if (errorBanner) errorBanner.style.display = "none";

    const status = document.getElementById("filter-status")?.value;
    const startVal = document.getElementById("filter-start-date")?.value;
    const endVal = document.getElementById("filter-end-date")?.value;

    const dateRange = parseDateFilterRange(startVal, endVal);
    if (dateRange.error) {
      showGlobalError(dateRange.error);
      return;
    }

    const params = { page, limit: 20 };
    if (status) params.status = status;
    if (dateRange.startDateISO) params.startDate = dateRange.startDateISO;
    if (dateRange.endDateISO) params.endDate = dateRange.endDateISO;

    if (tableBody) {
      tableBody.textContent = "";
      const loadingRow = document.createElement("tr");
      const loadingCell = document.createElement("td");
      loadingCell.colSpan = 8;
      loadingCell.style.textAlign = "center";
      loadingCell.style.color = "var(--color-text-muted)";
      loadingCell.style.padding = "2rem";
      loadingCell.textContent = "Loading billing records...";
      loadingRow.appendChild(loadingCell);
      tableBody.appendChild(loadingRow);
    }

    try {
      const res = await api.get("/api/billing", params);
      const records = res.data && Array.isArray(res.data.billingRecords) ? res.data.billingRecords : [];
      const pagination = res.data?.pagination || { total: 0, page: 1, pages: 1 };
      cachedBills = records;

      currentPage = pagination.page;
      totalPages = pagination.pages;

      if (countBadge) {
        countBadge.textContent = `${pagination.total} Invoice${pagination.total === 1 ? "" : "s"}`;
      }

      updateSummaryKPIs(records, pagination.total);

      if (records.length === 0) {
        clearTable();
        if (emptyState) emptyState.style.display = "block";
        if (paginationBar) paginationBar.style.display = "none";
        return;
      }

      if (emptyState) emptyState.style.display = "none";
      if (paginationBar) paginationBar.style.display = "flex";

      updatePaginationControls(pagination);
      renderBillingTable(records);
    } catch (err) {
      if (errorBanner) {
        errorBanner.textContent = `Error loading billing records: ${err.message}`;
        errorBanner.style.display = "block";
      }
      if (tableBody) {
        tableBody.textContent = "";
        const errRow = document.createElement("tr");
        const errCell = document.createElement("td");
        errCell.colSpan = 8;
        errCell.style.textAlign = "center";
        errCell.style.color = "var(--color-danger)";
        errCell.style.padding = "2rem";
        errCell.textContent = "Failed to load billing records.";
        errRow.appendChild(errCell);
        tableBody.appendChild(errRow);
      }
    }
  }

  function updateSummaryKPIs(records, totalCount) {
    const countEl = document.getElementById("metric-invoice-count");
    const spendEl = document.getElementById("metric-total-invoiced");
    const currEl = document.getElementById("metric-billing-currency");

    if (countEl) countEl.textContent = totalCount.toString();

    let sum = 0;
    let currency = "USD";
    records.forEach((b) => {
      if (b.status === "issued" || b.status === "finalized") {
        const val = parseFloat(b.total) || 0;
        sum += val;
        if (b.currency) currency = b.currency;
      }
    });

    if (spendEl) {
      spendEl.textContent = `${currency} ${sum.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}`;
    }
    if (currEl) currEl.textContent = currency;
  }

  function updatePaginationControls(pagination) {
    const infoEl = document.getElementById("pagination-info");
    const prevBtn = document.getElementById("prev-page-btn");
    const nextBtn = document.getElementById("next-page-btn");

    if (infoEl) {
      infoEl.textContent = `Page ${pagination.page} of ${pagination.pages} (${pagination.total} total invoices)`;
    }
    if (prevBtn) prevBtn.disabled = pagination.page <= 1;
    if (nextBtn) nextBtn.disabled = pagination.page >= pagination.pages;
  }

  // --- Safe DOM Rendering for Billing Records Table ---

  function renderBillingTable(records) {
    const tableBody = document.getElementById("billing-table-body");
    if (!tableBody) return;

    tableBody.textContent = "";

    records.forEach((bill) => {
      const tr = document.createElement("tr");

      // Column 1: Invoice Number
      const tdInv = document.createElement("td");
      const invSpan = document.createElement("span");
      invSpan.style.fontFamily = "var(--font-mono)";
      invSpan.style.fontWeight = "600";
      invSpan.style.color = "var(--color-primary)";
      invSpan.textContent = bill.invoiceNumber;
      tdInv.appendChild(invSpan);
      tr.appendChild(tdInv);

      // Column 2: Billing Period
      const tdPeriod = document.createElement("td");
      tdPeriod.style.fontSize = "0.85rem";
      tdPeriod.style.color = "var(--color-text-main)";
      tdPeriod.textContent = formatPeriod(bill.billingPeriodStart, bill.billingPeriodEnd);
      tr.appendChild(tdPeriod);

      // Column 3: Line Items Count Badge
      const tdItems = document.createElement("td");
      const itemsBadge = document.createElement("span");
      itemsBadge.className = "badge badge-neutral";
      const count = Array.isArray(bill.lineItems) ? bill.lineItems.length : 0;
      itemsBadge.textContent = `${count} item${count === 1 ? "" : "s"}`;
      tdItems.appendChild(itemsBadge);
      tr.appendChild(tdItems);

      // Column 4: Subtotal
      const tdSub = document.createElement("td");
      const subSpan = document.createElement("span");
      subSpan.style.fontFamily = "var(--font-mono)";
      subSpan.style.fontSize = "0.85rem";
      subSpan.style.color = "var(--color-text-muted)";
      subSpan.textContent = formatCurrency(bill.subtotal, bill.currency);
      tdSub.appendChild(subSpan);
      tr.appendChild(tdSub);

      // Column 5: Total
      const tdTotal = document.createElement("td");
      const totalSpan = document.createElement("span");
      totalSpan.style.fontFamily = "var(--font-mono)";
      totalSpan.style.fontWeight = "700";
      totalSpan.style.color = "var(--color-text-main)";
      totalSpan.textContent = formatCurrency(bill.total, bill.currency);
      tdTotal.appendChild(totalSpan);
      tr.appendChild(tdTotal);

      // Column 6: Status Badge
      const tdStatus = document.createElement("td");
      const statusBadge = document.createElement("span");
      const statusClass =
        bill.status === "finalized"
          ? "badge-success"
          : bill.status === "issued"
          ? "badge-info"
          : bill.status === "draft"
          ? "badge-warning"
          : "badge-danger";
      statusBadge.className = `badge ${statusClass}`;
      statusBadge.textContent = bill.status;
      tdStatus.appendChild(statusBadge);
      tr.appendChild(tdStatus);

      // Column 7: Generated Date
      const tdGen = document.createElement("td");
      tdGen.style.fontSize = "0.8rem";
      tdGen.style.color = "var(--color-text-muted)";
      tdGen.style.whiteSpace = "nowrap";
      tdGen.textContent = formatDateOnly(bill.generatedAt);
      tr.appendChild(tdGen);

      // Column 8: Actions
      const tdActions = document.createElement("td");
      tdActions.style.textAlign = "right";
      tdActions.style.whiteSpace = "nowrap";

      const detailsBtn = document.createElement("button");
      detailsBtn.className = "btn btn-secondary btn-sm action-view-details";
      detailsBtn.setAttribute("data-id", bill.id);
      detailsBtn.style.marginRight = "6px";
      detailsBtn.textContent = "Line Items";
      detailsBtn.addEventListener("click", () => openDetailsModal(bill.id));
      tdActions.appendChild(detailsBtn);

      const usageBtn = document.createElement("button");
      usageBtn.className = "btn btn-secondary btn-sm action-view-usage";
      usageBtn.setAttribute("data-id", bill.id);
      usageBtn.textContent = "Reconciled Usage";
      usageBtn.addEventListener("click", () => openReconciledUsageModal(bill.id));
      tdActions.appendChild(usageBtn);

      tr.appendChild(tdActions);
      tableBody.appendChild(tr);
    });
  }

  // --- Safe DOM Rendering for Details Modal ---

  async function openDetailsModal(billId) {
    let bill = cachedBills.find((b) => b.id === billId);

    // If not in cache or line items missing, fetch by ID
    if (!bill || !bill.lineItems) {
      try {
        const res = await api.get(`/api/billing/${billId}`);
        if (res.success && res.data?.billingRecord) {
          bill = res.data.billingRecord;
        }
      } catch (err) {
        showGlobalError("Failed to fetch invoice details: " + err.message);
        return;
      }
    }

    if (!bill) return;
    currentlyViewedBillId = bill.id;

    const modal = document.getElementById("details-modal");
    const invNumEl = document.getElementById("details-invoice-number");
    const periodEl = document.getElementById("details-period");
    const currEl = document.getElementById("details-currency");
    const statusEl = document.getElementById("details-status");
    const bodyEl = document.getElementById("details-line-items-body");
    const subtotalEl = document.getElementById("details-subtotal");
    const totalEl = document.getElementById("details-total");

    if (invNumEl) invNumEl.textContent = bill.invoiceNumber;
    if (periodEl) {
      periodEl.textContent = formatPeriod(bill.billingPeriodStart, bill.billingPeriodEnd);
    }
    if (currEl) currEl.textContent = bill.currency;
    if (statusEl) {
      statusEl.textContent = bill.status;
      const statusClass =
        bill.status === "finalized"
          ? "badge-success"
          : bill.status === "issued"
          ? "badge-info"
          : bill.status === "draft"
          ? "badge-warning"
          : "badge-danger";
      statusEl.className = `badge ${statusClass}`;
    }

    if (bodyEl) {
      bodyEl.textContent = "";
      const lineItems = bill.lineItems || [];

      if (lineItems.length === 0) {
        const emptyRow = document.createElement("tr");
        const emptyCell = document.createElement("td");
        emptyCell.colSpan = 6;
        emptyCell.style.textAlign = "center";
        emptyCell.style.color = "var(--color-text-muted)";
        emptyCell.style.padding = "1.5rem";
        emptyCell.textContent = "No charges or usage incurred during this billing period ($0.00).";
        emptyRow.appendChild(emptyCell);
        bodyEl.appendChild(emptyRow);
      } else {
        lineItems.forEach((li) => {
          const row = document.createElement("tr");

          // Col 1: Service
          const tdService = document.createElement("td");
          const nameDiv = document.createElement("div");
          nameDiv.style.fontWeight = "600";
          nameDiv.textContent = li.serviceName;
          tdService.appendChild(nameDiv);

          if (li.description) {
            const descDiv = document.createElement("div");
            descDiv.style.fontSize = "0.775rem";
            descDiv.style.color = "var(--color-text-muted)";
            descDiv.textContent = li.description;
            tdService.appendChild(descDiv);
          }
          row.appendChild(tdService);

          // Col 2: Charge Type
          const tdType = document.createElement("td");
          const typeBadge = document.createElement("span");
          typeBadge.className = `badge ${li.chargeType === "usage" ? "badge-primary" : "badge-info"}`;
          typeBadge.textContent = li.chargeType;
          tdType.appendChild(typeBadge);
          row.appendChild(tdType);

          // Col 3: Quantity
          const tdQty = document.createElement("td");
          tdQty.style.fontFamily = "var(--font-mono)";
          tdQty.textContent = li.quantity ? `${li.quantity} ${li.unit || ""}`.trim() : "--";
          row.appendChild(tdQty);

          // Col 4: Unit Rate
          const tdRate = document.createElement("td");
          tdRate.style.fontFamily = "var(--font-mono)";
          tdRate.style.fontSize = "0.85rem";
          if (li.chargeType === "usage") {
            tdRate.textContent = `${bill.currency} ${li.unitPrice || "0"} / ${li.unit || "unit"}`;
          } else {
            tdRate.textContent = "Flat Period Fee";
          }
          row.appendChild(tdRate);

          // Col 5: Amount
          const tdAmount = document.createElement("td");
          tdAmount.style.fontFamily = "var(--font-mono)";
          tdAmount.style.fontWeight = "600";
          tdAmount.textContent = formatCurrency(li.amount, bill.currency);
          row.appendChild(tdAmount);

          // Col 6: Reconciled Events
          const tdEvents = document.createElement("td");
          const countBadge = document.createElement("span");
          countBadge.className = "badge badge-neutral";
          const count = li.usageRecordCount || 0;
          countBadge.textContent = `${count} event${count === 1 ? "" : "s"}`;
          tdEvents.appendChild(countBadge);
          row.appendChild(tdEvents);

          bodyEl.appendChild(row);
        });
      }
    }

    if (subtotalEl) subtotalEl.textContent = formatCurrency(bill.subtotal, bill.currency);
    if (totalEl) totalEl.textContent = formatCurrency(bill.total, bill.currency);

    if (modal) modal.classList.add("open");
  }

  // --- Safe DOM Rendering for Reconciled Usage Modal ---

  async function openReconciledUsageModal(billId) {
    const bill = cachedBills.find((b) => b.id === billId);
    const modal = document.getElementById("usage-modal");
    const invTitleEl = document.getElementById("usage-invoice-title");
    const infoEl = document.getElementById("reconciled-usage-info");
    const bodyEl = document.getElementById("reconciled-usage-body");

    if (invTitleEl) invTitleEl.textContent = bill ? `Invoice: ${bill.invoiceNumber}` : "";
    if (infoEl) infoEl.textContent = "Loading reconciled usage events...";

    if (bodyEl) {
      bodyEl.textContent = "";
      const loadingRow = document.createElement("tr");
      const loadingCell = document.createElement("td");
      loadingCell.colSpan = 5;
      loadingCell.style.textAlign = "center";
      loadingCell.style.color = "var(--color-text-muted)";
      loadingCell.style.padding = "1.5rem";
      loadingCell.textContent = "Loading usage records...";
      loadingRow.appendChild(loadingCell);
      bodyEl.appendChild(loadingRow);
    }

    if (modal) modal.classList.add("open");

    try {
      const res = await api.get(`/api/billing/${billId}/usage`);
      const usageList = res.data?.usageRecords || [];

      if (infoEl) {
        infoEl.textContent = `Found ${usageList.length} reconciled usage event${
          usageList.length === 1 ? "" : "s"
        } included in this invoice.`;
      }

      if (bodyEl) {
        bodyEl.textContent = "";

        if (usageList.length === 0) {
          const emptyRow = document.createElement("tr");
          const emptyCell = document.createElement("td");
          emptyCell.colSpan = 5;
          emptyCell.style.textAlign = "center";
          emptyCell.style.color = "var(--color-text-muted)";
          emptyCell.style.padding = "1.5rem";
          emptyCell.textContent =
            "No metered usage events were reconciled to this invoice (subscription-only or zero usage).";
          emptyRow.appendChild(emptyCell);
          bodyEl.appendChild(emptyRow);
          return;
        }

        usageList.forEach((u) => {
          const row = document.createElement("tr");

          // Service
          const tdService = document.createElement("td");
          tdService.style.fontWeight = "600";
          tdService.textContent = u.serviceName || "Service";
          row.appendChild(tdService);

          // Quantity
          const tdQty = document.createElement("td");
          tdQty.style.fontFamily = "var(--font-mono)";
          tdQty.style.fontWeight = "600";
          tdQty.textContent = u.quantity || "0";
          row.appendChild(tdQty);

          // Unit
          const tdUnit = document.createElement("td");
          const unitBadge = document.createElement("span");
          unitBadge.className = "badge badge-neutral";
          unitBadge.textContent = u.unit || "";
          tdUnit.appendChild(unitBadge);
          row.appendChild(tdUnit);

          // Occurred At
          const tdOccurred = document.createElement("td");
          tdOccurred.style.fontSize = "0.8rem";
          tdOccurred.style.color = "var(--color-text-muted)";
          tdOccurred.textContent = formatDateTime(u.occurredAt);
          row.appendChild(tdOccurred);

          // Billed At
          const tdBilled = document.createElement("td");
          tdBilled.style.fontSize = "0.8rem";
          tdBilled.style.color = "var(--color-text-muted)";
          tdBilled.textContent = formatDateTime(u.billedAt);
          row.appendChild(tdBilled);

          bodyEl.appendChild(row);
        });
      }
    } catch (err) {
      if (infoEl) infoEl.textContent = `Error loading reconciled usage: ${err.message}`;
      if (bodyEl) {
        bodyEl.textContent = "";
        const errRow = document.createElement("tr");
        const errCell = document.createElement("td");
        errCell.colSpan = 5;
        errCell.style.textAlign = "center";
        errCell.style.color = "var(--color-danger)";
        errCell.style.padding = "1.5rem";
        errCell.textContent = "Failed to fetch reconciled usage records.";
        errRow.appendChild(errCell);
        bodyEl.appendChild(errRow);
      }
    }
  }

  // --- Banner Notifications ---

  function showGlobalSuccess(msg) {
    const banner = document.getElementById("billing-success-banner");
    if (!banner) return;
    banner.textContent = msg;
    banner.style.display = "block";
    setTimeout(() => {
      banner.style.display = "none";
    }, 5000);
  }

  function showGlobalInfo(msg) {
    const banner = document.getElementById("billing-info-banner");
    if (!banner) return;
    banner.textContent = msg;
    banner.style.display = "block";
    setTimeout(() => {
      banner.style.display = "none";
    }, 6000);
  }

  function showGlobalError(msg) {
    const banner = document.getElementById("billing-error-banner");
    if (!banner) return;
    banner.textContent = msg;
    banner.style.display = "block";
    setTimeout(() => {
      banner.style.display = "none";
    }, 6000);
  }
})(window);
