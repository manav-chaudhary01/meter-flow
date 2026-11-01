/**
 * MeterFlow Budgets, Alerts & Forecasting Controller
 * Manages spending limits, threshold alert evaluations, and explainable linear projections.
 */

(function (window) {
  "use strict";

  const api = window.MeterFlowAPI;
  const auth = window.MeterFlowAuth;

  if (!auth.requireAuth()) return;

  let currentWorkspaceRole = "member";
  let cachedBudgets = [];

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  document.addEventListener("DOMContentLoaded", initBudgetsPage);

  async function initBudgetsPage() {
    setupUserProfile();
    setupMobileMenu();
    setupModals();
    setupFilterEvents();
    setupCreateBudgetForm();
    setupEditBudgetForm();

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
        if (sidebar.classList.contains("open") && !sidebar.contains(e.target) && !mobileBtn.contains(e.target)) {
          sidebar.classList.remove("open");
        }
      });
    }
  }

  async function loadWorkspaces() {
    const selectEl = document.getElementById("workspace-select");
    const roleBadgeEl = document.getElementById("workspace-role-badge");
    if (!selectEl) return;

    try {
      const res = await api.get("/api/workspaces");
      if (res.success && res.data && Array.isArray(res.data.workspaces)) {
        selectEl.innerHTML = "";
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

          await loadBudgets();
          await loadAlerts();
        }
      } catch (switchErr) {
        alert("Failed to switch workspace: " + (switchErr.message || "Unknown error"));
      } finally {
        selectEl.disabled = false;
      }
    });
  }

  function applyRolePermissions(role) {
    const roleBadgeEl = document.getElementById("workspace-role-badge");
    const openCreateBtn = document.getElementById("open-create-budget-btn");

    if (roleBadgeEl) {
      roleBadgeEl.textContent = role;
      roleBadgeEl.className = `badge badge-${role === "owner" ? "primary" : role === "admin" ? "info" : "neutral"}`;
    }

    const canManage = role === "owner" || role === "admin";
    if (openCreateBtn) {
      openCreateBtn.disabled = !canManage;
      if (!canManage) {
        openCreateBtn.title = "Requires Admin or Owner role in this workspace";
        openCreateBtn.style.opacity = "0.6";
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

    if (openBtn && createModal) {
      openBtn.addEventListener("click", () => {
        if (currentWorkspaceRole !== "owner" && currentWorkspaceRole !== "admin") {
          alert("Only workspace owners and administrators can create budgets.");
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

    [createModal, editModal].forEach((modal) => {
      if (modal) {
        modal.addEventListener("click", (e) => {
          if (e.target === modal) modal.classList.remove("open");
        });
      }
    });
  }

  function formatDateTimeLocal(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function setupCreateBudgetForm() {
    const form = document.getElementById("create-budget-form");
    const submitBtn = document.getElementById("create-budget-submit-btn");
    const errorBanner = document.getElementById("create-budget-error");

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (errorBanner) errorBanner.style.display = "none";

        const name = document.getElementById("budget-name")?.value.trim();
        const amount = document.getElementById("budget-amount")?.value;
        const currency = document.getElementById("budget-currency")?.value.trim().toUpperCase() || "USD";
        const periodType = document.getElementById("budget-period-type")?.value || "monthly";
        const startVal = document.getElementById("budget-start-date")?.value;
        const endVal = document.getElementById("budget-end-date")?.value;
        const rawThresholds = document.getElementById("budget-thresholds")?.value;

        if (!name || name.length < 2) {
          showModalError("Budget name must be at least 2 characters.");
          return;
        }

        if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
          showModalError("Budget amount must be a positive number (> 0).");
          return;
        }

        if (!startVal || !endVal) {
          showModalError("Both start and end dates are required.");
          return;
        }

        const startDate = new Date(startVal);
        const endDate = new Date(endVal);

        if (startDate >= endDate) {
          showModalError("Start date must be strictly before end date.");
          return;
        }

        let thresholdsArray = [50, 80, 90, 100];
        if (rawThresholds) {
          const parts = rawThresholds.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n));
          if (parts.length > 0) thresholdsArray = parts;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = "Creating...";

        try {
          const res = await api.post("/api/budgets", {
            name,
            amount,
            currency,
            periodType,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            thresholds: thresholdsArray
          });

          if (res.success) {
            form.reset();
            document.getElementById("create-budget-modal")?.classList.remove("open");
            showGlobalSuccess(`Budget "${res.data.budget.name}" created successfully.`);
            await loadBudgets();
            await loadAlerts();
          }
        } catch (err) {
          showModalError(err.message || "Failed to create budget.");
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = "Create Budget";
        }
      });
    }

    function showModalError(msg) {
      if (errorBanner) {
        errorBanner.textContent = msg;
        errorBanner.style.display = "block";
      }
    }
  }

  function setupEditBudgetForm() {
    const form = document.getElementById("edit-budget-form");
    const submitBtn = document.getElementById("edit-budget-submit-btn");
    const errorBanner = document.getElementById("edit-budget-error");

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (errorBanner) errorBanner.style.display = "none";

        const id = document.getElementById("edit-budget-id")?.value;
        const name = document.getElementById("edit-budget-name")?.value.trim();
        const amount = document.getElementById("edit-budget-amount")?.value;
        const status = document.getElementById("edit-budget-status")?.value;
        const rawThresholds = document.getElementById("edit-budget-thresholds")?.value;

        const payload = { name, amount, status };

        if (rawThresholds) {
          const parts = rawThresholds.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n));
          if (parts.length > 0) payload.thresholds = parts;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = "Saving...";

        try {
          const res = await api.put(`/api/budgets/${id}`, payload);
          if (res.success) {
            document.getElementById("edit-budget-modal")?.classList.remove("open");
            showGlobalSuccess(`Budget "${res.data.budget.name}" updated successfully.`);
            await loadBudgets();
            await loadAlerts();
          }
        } catch (err) {
          if (errorBanner) {
            errorBanner.textContent = err.message || "Failed to update budget.";
            errorBanner.style.display = "block";
          }
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = "Save Changes";
        }
      });
    }
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
      container.innerHTML = `
        <div style="text-align: center; color: var(--color-text-muted); padding: 2rem;">
          Loading budgets and forecasts...
        </div>
      `;
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
        if (container) container.innerHTML = "";
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
        container.innerHTML = `
          <div style="text-align: center; color: var(--color-danger); padding: 2rem;">
            Failed to load budgets.
          </div>
        `;
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
      totalBudgetEl.textContent = `${curr} ${totalSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
  }

  function renderBudgets(budgets) {
    const container = document.getElementById("budgets-container");
    if (!container) return;

    container.innerHTML = "";
    const canManage = currentWorkspaceRole === "owner" || currentWorkspaceRole === "admin";

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

      const periodDates = `${new Date(b.startDate).toLocaleDateString()} &ndash; ${new Date(b.endDate).toLocaleDateString()}`;

      // Forecast section generation
      let forecastHtml = "";
      if (b.forecast) {
        const f = b.forecast;
        if (f.hasSufficientData) {
          const overrunBadge = f.isProjectedToExceed
            ? `<span class="badge badge-danger" style="margin-left: 8px;">Projected Overrun: +${escapeHtml(f.currency)} ${escapeHtml(f.projectedVariance)}</span>`
            : '<span class="badge badge-success" style="margin-left: 8px;">On Track</span>';

          forecastHtml = `
            <div class="forecast-card">
              <div class="forecast-title">
                <span>📈 Deterministic Linear Run-Rate Forecast</span>
                ${overrunBadge}
              </div>
              <div class="forecast-grid">
                <div class="forecast-item">
                  <span class="forecast-item-label">Projected Spend</span>
                  <span class="forecast-item-value" style="color: ${f.isProjectedToExceed ? "var(--color-danger)" : "var(--color-text-main)};">
                    ${escapeHtml(f.currency)} ${escapeHtml(f.forecastSpend)}
                  </span>
                </div>
                <div class="forecast-item">
                  <span class="forecast-item-label">Daily Burn Rate</span>
                  <span class="forecast-item-value">
                    ${escapeHtml(f.currency)} ${escapeHtml(f.dailyAverageSpend)} / day
                  </span>
                </div>
                <div class="forecast-item">
                  <span class="forecast-item-label">Period Window</span>
                  <span class="forecast-item-value">
                    ${escapeHtml(f.dataWindow?.daysElapsed || 0)} of ${escapeHtml(f.dataWindow?.daysTotal || 0)} days
                  </span>
                </div>
              </div>
              <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: var(--space-xs);">
                <strong>Assumptions:</strong> ${escapeHtml(f.assumptions || "Constant daily rate.")}
              </div>
            </div>
          `;
        } else {
          forecastHtml = `
            <div class="forecast-card" style="border-style: solid; background: var(--color-bg-body);">
              <div style="font-size: 0.8rem; color: var(--color-text-muted);">
                ℹ️ <strong>Forecast Note:</strong> ${escapeHtml(f.reason || "Insufficient historical data in this period.")}
              </div>
            </div>
          `;
        }
      }

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--space-md); flex-wrap: wrap; gap: var(--space-sm);">
          <div>
            <div style="display: flex; align-items: center; gap: var(--space-sm);">
              <h3 style="font-size: 1.15rem; margin: 0;">${escapeHtml(b.name)}</h3>
              <span class="badge badge-${b.status === "active" ? "success" : "neutral"}">${escapeHtml(b.status)}</span>
              <span class="badge badge-neutral" style="text-transform: capitalize;">${escapeHtml(b.periodType)}</span>
            </div>
            <div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 2px;">
              Period: ${periodDates} · Alert Thresholds: [${escapeHtml((b.thresholds || []).join("%, "))}%]
            </div>
          </div>
          <div style="display: flex; gap: var(--space-xs);">
            <button class="btn btn-secondary btn-sm action-evaluate-btn" data-id="${b.id}" ${canManage ? "" : "disabled title='Requires Admin or Owner role'"} style="font-size: 0.8rem;">
              Evaluate Alerts
            </button>
            <button class="btn btn-secondary btn-sm action-edit-btn" data-id="${b.id}" ${canManage ? "" : "disabled title='Requires Admin or Owner role'"} style="font-size: 0.8rem;">
              Edit
            </button>
            ${
              b.status === "active"
                ? `<button class="btn btn-secondary btn-sm action-archive-btn" data-id="${b.id}" data-name="${escapeHtml(b.name)}" ${canManage ? "" : "disabled title='Requires Admin or Owner role'"} style="color: var(--color-danger); font-size: 0.8rem;">Deactivate</button>`
                : ""
            }
          </div>
        </div>

        <!-- Progress bar and spend summary -->
        <div class="budget-item">
          <div class="budget-item-top">
            <span class="budget-item-name">Actual Spend</span>
            <span class="budget-item-stats">
              <strong>${escapeHtml(b.currency)} ${escapeHtml(b.actualSpend || "0.00")}</strong> of ${escapeHtml(b.currency)} ${escapeHtml(b.amount)} (${percentage}%)
            </span>
          </div>
          <div class="progress-track" style="height: 10px;">
            <div class="progress-fill ${fillClass}" style="width: ${clampedPct}%;"></div>
          </div>
        </div>

        ${forecastHtml}
      `;

      container.appendChild(card);
    });

    // Attach budget button listeners
    container.querySelectorAll(".action-evaluate-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        evaluateBudgetAction(id, btn);
      });
    });

    container.querySelectorAll(".action-edit-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        openEditBudgetModal(id);
      });
    });

    container.querySelectorAll(".action-archive-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const name = btn.getAttribute("data-name");
        archiveBudgetAction(id, name);
      });
    });
  }

  async function evaluateBudgetAction(budgetId, btn) {
    if (currentWorkspaceRole !== "owner" && currentWorkspaceRole !== "admin") {
      alert("Only workspace owners and administrators can evaluate budget alerts.");
      return;
    }

    btn.disabled = true;
    btn.textContent = "Evaluating...";

    try {
      const res = await api.post(`/api/budgets/${budgetId}/evaluate`);
      if (res.success) {
        const newCount = res.data?.newAlerts ? res.data.newAlerts.length : 0;
        showGlobalSuccess(`Evaluation complete: ${newCount} new alert(s) triggered.`);
        await loadBudgets();
        await loadAlerts();
      }
    } catch (err) {
      alert(`Evaluation failed: ${err.message || "Unknown error"}`);
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

    if (modal) modal.classList.add("open");
  }

  async function archiveBudgetAction(budgetId, budgetName) {
    if (currentWorkspaceRole !== "owner" && currentWorkspaceRole !== "admin") {
      alert("Only workspace owners and administrators can deactivate budgets.");
      return;
    }

    const confirmed = window.confirm(
      `Deactivate budget "${budgetName}"?\n\nDeactivated (archived) budgets preserve historical alerts but will no longer monitor new spending or evaluate thresholds.`
    );

    if (!confirmed) return;

    try {
      const res = await api.delete(`/api/budgets/${budgetId}`);
      if (res.success) {
        showGlobalSuccess(`Budget "${budgetName}" deactivated.`);
        await loadBudgets();
      }
    } catch (err) {
      alert(`Failed to deactivate budget: ${err.message || "Unknown error"}`);
    }
  }

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

      const activeAlerts = alerts.filter((a) => a.status === "triggered");
      if (triggeredKpiEl) triggeredKpiEl.textContent = activeAlerts.length.toString();

      if (alerts.length === 0) {
        if (container) container.innerHTML = "";
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

    container.innerHTML = "";

    alerts.forEach((alertDoc) => {
      const item = document.createElement("div");
      const isExceeded = alertDoc.alertType === "threshold_exceeded" || alertDoc.threshold >= 100;
      item.className = `alert-item ${isExceeded ? "alert-exceeded" : "alert-reached"}`;

      const triggeredDate = alertDoc.triggeredAt
        ? new Date(alertDoc.triggeredAt).toLocaleString()
        : "--";

      const isAcknowledged = alertDoc.status === "acknowledged";

      item.innerHTML = `
        <div class="alert-item-info">
          <div class="alert-item-title">
            <span>${escapeHtml(alertDoc.budgetName || "Budget")}</span>
            <span class="badge ${isExceeded ? "badge-danger" : "badge-warning"}" style="margin-left: 6px;">
              ${escapeHtml(alertDoc.threshold)}% Threshold ${isExceeded ? "Exceeded" : "Reached"}
            </span>
          </div>
          <div class="alert-item-meta">
            Actual Spend: ${escapeHtml(alertDoc.currency)} ${escapeHtml(alertDoc.actualSpend)} of ${escapeHtml(alertDoc.currency)} ${escapeHtml(alertDoc.budgetAmount)} (${escapeHtml(alertDoc.percentageUsed)}%) · ${escapeHtml(triggeredDate)}
          </div>
        </div>
        <div class="alert-item-action">
          ${
            isAcknowledged
              ? '<span class="badge badge-neutral">Acknowledged</span>'
              : `<button class="btn btn-secondary btn-sm ack-btn" data-alert-id="${alertDoc.id}">Acknowledge</button>`
          }
        </div>
      `;

      container.appendChild(item);
    });

    container.querySelectorAll(".ack-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const alertId = btn.getAttribute("data-alert-id");
        if (!alertId) return;

        btn.disabled = true;
        btn.textContent = "Updating...";

        try {
          const ackRes = await api.patch(`/api/budgets/alerts/${alertId}/ack`);
          if (ackRes.success) {
            btn.outerHTML = '<span class="badge badge-neutral">Acknowledged</span>';
            await loadAlerts();
          }
        } catch (ackErr) {
          btn.disabled = false;
          btn.textContent = "Acknowledge";
          alert("Failed to acknowledge alert: " + (ackErr.message || "Unknown error"));
        }
      });
    });
  }

  function showGlobalSuccess(msg) {
    const banner = document.getElementById("budgets-success-banner");
    if (!banner) return;
    banner.textContent = msg;
    banner.style.display = "block";
    setTimeout(() => {
      banner.style.display = "none";
    }, 5000);
  }
})(window);
