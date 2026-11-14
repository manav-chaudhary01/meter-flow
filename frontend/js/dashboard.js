/**
 * MeterFlow SaaS Dashboard Controller
 * Orchestrates multi-tenant context, data aggregation, invoices, budgets, and alerts.
 * Strict DOM Safety: 100% safe DOM manipulation with zero innerHTML and zero window.alert.
 */

(function (window) {
  "use strict";

  const api = window.MeterFlowAPI;
  const auth = window.MeterFlowAuth;

  // Pure Helpers & Formatting
  const helpers = {
    canManage(role) {
      const r = (role || "").toLowerCase();
      return r === "owner" || r === "admin";
    },

    formatCurrency(amount, currency = "USD") {
      const curr = (currency || "USD").toUpperCase();
      const num = Number(amount);
      if (Number.isNaN(num)) {
        return `${curr} 0.00`;
      }
      try {
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: curr,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }).format(num);
      } catch {
        return `${curr} ${num.toFixed(2)}`;
      }
    },

    formatDate(isoStr) {
      if (!isoStr) return "N/A";
      const d = new Date(isoStr);
      if (Number.isNaN(d.getTime())) return "N/A";
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
      });
    },

    formatDateTime(isoStr) {
      if (!isoStr) return "N/A";
      const d = new Date(isoStr);
      if (Number.isNaN(d.getTime())) return "N/A";
      return d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    },

    formatPeriod(startIso, endIso) {
      if (!startIso || !endIso) return "N/A";
      const start = this.formatDate(startIso);
      const end = this.formatDate(endIso);
      if (start === "N/A" || end === "N/A") return "N/A";
      return `${start} – ${end}`;
    },

    calculateTotalSpend(records) {
      if (!Array.isArray(records) || records.length === 0) {
        return { total: "0.00", currency: "USD", count: 0 };
      }
      let totalCents = 0;
      let currency = "USD";
      records.forEach((b) => {
        if (b && b.total !== undefined && b.total !== null) {
          const val = Number(b.total);
          if (!Number.isNaN(val)) {
            totalCents += Math.round(val * 100);
          }
        }
        if (b && b.currency) {
          currency = b.currency.toUpperCase();
        }
      });
      return {
        total: (totalCents / 100).toFixed(2),
        currency,
        count: records.length
      };
    },

    countActiveServices(services) {
      if (!Array.isArray(services)) return { total: 0, metered: 0, subscription: 0 };
      const active = services.filter((s) => s && s.status === "active");
      const metered = active.filter((s) => s.trackingType === "metered").length;
      const sub = active.filter((s) => s.trackingType === "subscription" || s.trackingType === "hybrid").length;
      return { total: active.length, metered, subscription: sub };
    },

    countActiveBudgets(budgets) {
      if (!Array.isArray(budgets)) return 0;
      return budgets.filter((b) => b && b.status === "active").length;
    },

    countActiveAlerts(alerts) {
      if (!Array.isArray(alerts)) return 0;
      return alerts.filter((a) => a && a.status === "active").length;
    },

    buildProgressClass(percentUsed) {
      const p = Number(percentUsed) || 0;
      if (p >= 100) return "fill-danger";
      if (p >= 80) return "fill-warning";
      return "fill-safe";
    },

    buildForecastText(budget) {
      if (!budget || !budget.forecast || !budget.forecast.hasSufficientData) {
        return "";
      }
      const curr = (budget.currency || "USD").toUpperCase();
      const formattedForecast = this.formatCurrency(budget.forecast.forecastSpend, curr);
      if (budget.forecast.isProjectedToExceed) {
        return `⚠️ Projected to reach ${formattedForecast} (exceeds budget)`;
      }
      return `✓ On track: projected total ${formattedForecast}`;
    },

    buildInvoiceStatusBadge(status) {
      const s = (status || "issued").toLowerCase();
      if (s === "finalized") return { className: "badge badge-success", text: "Finalized" };
      if (s === "issued") return { className: "badge badge-warning", text: "Issued" };
      if (s === "void") return { className: "badge badge-danger", text: "Void" };
      return { className: "badge badge-neutral", text: "Draft" };
    },

    buildAlertBadge(alertDoc) {
      const isExceeded = alertDoc.alertType === "threshold_exceeded" || (Number(alertDoc.threshold) || 0) >= 100;
      return {
        className: `badge ${isExceeded ? "badge-danger" : "badge-warning"}`,
        text: `${alertDoc.threshold}% ${isExceeded ? "EXCEEDED" : "REACHED"}`
      };
    }
  };

  // Expose pure helpers for node:vm unit testing and integrations
  window.MeterFlowDashboard = helpers;

  // Ensure user is authenticated before executing dashboard logic
  if (!auth || !api || !auth.requireAuth()) return;

  let currentWorkspaceId = "";
  let currentWorkspaceRole = "member";

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
          .filter(Boolean)
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

  // Sidebar navigation and dynamic route highlighting
  function setupNavigation() {
    const currentPath = (window.location.pathname || "").toLowerCase();
    const navItems = document.querySelectorAll(".sidebar-nav .nav-item");

    navItems.forEach((item) => {
      const href = (item.getAttribute("href") || "").toLowerCase();
      const isHome =
        (currentPath === "/" || currentPath.endsWith("index.html") || currentPath === "/index.html") &&
        href.includes("index.html");

      if (isHome) {
        item.classList.add("active");
      } else if (href.includes("index.html") && currentPath !== "/" && !currentPath.endsWith("index.html")) {
        item.classList.remove("active");
      }

      item.addEventListener("click", (e) => {
        const h = item.getAttribute("href");
        if (h === "#" || !h) {
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
        selectEl.textContent = "";

        res.data.workspaces.forEach((ws) => {
          const option = document.createElement("option");
          option.value = ws.id;
          option.textContent = `${ws.name} (${ws.type})`;
          if (ws.isCurrent) {
            option.selected = true;
            currentWorkspaceId = ws.id;
            currentWorkspaceRole = ws.role || "member";
          }
          selectEl.appendChild(option);
        });

        if (roleBadgeEl) {
          roleBadgeEl.textContent = currentWorkspaceRole;
          roleBadgeEl.className = `badge badge-${currentWorkspaceRole === "owner" ? "primary" : currentWorkspaceRole === "admin" ? "info" : "neutral"}`;
        }
      }
    } catch (err) {
      showDashboardError("Failed to load workspaces: " + (err.message || "Unknown error"));
    }

    if (!selectEl.dataset.hasChangeListener) {
      selectEl.dataset.hasChangeListener = "true";
      selectEl.addEventListener("change", async (e) => {
        const targetWorkspaceId = e.target.value;
        if (!targetWorkspaceId || targetWorkspaceId === currentWorkspaceId) return;

        hideDashboardError();
        selectEl.disabled = true;

        try {
          const switchRes = await api.post("/api/workspaces/switch", {
            workspaceId: targetWorkspaceId
          });

          if (switchRes.success && switchRes.data) {
            api.setToken(switchRes.data.token);
            api.setTenant(switchRes.data.workspace);

            currentWorkspaceId = switchRes.data.workspace.id;
            currentWorkspaceRole = switchRes.data.workspace.role || "member";

            if (roleBadgeEl) {
              roleBadgeEl.textContent = currentWorkspaceRole;
              roleBadgeEl.className = `badge badge-${currentWorkspaceRole === "owner" ? "primary" : currentWorkspaceRole === "admin" ? "info" : "neutral"}`;
            }

            // Clear previous workspace state before loading new workspace data
            clearDashboardContainers();
            await loadDashboardData(true);
          }
        } catch (switchErr) {
          selectEl.value = currentWorkspaceId;
          showDashboardError("Failed to switch workspace: " + (switchErr.message || "Unknown error"));
        } finally {
          selectEl.disabled = false;
        }
      });
    }
  }

  function clearDashboardContainers() {
    const tbody = document.getElementById("invoices-table-body");
    const budgetsContainer = document.getElementById("budgets-list-container");
    const alertsContainer = document.getElementById("alerts-list-container");

    if (tbody) tbody.textContent = "";
    if (budgetsContainer) budgetsContainer.textContent = "";
    if (alertsContainer) alertsContainer.textContent = "";
  }

  // Concurrently fetch and populate all dashboard data
  async function loadDashboardData(isRefresh = false) {
    hideDashboardError();
    setLoadingState(true);

    try {
      const [servicesResult, billingResult, budgetsResult, alertsResult] = await Promise.allSettled([
        api.get("/api/services"),
        api.get("/api/billing", { limit: 5 }),
        api.get("/api/budgets", { limit: 5 }),
        api.get("/api/budgets/alerts", { limit: 5 })
      ]);

      const services = servicesResult.status === "fulfilled" && servicesResult.value && servicesResult.value.success
        ? servicesResult.value.data.services || []
        : [];

      const billingRecords = billingResult.status === "fulfilled" && billingResult.value && billingResult.value.success
        ? billingResult.value.data.billingRecords || []
        : [];

      const budgets = budgetsResult.status === "fulfilled" && budgetsResult.value && budgetsResult.value.success
        ? budgetsResult.value.data.budgets || []
        : [];

      const alerts = alertsResult.status === "fulfilled" && alertsResult.value && alertsResult.value.success
        ? alertsResult.value.data.alerts || []
        : [];

      // Render summary cards and sections with safe DOM
      renderSummaryCards(services, billingRecords, budgets, alerts);
      renderInvoicesTable(billingRecords);
      renderBudgetsList(budgets);
      renderAlertsList(alerts);
    } catch (err) {
      showDashboardError("Error loading dashboard metrics: " + (err.message || "Please try again."));
    } finally {
      setLoadingState(false);
    }
  }

  // Render the 4 high-level KPI cards with safe DOM
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
    const svcCounts = helpers.countActiveServices(services);
    if (activeServicesEl) activeServicesEl.textContent = String(svcCounts.total);
    if (activeServicesSubEl) {
      activeServicesSubEl.textContent = `${svcCounts.metered} metered · ${svcCounts.subscription} sub/hybrid`;
    }

    // 2. Total Invoiced Spend
    const spend = helpers.calculateTotalSpend(billingRecords);
    if (totalSpendEl) {
      totalSpendEl.textContent = helpers.formatCurrency(spend.total, spend.currency);
    }
    if (totalSpendSubEl) {
      totalSpendSubEl.textContent = `Across ${spend.count} recent billing cycles`;
    }

    // 3. Active Budgets
    const budgetCount = helpers.countActiveBudgets(budgets);
    if (activeBudgetsEl) activeBudgetsEl.textContent = String(budgetCount);
    if (activeBudgetsSubEl) {
      activeBudgetsSubEl.textContent = budgetCount > 0 ? "Spend limits actively monitored" : "No active limits defined";
    }

    // 4. Active Alerts
    const alertCount = helpers.countActiveAlerts(alerts);
    if (activeAlertsEl) {
      activeAlertsEl.textContent = String(alertCount);
      activeAlertsEl.style.color = alertCount > 0 ? "var(--color-danger)" : "var(--color-text-main)";
    }
    if (activeAlertsSubEl) {
      activeAlertsSubEl.textContent = alertCount > 0 ? "Requires review or acknowledgment" : "All alerts acknowledged";
    }
  }

  // Render recent invoices table with safe DOM
  function renderInvoicesTable(invoices) {
    const tbody = document.getElementById("invoices-table-body");
    const emptyEl = document.getElementById("invoices-empty");
    if (!tbody) return;

    tbody.textContent = "";

    if (!invoices || invoices.length === 0) {
      if (emptyEl) emptyEl.style.display = "block";
      return;
    }

    if (emptyEl) emptyEl.style.display = "none";

    invoices.forEach((inv) => {
      const tr = document.createElement("tr");

      // Col 1: Invoice #
      const tdInv = document.createElement("td");
      tdInv.style.fontFamily = "var(--font-mono)";
      tdInv.style.fontWeight = "600";
      tdInv.textContent = inv.invoiceNumber || inv.id || "INV-—";
      tr.appendChild(tdInv);

      // Col 2: Period
      const tdPeriod = document.createElement("td");
      tdPeriod.textContent = helpers.formatPeriod(inv.billingPeriodStart, inv.billingPeriodEnd);
      tr.appendChild(tdPeriod);

      // Col 3: Line Items
      const tdItems = document.createElement("td");
      const lineItemCount = Array.isArray(inv.lineItems) ? inv.lineItems.length : 0;
      tdItems.textContent = `${lineItemCount} service(s)`;
      tr.appendChild(tdItems);

      // Col 4: Total
      const tdTotal = document.createElement("td");
      tdTotal.style.fontWeight = "600";
      tdTotal.textContent = helpers.formatCurrency(inv.total, inv.currency);
      tr.appendChild(tdTotal);

      // Col 5: Status
      const tdStatus = document.createElement("td");
      const badgeInfo = helpers.buildInvoiceStatusBadge(inv.status);
      const badgeSpan = document.createElement("span");
      badgeSpan.className = badgeInfo.className;
      badgeSpan.textContent = badgeInfo.text;
      tdStatus.appendChild(badgeSpan);
      tr.appendChild(tdStatus);

      // Col 6: Date
      const tdDate = document.createElement("td");
      tdDate.style.color = "var(--color-text-muted)";
      tdDate.style.fontSize = "0.8rem";
      tdDate.textContent = helpers.formatDate(inv.generatedAt);
      tr.appendChild(tdDate);

      tbody.appendChild(tr);
    });
  }

  // Render active budgets with color-coded progress bars with safe DOM
  function renderBudgetsList(budgets) {
    const container = document.getElementById("budgets-list-container");
    const emptyEl = document.getElementById("budgets-empty");
    if (!container) return;

    container.textContent = "";

    if (!budgets || budgets.length === 0) {
      if (emptyEl) emptyEl.style.display = "block";
      return;
    }

    if (emptyEl) emptyEl.style.display = "none";

    budgets.forEach((b) => {
      const percentUsed = typeof b.percentageUsed === "number" ? b.percentageUsed : 0;
      const progressWidth = Math.min(100, Math.max(0, percentUsed));
      const fillClass = helpers.buildProgressClass(percentUsed);

      const item = document.createElement("div");
      item.className = "budget-item";

      // Top Header
      const topDiv = document.createElement("div");
      topDiv.className = "budget-item-top";

      const nameSpan = document.createElement("span");
      nameSpan.className = "budget-item-name";
      nameSpan.textContent = b.name || "Budget";
      topDiv.appendChild(nameSpan);

      const statsSpan = document.createElement("span");
      statsSpan.className = "budget-item-stats";

      const spendStrong = document.createElement("strong");
      spendStrong.textContent = helpers.formatCurrency(b.actualSpend || "0.00", b.currency);
      statsSpan.appendChild(spendStrong);
      statsSpan.appendChild(document.createTextNode(` of ${helpers.formatCurrency(b.amount, b.currency)} (${percentUsed}%)`));
      topDiv.appendChild(statsSpan);
      item.appendChild(topDiv);

      // Progress Track
      const trackDiv = document.createElement("div");
      trackDiv.className = "progress-track";
      trackDiv.setAttribute("role", "progressbar");
      trackDiv.setAttribute("aria-valuenow", String(percentUsed));
      trackDiv.setAttribute("aria-valuemin", "0");
      trackDiv.setAttribute("aria-valuemax", "100");

      const fillDiv = document.createElement("div");
      fillDiv.className = `progress-fill ${fillClass}`;
      fillDiv.style.width = `${progressWidth}%`;
      trackDiv.appendChild(fillDiv);
      item.appendChild(trackDiv);

      // Forecast Text
      const forecastText = helpers.buildForecastText(b);
      if (forecastText) {
        const forecastDiv = document.createElement("div");
        forecastDiv.style.fontSize = "0.775rem";
        forecastDiv.style.color = "var(--color-text-muted)";
        forecastDiv.style.marginTop = "2px";
        forecastDiv.textContent = forecastText;
        item.appendChild(forecastDiv);
      }

      container.appendChild(item);
    });
  }

  // Render recent alerts with one-click acknowledgment with safe DOM
  function renderAlertsList(alerts) {
    const container = document.getElementById("alerts-list-container");
    const emptyEl = document.getElementById("alerts-empty");
    if (!container) return;

    container.textContent = "";

    if (!alerts || alerts.length === 0) {
      if (emptyEl) emptyEl.style.display = "block";
      return;
    }

    if (emptyEl) emptyEl.style.display = "none";

    alerts.forEach((alertDoc) => {
      const isExceeded = alertDoc.alertType === "threshold_exceeded" || (Number(alertDoc.threshold) || 0) >= 100;
      const item = document.createElement("div");
      item.className = `alert-item ${isExceeded ? "alert-exceeded" : "alert-reached"}`;

      // Info Block
      const infoDiv = document.createElement("div");
      infoDiv.className = "alert-item-info";

      // Title Row
      const titleDiv = document.createElement("div");
      titleDiv.className = "alert-item-title";

      const badgeInfo = helpers.buildAlertBadge(alertDoc);
      const badgeSpan = document.createElement("span");
      badgeSpan.className = badgeInfo.className;
      badgeSpan.textContent = badgeInfo.text;
      titleDiv.appendChild(badgeSpan);

      const nameSpan = document.createElement("span");
      nameSpan.style.marginLeft = "6px";
      nameSpan.textContent = alertDoc.budgetName || "Budget Alert";
      titleDiv.appendChild(nameSpan);
      infoDiv.appendChild(titleDiv);

      // Meta Row
      const metaDiv = document.createElement("div");
      metaDiv.className = "alert-item-meta";
      const spendFormatted = helpers.formatCurrency(alertDoc.actualSpend, alertDoc.currency);
      const triggeredDate = helpers.formatDateTime(alertDoc.triggeredAt);
      metaDiv.textContent = `Actual Spend: ${spendFormatted} · ${triggeredDate}`;
      infoDiv.appendChild(metaDiv);
      item.appendChild(infoDiv);

      // Action Column
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

              // Decrement active alerts metric dynamically
              const activeAlertsEl = document.getElementById("metric-active-alerts");
              if (activeAlertsEl) {
                const current = parseInt(activeAlertsEl.textContent, 10);
                if (!Number.isNaN(current) && current > 0) {
                  activeAlertsEl.textContent = String(current - 1);
                  if (current - 1 === 0) {
                    activeAlertsEl.style.color = "var(--color-text-main)";
                  }
                }
              }
            }
          } catch (ackErr) {
            ackBtn.disabled = false;
            ackBtn.textContent = "Acknowledge";
            showDashboardError("Failed to acknowledge alert: " + (ackErr.message || "Unknown error"));
          }
        });

        actionDiv.appendChild(ackBtn);
      }

      item.appendChild(actionDiv);
      container.appendChild(item);
    });
  }

  // Toggle loading button state safely
  function setLoadingState(isLoading) {
    const refreshBtn = document.getElementById("refresh-dashboard-btn");
    if (!refreshBtn) return;

    refreshBtn.disabled = isLoading;
    refreshBtn.textContent = "";
    if (isLoading) {
      const spinner = document.createElement("span");
      spinner.className = "btn-spinner";
      spinner.style.borderTopColor = "var(--color-primary)";
      refreshBtn.appendChild(spinner);
      refreshBtn.appendChild(document.createTextNode(" Refreshing..."));
    } else {
      refreshBtn.textContent = "Refresh";
    }
  }

  // Page Error Notification Banners (Non-blocking replacement for window.alert)
  function showDashboardError(msg) {
    const errorBanner = document.getElementById("dashboard-error-banner");
    if (!errorBanner) return;
    errorBanner.textContent = msg;
    errorBanner.style.display = "flex";
  }

  function hideDashboardError() {
    const errorBanner = document.getElementById("dashboard-error-banner");
    if (errorBanner) {
      errorBanner.style.display = "none";
      errorBanner.textContent = "";
    }
  }
})(window);
