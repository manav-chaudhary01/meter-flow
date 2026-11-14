/**
 * MeterFlow Budgets, Alerts & Forecasting Controller
 * Manages spending limits, threshold alert evaluations, and explainable linear projections.
 * Strict DOM Safety: Zero unsafe innerHTML for dynamic API/user content.
 */

(function (window) {
  "use strict";

  // --- Pure Helpers (exposed on window.MeterFlowBudgets for verification) ---

  function stringOrEmpty(val) {
    return val === null || val === undefined ? "" : String(val);
  }

  function canManageBudgets(role) {
    const r = stringOrEmpty(role).trim().toLowerCase();
    return r === "owner" || r === "admin";
  }

  function parseThresholds(input) {
    if (Array.isArray(input)) {
      if (input.length === 0) {
        return { error: "Thresholds array must not be empty" };
      }
      const numbers = [];
      for (const t of input) {
        const n = Number(t);
        if (Number.isNaN(n) || n <= 0 || n > 200) {
          return { error: "Each threshold must be a number between 1 and 200" };
        }
        numbers.push(n);
      }
      const uniqueSorted = [...new Set(numbers)].sort((a, b) => a - b);
      return { valid: true, thresholds: uniqueSorted };
    }

    const str = stringOrEmpty(input).trim();
    if (!str) {
      return { valid: true, thresholds: [50, 80, 90, 100] };
    }

    const parts = str.split(",");
    const numbers = [];
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const n = Number(trimmed);
      if (Number.isNaN(n) || n <= 0 || n > 200) {
        return { error: "Each threshold must be a number between 1 and 200" };
      }
      numbers.push(n);
    }

    if (numbers.length === 0) {
      return { error: "Thresholds must be a non-empty comma-separated list of numbers" };
    }

    const uniqueSorted = [...new Set(numbers)].sort((a, b) => a - b);
    return { valid: true, thresholds: uniqueSorted };
  }

  function validateBudgetAmount(amount) {
    if (amount === undefined || amount === null || amount === "") {
      return { error: "Budget amount is required" };
    }
    const str = String(amount).trim();
    const num = Number(str);
    if (Number.isNaN(num) || !Number.isFinite(num)) {
      return { error: "Budget amount must be a valid finite number" };
    }
    if (num <= 0) {
      return { error: "Budget amount must be a positive number (> 0)" };
    }
    return { valid: true, value: num.toFixed(2) };
  }

  function validateBudgetForm(mode, values) {
    const name = stringOrEmpty(values.name).trim();
    if (!name || name.length < 2) {
      return { error: "Budget name is required (minimum 2 characters)", fieldId: "budget-name" };
    }
    if (name.length > 100) {
      return { error: "Budget name must be 100 characters or fewer", fieldId: "budget-name" };
    }

    const amountCheck = validateBudgetAmount(values.amount);
    if (amountCheck.error) {
      return { error: amountCheck.error, fieldId: "budget-amount" };
    }

    if (mode === "create") {
      const currency = stringOrEmpty(values.currency).trim().toUpperCase();
      if (!currency || !/^[A-Z]{3}$/.test(currency)) {
        return { error: "Currency must be a valid 3-letter ISO code (e.g. USD, EUR)", fieldId: "budget-currency" };
      }

      const startStr = stringOrEmpty(values.startDate).trim();
      const endStr = stringOrEmpty(values.endDate).trim();
      if (!startStr) {
        return { error: "Start date is required", fieldId: "budget-start-date" };
      }
      if (!endStr) {
        return { error: "End date is required", fieldId: "budget-end-date" };
      }

      const s = new Date(startStr);
      const e = new Date(endStr);
      if (Number.isNaN(s.getTime())) {
        return { error: "Invalid start date format", fieldId: "budget-start-date" };
      }
      if (Number.isNaN(e.getTime())) {
        return { error: "Invalid end date format", fieldId: "budget-end-date" };
      }
      if (s >= e) {
        return { error: "Start date must be strictly before end date", fieldId: "budget-start-date" };
      }

      const periodType = stringOrEmpty(values.periodType).trim().toLowerCase();
      if (!["monthly", "quarterly", "yearly", "custom"].includes(periodType)) {
        return { error: "Invalid period type", fieldId: "budget-period-type" };
      }
    }

    if (values.thresholds !== undefined && values.thresholds !== "") {
      const threshCheck = parseThresholds(values.thresholds);
      if (threshCheck.error) {
        return { error: threshCheck.error, fieldId: "budget-thresholds" };
      }
    }

    return { valid: true };
  }

  function buildCreatePayload(values) {
    const s = new Date(values.startDate);
    const e = new Date(values.endDate);
    const currency = stringOrEmpty(values.currency).trim().toUpperCase() || "USD";
    const threshCheck = parseThresholds(values.thresholds);
    const thresholds = threshCheck.valid ? threshCheck.thresholds : [50, 80, 90, 100];
    const amountNum = Number(values.amount);

    return {
      name: stringOrEmpty(values.name).trim(),
      amount: amountNum.toFixed(2),
      currency,
      periodType: stringOrEmpty(values.periodType).trim().toLowerCase() || "monthly",
      startDate: s.toISOString(),
      endDate: e.toISOString(),
      thresholds
    };
  }

  function buildEditPayload(values) {
    const payload = {};
    if (values.name !== undefined) {
      payload.name = stringOrEmpty(values.name).trim();
    }
    if (values.amount !== undefined) {
      payload.amount = Number(values.amount).toFixed(2);
    }
    if (values.status !== undefined) {
      payload.status = stringOrEmpty(values.status).trim();
    }
    if (values.thresholds !== undefined && values.thresholds !== "") {
      const threshCheck = parseThresholds(values.thresholds);
      if (threshCheck.valid) {
        payload.thresholds = threshCheck.thresholds;
      }
    }
    return payload;
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

  // Expose pure helpers on window
  window.MeterFlowBudgets = {
    canManageBudgets,
    parseThresholds,
    validateBudgetAmount,
    validateBudgetForm,
    buildCreatePayload,
    buildEditPayload,
    formatCurrency,
    formatDateTime,
    formatDateOnly,
    formatPeriod
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
  let cachedBudgets = [];
  let pendingDeactivateBudgetId = null;

  document.addEventListener("DOMContentLoaded", initBudgetsPage);

  async function initBudgetsPage() {
    setupUserProfile();
    setupMobileMenu();
    setupModals();
    setupFilterEvents();
    setupCreateBudgetForm();
    setupEditBudgetForm();
    setupDeactivateModal();

    await loadWorkspaces();
    await loadBudgets();
    await loadAlerts();

    const refreshBtn = document.getElementById("refresh-budgets-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        await loadBudgets();
        await loadAlerts();
      });
    }

    window.addEventListener("workspace-switched", async (e) => {
      const newWs = e.detail?.workspace;
      if (newWs && newWs.role) {
        currentWorkspaceRole = newWs.role;
        applyRolePermissions(currentWorkspaceRole);
      }
      clearBudgetsContainer();
      clearAlertsContainer();
      await loadWorkspaces();
      await loadBudgets();
      await loadAlerts();
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
            cachedBudgets = [];
            clearBudgetsContainer();
            clearAlertsContainer();

            await loadBudgets();
            await loadAlerts();
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
    const openCreateBtn = document.getElementById("open-create-budget-btn");

    if (roleBadgeEl) {
      const normalizedRole = stringOrEmpty(role).toLowerCase();
      roleBadgeEl.textContent = role;
      roleBadgeEl.className = `badge badge-${
        normalizedRole === "owner" ? "primary" : normalizedRole === "admin" ? "info" : "neutral"
      }`;
    }

    const canManage = canManageBudgets(role);
    if (openCreateBtn) {
      openCreateBtn.disabled = !canManage;
      if (!canManage) {
        openCreateBtn.title = "Requires Admin or Owner role in this workspace";
        openCreateBtn.style.opacity = "0.5";
        openCreateBtn.style.cursor = "not-allowed";
      } else {
        openCreateBtn.title = "";
        openCreateBtn.style.opacity = "1";
        openCreateBtn.style.cursor = "pointer";
      }
    }
  }

  function setupModals() {
    const openBtn = document.getElementById("open-create-budget-btn");
    const createModal = document.getElementById("create-budget-modal");
    const editModal = document.getElementById("edit-budget-modal");
    const deactModal = document.getElementById("deactivate-budget-modal");

    if (openBtn && createModal) {
      openBtn.addEventListener("click", () => {
        if (!canManageBudgets(currentWorkspaceRole)) {
          showGlobalError("Only workspace owners and administrators can create budgets.");
          return;
        }

        // Default period to current month
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59);

        const startInput = document.getElementById("budget-start-date");
        const endInput = document.getElementById("budget-end-date");
        if (startInput && !startInput.value) startInput.value = formatDateTimeLocal(start);
        if (endInput && !endInput.value) endInput.value = formatDateTimeLocal(end);

        hideCreateModalError();
        createModal.classList.add("open");
      });
    }

    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const modalId = btn.getAttribute("data-close-modal");
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.remove("open");
      });
    });

    [createModal, editModal, deactModal].forEach((modal) => {
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

  function setupCreateBudgetForm() {
    const form = document.getElementById("create-budget-form");
    const submitBtn = document.getElementById("create-budget-submit-btn");

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        hideCreateModalError();

        if (!canManageBudgets(currentWorkspaceRole)) {
          showCreateModalError("Only workspace owners and administrators can create budgets.");
          return;
        }

        const name = document.getElementById("budget-name")?.value.trim();
        const amount = document.getElementById("budget-amount")?.value;
        const currency = document.getElementById("budget-currency")?.value.trim().toUpperCase() || "USD";
        const periodType = document.getElementById("budget-period-type")?.value || "monthly";
        const startVal = document.getElementById("budget-start-date")?.value;
        const endVal = document.getElementById("budget-end-date")?.value;
        const rawThresholds = document.getElementById("budget-thresholds")?.value;

        const validation = validateBudgetForm("create", {
          name,
          amount,
          currency,
          periodType,
          startDate: startVal,
          endDate: endVal,
          thresholds: rawThresholds
        });

        if (validation.error) {
          showCreateModalError(validation.error);
          return;
        }

        const payload = buildCreatePayload({
          name,
          amount,
          currency,
          periodType,
          startDate: startVal,
          endDate: endVal,
          thresholds: rawThresholds
        });

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Creating...";
        }

        try {
          const res = await api.post("/api/budgets", payload);

          if (res.success && res.data) {
            form.reset();
            document.getElementById("create-budget-modal")?.classList.remove("open");
            showGlobalSuccess(`Budget "${res.data.budget.name}" created successfully.`);
            await loadBudgets();
            await loadAlerts();
          }
        } catch (err) {
          showCreateModalError(err.message || "Failed to create budget.");
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Create Budget";
          }
        }
      });
    }
  }

  function showCreateModalError(msg) {
    const errorBanner = document.getElementById("create-budget-error");
    if (errorBanner) {
      errorBanner.textContent = msg;
      errorBanner.style.display = "block";
    }
  }

  function hideCreateModalError() {
    const errorBanner = document.getElementById("create-budget-error");
    if (errorBanner) {
      errorBanner.textContent = "";
      errorBanner.style.display = "none";
    }
  }

  function setupEditBudgetForm() {
    const form = document.getElementById("edit-budget-form");
    const submitBtn = document.getElementById("edit-budget-submit-btn");

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        hideEditModalError();

        if (!canManageBudgets(currentWorkspaceRole)) {
          showEditModalError("Only workspace owners and administrators can edit budgets.");
          return;
        }

        const id = document.getElementById("edit-budget-id")?.value;
        const name = document.getElementById("edit-budget-name")?.value.trim();
        const amount = document.getElementById("edit-budget-amount")?.value;
        const status = document.getElementById("edit-budget-status")?.value;
        const rawThresholds = document.getElementById("edit-budget-thresholds")?.value;

        const validation = validateBudgetForm("edit", {
          name,
          amount,
          status,
          thresholds: rawThresholds
        });

        if (validation.error) {
          showEditModalError(validation.error);
          return;
        }

        const payload = buildEditPayload({
          name,
          amount,
          status,
          thresholds: rawThresholds
        });

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Saving...";
        }

        try {
          const res = await api.put(`/api/budgets/${id}`, payload);
          if (res.success && res.data) {
            document.getElementById("edit-budget-modal")?.classList.remove("open");
            showGlobalSuccess(`Budget "${res.data.budget.name}" updated successfully.`);
            await loadBudgets();
            await loadAlerts();
          }
        } catch (err) {
          showEditModalError(err.message || "Failed to update budget.");
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Save Changes";
          }
        }
      });
    }
  }

  function showEditModalError(msg) {
    const errorBanner = document.getElementById("edit-budget-error");
    if (errorBanner) {
      errorBanner.textContent = msg;
      errorBanner.style.display = "block";
    }
  }

  function hideEditModalError() {
    const errorBanner = document.getElementById("edit-budget-error");
    if (errorBanner) {
      errorBanner.textContent = "";
      errorBanner.style.display = "none";
    }
  }

  function setupDeactivateModal() {
    const confirmBtn = document.getElementById("deactivate-confirm-btn");
    const modal = document.getElementById("deactivate-budget-modal");
    const errorBanner = document.getElementById("deactivate-modal-error");

    if (confirmBtn) {
      confirmBtn.addEventListener("click", async () => {
        if (!pendingDeactivateBudgetId) return;
        if (errorBanner) {
          errorBanner.textContent = "";
          errorBanner.style.display = "none";
        }

        confirmBtn.disabled = true;
        confirmBtn.textContent = "Deactivating...";

        try {
          const res = await api.delete(`/api/budgets/${pendingDeactivateBudgetId}`);
          if (res.success) {
            if (modal) modal.classList.remove("open");
            showGlobalSuccess("Budget deactivated successfully (archived).");
            pendingDeactivateBudgetId = null;
            await loadBudgets();
          }
        } catch (err) {
          if (errorBanner) {
            errorBanner.textContent = err.message || "Failed to deactivate budget.";
            errorBanner.style.display = "block";
          }
        } finally {
          confirmBtn.disabled = false;
          confirmBtn.textContent = "Deactivate Budget";
        }
      });
    }
  }

  function openDeactivateBudgetModal(budget) {
    if (!budget) return;
    pendingDeactivateBudgetId = budget.id;

    const modal = document.getElementById("deactivate-budget-modal");
    const nameEl = document.getElementById("deactivate-budget-name");
    const errorBanner = document.getElementById("deactivate-modal-error");

    if (nameEl) nameEl.textContent = budget.name;
    if (errorBanner) {
      errorBanner.textContent = "";
      errorBanner.style.display = "none";
    }

    if (modal) modal.classList.add("open");
  }

  function setupFilterEvents() {
    const applyBtn = document.getElementById("apply-filters-btn");
    const resetBtn = document.getElementById("reset-filters-btn");
    const alertStatusSelect = document.getElementById("filter-alert-status");

    if (applyBtn) {
      applyBtn.addEventListener("click", () => loadBudgets());
    }

    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        const statusSelect = document.getElementById("filter-status");
        const currInput = document.getElementById("filter-currency");
        if (statusSelect) statusSelect.value = "active";
        if (currInput) currInput.value = "";
        loadBudgets();
      });
    }

    if (alertStatusSelect) {
      alertStatusSelect.addEventListener("change", () => loadAlerts());
    }
  }

  function clearBudgetsContainer() {
    const container = document.getElementById("budgets-container");
    if (container) container.textContent = "";
  }

  function clearAlertsContainer() {
    const container = document.getElementById("alerts-list-container");
    if (container) container.textContent = "";
  }

  async function loadBudgets() {
    const container = document.getElementById("budgets-container");
    const emptyState = document.getElementById("budgets-empty");
    const countBadge = document.getElementById("budgets-count-badge");
    const errorBanner = document.getElementById("budgets-error-banner");

    if (errorBanner) errorBanner.style.display = "none";

    const status = document.getElementById("filter-status")?.value;
    const currency = document.getElementById("filter-currency")?.value.trim().toUpperCase();

    const params = {};
    if (status) params.status = status;
    if (currency) params.currency = currency;

    if (container) {
      container.textContent = "";
      const loadingDiv = document.createElement("div");
      loadingDiv.style.textAlign = "center";
      loadingDiv.style.color = "var(--color-text-muted)";
      loadingDiv.style.padding = "2rem";
      loadingDiv.textContent = "Loading budgets and forecasts...";
      container.appendChild(loadingDiv);
    }

    try {
      const res = await api.get("/api/budgets", params);
      const budgets = res.data && Array.isArray(res.data.budgets) ? res.data.budgets : [];
      cachedBudgets = budgets;

      if (countBadge) {
        countBadge.textContent = `${budgets.length} Budget${budgets.length === 1 ? "" : "s"}`;
      }

      updateSummaryKPIs(budgets);

      if (budgets.length === 0) {
        clearBudgetsContainer();
        if (emptyState) emptyState.style.display = "block";
        return;
      }

      if (emptyState) emptyState.style.display = "none";
      renderBudgets(budgets);
    } catch (err) {
      if (errorBanner) {
        errorBanner.textContent = `Error loading budgets: ${err.message}`;
        errorBanner.style.display = "block";
      }
      if (container) {
        container.textContent = "";
        const errDiv = document.createElement("div");
        errDiv.style.textAlign = "center";
        errDiv.style.color = "var(--color-danger)";
        errDiv.style.padding = "2rem";
        errDiv.textContent = "Failed to load budgets.";
        container.appendChild(errDiv);
      }
    }
  }

  function updateSummaryKPIs(budgets) {
    const activeBudgetsEl = document.getElementById("metric-active-budgets");
    const totalBudgetEl = document.getElementById("metric-total-budget");

    const activeList = budgets.filter((b) => b.status === "active");
    if (activeBudgetsEl) activeBudgetsEl.textContent = activeList.length.toString();

    let totalSum = 0;
    let curr = "USD";
    activeList.forEach((b) => {
      const val = parseFloat(b.amount) || 0;
      totalSum += val;
      if (b.currency) curr = b.currency;
    });

    if (totalBudgetEl) {
      totalBudgetEl.textContent = `${curr} ${totalSum.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}`;
    }
  }

  // --- Safe DOM Rendering for Budgets ---

  function renderBudgets(budgets) {
    const container = document.getElementById("budgets-container");
    if (!container) return;

    container.textContent = "";
    const canManage = canManageBudgets(currentWorkspaceRole);

    budgets.forEach((b) => {
      const card = document.createElement("div");
      card.className = "metric-card";
      card.style.padding = "var(--space-xl)";

      const percentage = typeof b.percentageUsed === "number" ? b.percentageUsed : 0;
      const clampedPct = Math.min(100, Math.max(0, percentage));

      let fillClass = "fill-safe";
      if (percentage >= 100) {
        fillClass = "fill-danger";
      } else if (percentage >= 50) {
        fillClass = "fill-warning";
      }

      // Top Row: Title, Badges & Actions
      const topRow = document.createElement("div");
      topRow.style.display = "flex";
      topRow.style.justifyContent = "space-between";
      topRow.style.alignItems = "flex-start";
      topRow.style.marginBottom = "var(--space-md)";
      topRow.style.flexWrap = "wrap";
      topRow.style.gap = "var(--space-sm)";

      // Title & Meta
      const titleCol = document.createElement("div");
      const titleWrap = document.createElement("div");
      titleWrap.style.display = "flex";
      titleWrap.style.alignItems = "center";
      titleWrap.style.gap = "var(--space-sm)";

      const h3 = document.createElement("h3");
      h3.style.fontSize = "1.15rem";
      h3.style.margin = "0";
      h3.textContent = b.name;
      titleWrap.appendChild(h3);

      const statusBadge = document.createElement("span");
      statusBadge.className = `badge badge-${b.status === "active" ? "success" : "neutral"}`;
      statusBadge.textContent = b.status;
      titleWrap.appendChild(statusBadge);

      const periodBadge = document.createElement("span");
      periodBadge.className = "badge badge-neutral";
      periodBadge.style.textTransform = "capitalize";
      periodBadge.textContent = b.periodType;
      titleWrap.appendChild(periodBadge);
      titleCol.appendChild(titleWrap);

      const metaDiv = document.createElement("div");
      metaDiv.style.fontSize = "0.8rem";
      metaDiv.style.color = "var(--color-text-muted)";
      metaDiv.style.marginTop = "2px";
      const thresholdText = (b.thresholds || []).join("%, ") + "%";
      metaDiv.textContent = `Period: ${formatPeriod(b.startDate, b.endDate)} · Alert Thresholds: [${thresholdText}]`;
      titleCol.appendChild(metaDiv);
      topRow.appendChild(titleCol);

      // Actions Column
      const actionCol = document.createElement("div");
      actionCol.style.display = "flex";
      actionCol.style.gap = "var(--space-xs)";

      // 1. Evaluate Alerts Button
      const evalBtn = document.createElement("button");
      evalBtn.className = "btn btn-secondary btn-sm action-evaluate-btn";
      evalBtn.style.fontSize = "0.8rem";
      evalBtn.textContent = "Evaluate Alerts";
      if (!canManage) {
        evalBtn.disabled = true;
        evalBtn.title = "Requires Admin or Owner role";
        evalBtn.style.opacity = "0.6";
        evalBtn.style.cursor = "not-allowed";
      } else {
        evalBtn.addEventListener("click", () => evaluateBudgetAction(b.id, evalBtn));
      }
      actionCol.appendChild(evalBtn);

      // 2. Edit Button
      const editBtn = document.createElement("button");
      editBtn.className = "btn btn-secondary btn-sm action-edit-btn";
      editBtn.style.fontSize = "0.8rem";
      editBtn.textContent = "Edit";
      if (!canManage) {
        editBtn.disabled = true;
        editBtn.title = "Requires Admin or Owner role";
        editBtn.style.opacity = "0.6";
        editBtn.style.cursor = "not-allowed";
      } else {
        editBtn.addEventListener("click", () => openEditBudgetModal(b.id));
      }
      actionCol.appendChild(editBtn);

      // 3. Deactivate Button (if active)
      if (b.status === "active") {
        const deactBtn = document.createElement("button");
        deactBtn.className = "btn btn-secondary btn-sm action-archive-btn";
        deactBtn.style.color = "var(--color-danger)";
        deactBtn.style.fontSize = "0.8rem";
        deactBtn.textContent = "Deactivate";
        if (!canManage) {
          deactBtn.disabled = true;
          deactBtn.title = "Requires Admin or Owner role";
          deactBtn.style.opacity = "0.6";
          deactBtn.style.cursor = "not-allowed";
        } else {
          deactBtn.addEventListener("click", () => openDeactivateBudgetModal(b));
        }
        actionCol.appendChild(deactBtn);
      }

      topRow.appendChild(actionCol);
      card.appendChild(topRow);

      // Spend Summary & Progress Bar Section
      const budgetItem = document.createElement("div");
      budgetItem.className = "budget-item";

      const budgetItemTop = document.createElement("div");
      budgetItemTop.className = "budget-item-top";

      const spendLabel = document.createElement("span");
      spendLabel.className = "budget-item-name";
      spendLabel.textContent = "Actual Spend";
      budgetItemTop.appendChild(spendLabel);

      const statsSpan = document.createElement("span");
      statsSpan.className = "budget-item-stats";

      const strongSpend = document.createElement("strong");
      strongSpend.textContent = formatCurrency(b.actualSpend || "0.00", b.currency);
      statsSpan.appendChild(strongSpend);

      const limitText = document.createTextNode(` of ${formatCurrency(b.amount, b.currency)} (${percentage}%)`);
      statsSpan.appendChild(limitText);

      budgetItemTop.appendChild(statsSpan);
      budgetItem.appendChild(budgetItemTop);

      const progressTrack = document.createElement("div");
      progressTrack.className = "progress-track";
      progressTrack.style.height = "10px";

      const progressFill = document.createElement("div");
      progressFill.className = `progress-fill ${fillClass}`;
      progressFill.style.width = `${clampedPct}%`;
      progressTrack.appendChild(progressFill);

      budgetItem.appendChild(progressTrack);
      card.appendChild(budgetItem);

      // Forecast Section
      if (b.forecast) {
        const f = b.forecast;
        const forecastCard = document.createElement("div");
        forecastCard.className = "forecast-card";

        if (f.hasSufficientData) {
          const forecastTitle = document.createElement("div");
          forecastTitle.className = "forecast-title";

          const titleSpan = document.createElement("span");
          titleSpan.textContent = "📈 Deterministic Linear Run-Rate Forecast";
          forecastTitle.appendChild(titleSpan);

          const overrunBadge = document.createElement("span");
          if (f.isProjectedToExceed) {
            overrunBadge.className = "badge badge-danger";
            overrunBadge.style.marginLeft = "8px";
            overrunBadge.textContent = `Projected Overrun: +${formatCurrency(f.projectedVariance, f.currency)}`;
          } else {
            overrunBadge.className = "badge badge-success";
            overrunBadge.style.marginLeft = "8px";
            overrunBadge.textContent = "On Track";
          }
          forecastTitle.appendChild(overrunBadge);
          forecastCard.appendChild(forecastTitle);

          // Forecast Grid
          const forecastGrid = document.createElement("div");
          forecastGrid.className = "forecast-grid";

          // Item 1: Projected Spend
          const item1 = document.createElement("div");
          item1.className = "forecast-item";
          const item1Label = document.createElement("span");
          item1Label.className = "forecast-item-label";
          item1Label.textContent = "Projected Spend";
          item1.appendChild(item1Label);
          const item1Val = document.createElement("span");
          item1Val.className = "forecast-item-value";
          if (f.isProjectedToExceed) {
            item1Val.style.color = "var(--color-danger)";
          }
          item1Val.textContent = formatCurrency(f.forecastSpend, f.currency);
          item1.appendChild(item1Val);
          forecastGrid.appendChild(item1);

          // Item 2: Daily Burn Rate
          const item2 = document.createElement("div");
          item2.className = "forecast-item";
          const item2Label = document.createElement("span");
          item2Label.className = "forecast-item-label";
          item2Label.textContent = "Daily Burn Rate";
          item2.appendChild(item2Label);
          const item2Val = document.createElement("span");
          item2Val.className = "forecast-item-value";
          item2Val.textContent = `${formatCurrency(f.dailyAverageSpend, f.currency)} / day`;
          item2.appendChild(item2Val);
          forecastGrid.appendChild(item2);

          // Item 3: Period Window
          const item3 = document.createElement("div");
          item3.className = "forecast-item";
          const item3Label = document.createElement("span");
          item3Label.className = "forecast-item-label";
          item3Label.textContent = "Period Window";
          item3.appendChild(item3Label);
          const item3Val = document.createElement("span");
          item3Val.className = "forecast-item-value";
          const elapsedDays = f.dataWindow?.daysElapsed || 0;
          const totalDays = f.dataWindow?.daysTotal || 0;
          item3Val.textContent = `${elapsedDays} of ${totalDays} days`;
          item3.appendChild(item3Val);
          forecastGrid.appendChild(item3);

          forecastCard.appendChild(forecastGrid);

          // Assumptions & Limitations
          const assumptionsDiv = document.createElement("div");
          assumptionsDiv.style.fontSize = "0.75rem";
          assumptionsDiv.style.color = "var(--color-text-muted)";
          assumptionsDiv.style.marginTop = "var(--space-xs)";

          const strongAssump = document.createElement("strong");
          strongAssump.textContent = "Assumptions: ";
          assumptionsDiv.appendChild(strongAssump);
          assumptionsDiv.appendChild(document.createTextNode(f.assumptions || "Constant daily linear rate."));
          forecastCard.appendChild(assumptionsDiv);
        } else {
          // Insufficient data or period not started
          forecastCard.style.borderStyle = "solid";
          forecastCard.style.background = "var(--color-bg-body)";

          const noteDiv = document.createElement("div");
          noteDiv.style.fontSize = "0.8rem";
          noteDiv.style.color = "var(--color-text-muted)";

          const noteStrong = document.createElement("strong");
          noteStrong.textContent = "ℹ️ Forecast Note: ";
          noteDiv.appendChild(noteStrong);
          noteDiv.appendChild(document.createTextNode(f.reason || "Insufficient historical data in this period."));
          forecastCard.appendChild(noteDiv);
        }

        card.appendChild(forecastCard);
      }

      container.appendChild(card);
    });
  }

  async function evaluateBudgetAction(budgetId, btn) {
    if (!canManageBudgets(currentWorkspaceRole)) {
      showGlobalError("Only workspace owners and administrators can evaluate budget alerts.");
      return;
    }

    btn.disabled = true;
    btn.textContent = "Evaluating...";

    try {
      const res = await api.post(`/api/budgets/${budgetId}/evaluate`);
      if (res.success && res.data) {
        const newCount = Array.isArray(res.data.newAlerts) ? res.data.newAlerts.length : 0;
        showGlobalSuccess(`Evaluation complete: ${newCount} new alert(s) triggered.`);
        await loadBudgets();
        await loadAlerts();
      }
    } catch (err) {
      showGlobalError(`Evaluation failed: ${err.message || "Unknown error"}`);
    } finally {
      btn.disabled = false;
      btn.textContent = "Evaluate Alerts";
    }
  }

  function openEditBudgetModal(budgetId) {
    const budget = cachedBudgets.find((b) => b.id === budgetId);
    if (!budget) return;

    const modal = document.getElementById("edit-budget-modal");
    const idInput = document.getElementById("edit-budget-id");
    const nameInput = document.getElementById("edit-budget-name");
    const amountInput = document.getElementById("edit-budget-amount");
    const statusSelect = document.getElementById("edit-budget-status");
    const thresholdsInput = document.getElementById("edit-budget-thresholds");

    if (idInput) idInput.value = budget.id;
    if (nameInput) nameInput.value = budget.name || "";
    if (amountInput) amountInput.value = budget.amount || "";
    if (statusSelect) statusSelect.value = budget.status || "active";
    if (thresholdsInput) thresholdsInput.value = (budget.thresholds || []).join(", ");

    hideEditModalError();
    if (modal) modal.classList.add("open");
  }

  // --- Alerts Handling & Safe DOM Rendering ---

  async function loadAlerts() {
    const container = document.getElementById("alerts-list-container");
    const emptyState = document.getElementById("alerts-empty");
    const triggeredKpiEl = document.getElementById("metric-triggered-alerts");

    const statusFilter = document.getElementById("filter-alert-status")?.value;
    const params = { limit: 50 };
    if (statusFilter) params.status = statusFilter;

    try {
      const res = await api.get("/api/budgets/alerts", params);
      const alerts = res.data && Array.isArray(res.data.alerts) ? res.data.alerts : [];

      const activeAlerts = alerts.filter((a) => a.status === "active");
      if (triggeredKpiEl) triggeredKpiEl.textContent = activeAlerts.length.toString();

      if (alerts.length === 0) {
        clearAlertsContainer();
        if (emptyState) emptyState.style.display = "block";
        return;
      }

      if (emptyState) emptyState.style.display = "none";
      renderAlerts(alerts);
    } catch (err) {
      console.error("Failed to load alerts:", err.message);
    }
  }

  function renderAlerts(alerts) {
    const container = document.getElementById("alerts-list-container");
    if (!container) return;

    container.textContent = "";

    alerts.forEach((alertDoc) => {
      const item = document.createElement("div");
      const isExceeded = alertDoc.alertType === "threshold_exceeded" || alertDoc.threshold >= 100;
      item.className = `alert-item ${isExceeded ? "alert-exceeded" : "alert-reached"}`;

      const infoDiv = document.createElement("div");
      infoDiv.className = "alert-item-info";

      // Alert Title Row
      const titleRow = document.createElement("div");
      titleRow.className = "alert-item-title";

      const nameSpan = document.createElement("span");
      nameSpan.textContent = alertDoc.budgetName || "Budget";
      titleRow.appendChild(nameSpan);

      const typeBadge = document.createElement("span");
      typeBadge.className = `badge ${isExceeded ? "badge-danger" : "badge-warning"}`;
      typeBadge.style.marginLeft = "6px";
      typeBadge.textContent = `${alertDoc.threshold}% Threshold ${isExceeded ? "Exceeded" : "Reached"}`;
      titleRow.appendChild(typeBadge);
      infoDiv.appendChild(titleRow);

      // Alert Meta Row
      const metaRow = document.createElement("div");
      metaRow.className = "alert-item-meta";
      const actualSpendFormatted = formatCurrency(alertDoc.actualSpend, alertDoc.currency);
      const budgetAmountFormatted = formatCurrency(alertDoc.budgetAmount, alertDoc.currency);
      const triggeredDate = formatDateTime(alertDoc.triggeredAt);
      metaRow.textContent = `Actual Spend: ${actualSpendFormatted} of ${budgetAmountFormatted} (${alertDoc.percentageUsed}%) · Triggered: ${triggeredDate}`;
      infoDiv.appendChild(metaRow);
      item.appendChild(infoDiv);

      // Alert Action Column
      const actionDiv = document.createElement("div");
      actionDiv.className = "alert-item-action";

      if (alertDoc.status === "acknowledged") {
        const ackBadge = document.createElement("span");
        ackBadge.className = "badge badge-neutral";
        ackBadge.textContent = "Acknowledged";
        actionDiv.appendChild(ackBadge);
      } else {
        const ackBtn = document.createElement("button");
        ackBtn.className = "btn btn-secondary btn-sm ack-btn";
        ackBtn.setAttribute("data-alert-id", alertDoc.id);
        ackBtn.textContent = "Acknowledge";

        ackBtn.addEventListener("click", async () => {
          ackBtn.disabled = true;
          ackBtn.textContent = "Updating...";

          try {
            const ackRes = await api.patch(`/api/budgets/alerts/${alertDoc.id}/ack`);
            if (ackRes.success) {
              actionDiv.textContent = "";
              const ackBadge = document.createElement("span");
              ackBadge.className = "badge badge-neutral";
              ackBadge.textContent = "Acknowledged";
              actionDiv.appendChild(ackBadge);
              await loadAlerts();
            }
          } catch (ackErr) {
            ackBtn.disabled = false;
            ackBtn.textContent = "Acknowledge";
            showGlobalError("Failed to acknowledge alert: " + (ackErr.message || "Unknown error"));
          }
        });

        actionDiv.appendChild(ackBtn);
      }

      item.appendChild(actionDiv);
      container.appendChild(item);
    });
  }

  // --- Banner Notifications ---

  function showGlobalSuccess(msg) {
    const banner = document.getElementById("budgets-success-banner");
    if (!banner) return;
    banner.textContent = msg;
    banner.style.display = "block";
    setTimeout(() => {
      banner.style.display = "none";
    }, 5000);
  }

  function showGlobalError(msg) {
    const banner = document.getElementById("budgets-error-banner");
    if (!banner) return;
    banner.textContent = msg;
    banner.style.display = "block";
    setTimeout(() => {
      banner.style.display = "none";
    }, 6000);
  }
})(window);
