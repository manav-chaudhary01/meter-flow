/**
 * MeterFlow SaaS Dashboard Controller
 * Orchestrates multi-tenant context, data aggregation, invoices, budgets, and alerts.
 */

(function (window) {
  "use strict";

  const api = window.MeterFlowAPI;
  const auth = window.MeterFlowAuth;

  // Ensure user is authenticated before executing dashboard logic
  if (!auth.requireAuth()) return;

  document.addEventListener("DOMContentLoaded", initDashboard);

  async function initDashboard() {
    setupUserProfile();
    setupNavigation();
    setupMobileMenu();

    await loadWorkspaces();
    await loadDashboardData();

    const refreshBtn = document.getElementById("refresh-dashboard-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        loadDashboardData(true);
      });
    }
  }

  // Set up header profile and logout action
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

  // Sidebar link visual active state
  function setupNavigation() {
    const navItems = document.querySelectorAll(".sidebar-nav .nav-item");
    navItems.forEach((item) => {
      item.addEventListener("click", (e) => {
        const href = item.getAttribute("href");
        if (href === "#" || !href) {
          e.preventDefault();
        }
      });
    });
  }

  // Mobile sidebar toggle handler
  function setupMobileMenu() {
    const mobileBtn = document.getElementById("mobile-menu-btn");
    const sidebar = document.getElementById("sidebar");

    if (mobileBtn && sidebar) {
      mobileBtn.addEventListener("click", () => {
        sidebar.classList.toggle("open");
      });

      // Close sidebar when clicking outside on mobile
      document.addEventListener("click", (e) => {
        if (sidebar.classList.contains("open") && !sidebar.contains(e.target) && !mobileBtn.contains(e.target)) {
          sidebar.classList.remove("open");
        }
      });
    }
  }

  // Load user's accessible workspaces & configure context switcher
  async function loadWorkspaces() {
    const selectEl = document.getElementById("workspace-select");
    const roleBadgeEl = document.getElementById("workspace-role-badge");
    if (!selectEl) return;

    try {
      const res = await api.get("/api/workspaces");
      if (res.success && res.data && Array.isArray(res.data.workspaces)) {
        selectEl.innerHTML = "";
        let currentRole = "member";

        res.data.workspaces.forEach((ws) => {
          const option = document.createElement("option");
          option.value = ws.id;
          option.textContent = `${ws.name} (${ws.type})`;
          if (ws.isCurrent) {
            option.selected = true;
            currentRole = ws.role;
          }
          selectEl.appendChild(option);
        });

        if (roleBadgeEl) {
          roleBadgeEl.textContent = currentRole;
          roleBadgeEl.className = `badge badge-${currentRole === "owner" ? "primary" : currentRole === "admin" ? "info" : "neutral"}`;
        }
      }
    } catch (err) {
      console.error("Failed to load workspaces:", err.message);
    }

    // Handle workspace switching
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

          // Reload fresh workspace data
          await loadDashboardData(true);

          if (roleBadgeEl && switchRes.data.workspace.role) {
            const newRole = switchRes.data.workspace.role;
            roleBadgeEl.textContent = newRole;
            roleBadgeEl.className = `badge badge-${newRole === "owner" ? "primary" : newRole === "admin" ? "info" : "neutral"}`;
          }
        }
      } catch (switchErr) {
        alert("Failed to switch workspace: " + (switchErr.message || "Unknown error"));
      } finally {
        selectEl.disabled = false;
      }
    });
  }

  // Concurrently fetch and populate all dashboard data
  async function loadDashboardData(isRefresh = false) {
    const errorBanner = document.getElementById("dashboard-error-banner");
    if (errorBanner) errorBanner.style.display = "none";

    setLoadingState(true);

    try {
      // Execute all core queries concurrently
      const [servicesResult, billingResult, budgetsResult, alertsResult] = await Promise.allSettled([
        api.get("/api/services"),
        api.get("/api/billing", { limit: 5 }),
        api.get("/api/budgets", { limit: 5 }),
        api.get("/api/budgets/alerts", { limit: 5 })
      ]);

      const services = servicesResult.status === "fulfilled" && servicesResult.value.success
        ? servicesResult.value.data.services || []
        : [];

      const billingRecords = billingResult.status === "fulfilled" && billingResult.value.success
        ? billingResult.value.data.billingRecords || []
        : [];

      const budgets = budgetsResult.status === "fulfilled" && budgetsResult.value.success
        ? budgetsResult.value.data.budgets || []
        : [];

      const alerts = alertsResult.status === "fulfilled" && alertsResult.value.success
        ? alertsResult.value.data.alerts || []
        : [];

      // Render summary cards and tables
      renderSummaryCards(services, billingRecords, budgets, alerts);
      renderInvoicesTable(billingRecords);
      renderBudgetsList(budgets);
      renderAlertsList(alerts);
    } catch (err) {
      console.error("Dashboard data load error:", err);
      if (errorBanner) {
        errorBanner.textContent = "Error loading dashboard metrics: " + (err.message || "Please try again.");
        errorBanner.style.display = "flex";
      }
    } finally {
      setLoadingState(false);
    }
  }

  // Render the 4 high-level KPI cards
  function renderSummaryCards(services, billingRecords, budgets, alerts) {
    const activeServicesEl = document.getElementById("metric-active-services");
    const activeServicesSubEl = document.getElementById("metric-active-services-sub");
    const totalSpendEl = document.getElementById("metric-total-spend");
    const totalSpendSubEl = document.getElementById("metric-total-spend-sub");
    const activeBudgetsEl = document.getElementById("metric-active-budgets");
    const activeBudgetsSubEl = document.getElementById("metric-active-budgets-sub");
    const activeAlertsEl = document.getElementById("metric-active-alerts");
    const activeAlertsSubEl = document.getElementById("metric-active-alerts-sub");

    // 1. Active Services
    const activeServicesCount = services.filter((s) => s.status === "active").length;
    if (activeServicesEl) activeServicesEl.textContent = activeServicesCount;
    if (activeServicesSubEl) {
      const meteredCount = services.filter((s) => s.trackingType === "metered").length;
      const subCount = services.filter((s) => s.trackingType === "subscription" || s.trackingType === "hybrid").length;
      activeServicesSubEl.textContent = `${meteredCount} metered · ${subCount} sub/hybrid`;
    }

    // 2. Total Invoiced Spend (sum of recent issued/finalized invoices)
    let totalSpend = 0;
    let currency = "USD";
    billingRecords.forEach((b) => {
      totalSpend += parseFloat(b.total || 0);
      if (b.currency) currency = b.currency;
    });

    if (totalSpendEl) {
      totalSpendEl.textContent = `${currency} ${totalSpend.toFixed(2)}`;
    }
    if (totalSpendSubEl) {
      totalSpendSubEl.textContent = `Across ${billingRecords.length} recent billing cycles`;
    }

    // 3. Active Budgets
    const activeBudgetsCount = budgets.filter((b) => b.status === "active").length;
    if (activeBudgetsEl) activeBudgetsEl.textContent = activeBudgetsCount;
    if (activeBudgetsSubEl) {
      activeBudgetsSubEl.textContent = activeBudgetsCount > 0 ? "Spend limits actively monitored" : "No active limits defined";
    }

    // 4. Active Alerts
    const unacknowledgedAlerts = alerts.filter((a) => a.status === "active").length;
    if (activeAlertsEl) {
      activeAlertsEl.textContent = unacknowledgedAlerts;
      activeAlertsEl.style.color = unacknowledgedAlerts > 0 ? "var(--color-danger)" : "var(--color-text-main)";
    }
    if (activeAlertsSubEl) {
      activeAlertsSubEl.textContent = unacknowledgedAlerts > 0 ? "Requires review or acknowledgment" : "All alerts acknowledged";
    }
  }

  // Render recent invoices table
  function renderInvoicesTable(invoices) {
    const tbody = document.getElementById("invoices-table-body");
    const emptyEl = document.getElementById("invoices-empty");
    if (!tbody) return;

    if (!invoices || invoices.length === 0) {
      tbody.innerHTML = "";
      if (emptyEl) emptyEl.style.display = "block";
      return;
    }

    if (emptyEl) emptyEl.style.display = "none";
    tbody.innerHTML = "";

    invoices.forEach((inv) => {
      const tr = document.createElement("tr");

      const startDate = inv.billingPeriodStart ? new Date(inv.billingPeriodStart).toLocaleDateString() : "";
      const endDate = inv.billingPeriodEnd ? new Date(inv.billingPeriodEnd).toLocaleDateString() : "";
      const periodStr = startDate && endDate ? `${startDate} – ${endDate}` : "N/A";
      const lineItemCount = Array.isArray(inv.lineItems) ? inv.lineItems.length : 0;

      let statusBadgeClass = "badge-neutral";
      if (inv.status === "finalized") statusBadgeClass = "badge-success";
      else if (inv.status === "issued") statusBadgeClass = "badge-warning";
      else if (inv.status === "void") statusBadgeClass = "badge-danger";

      tr.innerHTML = `
        <td style="font-family: var(--font-mono); font-weight: 600;">${escapeHtml(inv.invoiceNumber || inv.id)}</td>
        <td>${escapeHtml(periodStr)}</td>
        <td>${lineItemCount} service(s)</td>
        <td style="font-weight: 600;">${escapeHtml(inv.currency || "USD")} ${escapeHtml(inv.total || "0.00")}</td>
        <td><span class="badge ${statusBadgeClass}">${escapeHtml(inv.status || "issued")}</span></td>
        <td style="color: var(--color-text-muted); font-size: 0.8rem;">${inv.generatedAt ? new Date(inv.generatedAt).toLocaleDateString() : "N/A"}</td>
      `;

      tbody.appendChild(tr);
    });
  }

  // Render active budgets with color-coded progress bars
  function renderBudgetsList(budgets) {
    const container = document.getElementById("budgets-list-container");
    const emptyEl = document.getElementById("budgets-empty");
    if (!container) return;

    if (!budgets || budgets.length === 0) {
      container.innerHTML = "";
      if (emptyEl) emptyEl.style.display = "block";
      return;
    }

    if (emptyEl) emptyEl.style.display = "none";
    container.innerHTML = "";

    budgets.forEach((b) => {
      const percentUsed = typeof b.percentageUsed === "number" ? b.percentageUsed : 0;
      const progressWidth = Math.min(100, Math.max(0, percentUsed));

      let fillClass = "fill-safe";
      if (percentUsed >= 100) fillClass = "fill-danger";
      else if (percentUsed >= 80) fillClass = "fill-warning";

      let forecastText = "";
      if (b.forecast && b.forecast.hasSufficientData) {
        if (b.forecast.isProjectedToExceed) {
          forecastText = `⚠️ Projected to reach ${b.currency} ${b.forecast.forecastSpend} (exceeds budget)`;
        } else {
          forecastText = `✓ On track: projected total ${b.currency} ${b.forecast.forecastSpend}`;
        }
      }

      const item = document.createElement("div");
      item.className = "budget-item";
      item.innerHTML = `
        <div class="budget-item-top">
          <span class="budget-item-name">${escapeHtml(b.name)}</span>
          <span class="budget-item-stats">
            <strong>${escapeHtml(b.currency)} ${escapeHtml(b.actualSpend || "0.00")}</strong> of ${escapeHtml(b.currency)} ${escapeHtml(b.amount)} (${percentUsed}%)
          </span>
        </div>
        <div class="progress-track" role="progressbar" aria-valuenow="${percentUsed}" aria-valuemin="0" aria-valuemax="100">
          <div class="progress-fill ${fillClass}" style="width: ${progressWidth}%;"></div>
        </div>
        ${forecastText ? `<div style="font-size: 0.775rem; color: var(--color-text-muted); margin-top: 2px;">${escapeHtml(forecastText)}</div>` : ""}
      `;

      container.appendChild(item);
    });
  }

  // Render recent alerts with one-click acknowledgment
  function renderAlertsList(alerts) {
    const container = document.getElementById("alerts-list-container");
    const emptyEl = document.getElementById("alerts-empty");
    if (!container) return;

    if (!alerts || alerts.length === 0) {
      container.innerHTML = "";
      if (emptyEl) emptyEl.style.display = "block";
      return;
    }

    if (emptyEl) emptyEl.style.display = "none";
    container.innerHTML = "";

    alerts.forEach((alertDoc) => {
      const item = document.createElement("div");
      const isExceeded = alertDoc.alertType === "threshold_exceeded" || alertDoc.threshold >= 100;
      item.className = `alert-item ${isExceeded ? "alert-exceeded" : "alert-reached"}`;

      const triggeredDate = alertDoc.triggeredAt ? new Date(alertDoc.triggeredAt).toLocaleString() : "";
      const isAcknowledged = alertDoc.status === "acknowledged";

      item.innerHTML = `
        <div class="alert-item-info">
          <div class="alert-item-title">
            <span class="badge ${isExceeded ? "badge-danger" : "badge-warning"}">${alertDoc.threshold}% ${isExceeded ? "EXCEEDED" : "REACHED"}</span>
            <span style="margin-left: 6px;">${escapeHtml(alertDoc.budgetName || "Budget Alert")}</span>
          </div>
          <div class="alert-item-meta">
            Actual Spend: ${escapeHtml(alertDoc.currency)} ${escapeHtml(alertDoc.actualSpend)} · ${escapeHtml(triggeredDate)}
          </div>
        </div>
        <div class="alert-item-action">
          ${isAcknowledged
            ? '<span class="badge badge-neutral">Acknowledged</span>'
            : `<button class="btn btn-secondary btn-sm ack-btn" data-alert-id="${alertDoc.id}">Acknowledge</button>`
          }
        </div>
      `;

      container.appendChild(item);
    });

    // Attach event listeners to acknowledgment buttons
    container.querySelectorAll(".ack-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const alertId = e.target.getAttribute("data-alert-id");
        if (!alertId) return;

        btn.disabled = true;
        btn.textContent = "Updating...";

        try {
          const ackRes = await api.patch(`/api/budgets/alerts/${alertId}/ack`);
          if (ackRes.success) {
            btn.outerHTML = '<span class="badge badge-neutral">Acknowledged</span>';
          }
        } catch (ackErr) {
          btn.disabled = false;
          btn.textContent = "Acknowledge";
          alert("Failed to acknowledge alert: " + (ackErr.message || "Unknown error"));
        }
      });
    });
  }

  // Toggle loading skeletons / states
  function setLoadingState(isLoading) {
    const refreshBtn = document.getElementById("refresh-dashboard-btn");
    if (refreshBtn) {
      refreshBtn.disabled = isLoading;
      if (isLoading) {
        refreshBtn.innerHTML = '<span class="btn-spinner" style="border-top-color: var(--color-primary);"></span> Refreshing...';
      } else {
        refreshBtn.innerHTML = "Refresh";
      }
    }
  }

  // Basic HTML entity escape helper to prevent XSS
  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})(window);
