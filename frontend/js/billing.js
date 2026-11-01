/**
 * MeterFlow Invoices & Billing Controller
 * Handles billing cycle generation, line-item reconciliation, and invoice inspection.
 */

(function (window) {
  "use strict";

  const api = window.MeterFlowAPI;
  const auth = window.MeterFlowAuth;

  if (!auth.requireAuth()) return;

  let currentWorkspaceRole = "member";
  let currentPage = 1;
  let totalPages = 1;
  let cachedBills = [];

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

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
    const openGenBtn = document.getElementById("open-generate-modal-btn");
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

          await loadBillingRecords(1);
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
    const openGenBtn = document.getElementById("open-generate-modal-btn");

    if (roleBadgeEl) {
      roleBadgeEl.textContent = role;
      roleBadgeEl.className = `badge badge-${role === "owner" ? "primary" : role === "admin" ? "info" : "neutral"}`;
    }

    const canGenerate = role === "owner" || role === "admin";
    if (openGenBtn) {
      openGenBtn.disabled = !canGenerate;
      if (!canGenerate) {
        openGenBtn.title = "Requires Admin or Owner role in this workspace";
        openGenBtn.style.opacity = "0.6";
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

    if (openBtn && genModal) {
      openBtn.addEventListener("click", () => {
        if (currentWorkspaceRole !== "owner" && currentWorkspaceRole !== "admin") {
          alert("Only workspace owners and administrators can generate bills.");
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

        genModal.classList.add("open");
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
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function setupGenerateForm() {
    const form = document.getElementById("generate-bill-form");
    const submitBtn = document.getElementById("generate-submit-btn");
    const errorBanner = document.getElementById("generate-modal-error");

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (errorBanner) errorBanner.style.display = "none";

        const startVal = document.getElementById("gen-start-date")?.value;
        const endVal = document.getElementById("gen-end-date")?.value;
        const currency = document.getElementById("gen-currency")?.value.trim().toUpperCase() || "USD";

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

        // Confirmation dialog before generating
        const confirmed = window.confirm(
          `Generate billing record for period:\n${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()} (${currency})?\n\nThis will reconcile unbilled usage in this window.`
        );

        if (!confirmed) return;

        submitBtn.disabled = true;
        submitBtn.textContent = "Generating...";

        try {
          const res = await api.post("/api/billing/generate", {
            billingPeriodStart: startDate.toISOString(),
            billingPeriodEnd: endDate.toISOString(),
            currency
          });

          if (res.success) {
            document.getElementById("generate-modal")?.classList.remove("open");

            if (res.data?.isExisting) {
              showGlobalInfo(`Notice: Billing record ${res.data.billingRecord.invoiceNumber} already exists for this exact period. Loaded existing record.`);
            } else {
              showGlobalSuccess(`Invoice ${res.data.billingRecord.invoiceNumber} generated successfully!`);
            }

            await loadBillingRecords(1);
          }
        } catch (err) {
          showModalError(err.message || "Failed to generate billing record.");
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = "Generate Bill";
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

  async function loadBillingRecords(page = 1) {
    const tableBody = document.getElementById("billing-table-body");
    const emptyState = document.getElementById("billing-empty");
    const paginationBar = document.getElementById("billing-pagination");
    const countBadge = document.getElementById("billing-count-badge");
    const errorBanner = document.getElementById("billing-error-banner");

    if (errorBanner) errorBanner.style.display = "none";

    const status = document.getElementById("filter-status")?.value;
    const startDate = document.getElementById("filter-start-date")?.value;
    const endDate = document.getElementById("filter-end-date")?.value;

    const params = { page, limit: 20 };
    if (status) params.status = status;
    if (startDate) params.startDate = new Date(startDate).toISOString();
    if (endDate) params.endDate = new Date(endDate).toISOString();

    if (tableBody) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; color: var(--color-text-muted); padding: 2rem;">
            Loading billing records...
          </td>
        </tr>
      `;
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
        if (tableBody) tableBody.innerHTML = "";
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
        tableBody.innerHTML = `
          <tr>
            <td colspan="8" style="text-align: center; color: var(--color-danger); padding: 2rem;">
              Failed to load billing records.
            </td>
          </tr>
        `;
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
      spendEl.textContent = `${currency} ${sum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

  function renderBillingTable(records) {
    const tableBody = document.getElementById("billing-table-body");
    if (!tableBody) return;

    tableBody.innerHTML = "";

    records.forEach((bill) => {
      const tr = document.createElement("tr");

      const periodStart = bill.billingPeriodStart
        ? new Date(bill.billingPeriodStart).toLocaleDateString()
        : "--";
      const periodEnd = bill.billingPeriodEnd
        ? new Date(bill.billingPeriodEnd).toLocaleDateString()
        : "--";

      const genDate = bill.generatedAt
        ? new Date(bill.generatedAt).toLocaleDateString()
        : "--";

      const lineItemsCount = Array.isArray(bill.lineItems) ? bill.lineItems.length : 0;

      const statusBadgeClass =
        bill.status === "finalized"
          ? "badge-success"
          : bill.status === "issued"
          ? "badge-info"
          : bill.status === "draft"
          ? "badge-warning"
          : "badge-danger";

      tr.innerHTML = `
        <td>
          <span style="font-family: var(--font-mono); font-weight: 600; color: var(--color-primary);">
            ${escapeHtml(bill.invoiceNumber)}
          </span>
        </td>
        <td style="font-size: 0.85rem; color: var(--color-text-main);">
          ${escapeHtml(periodStart)} &ndash; ${escapeHtml(periodEnd)}
        </td>
        <td>
          <span class="badge badge-neutral">${lineItemsCount} items</span>
        </td>
        <td>
          <span style="font-family: var(--font-mono); font-size: 0.85rem; color: var(--color-text-muted);">
            ${escapeHtml(bill.currency)} ${escapeHtml(bill.subtotal)}
          </span>
        </td>
        <td>
          <span style="font-family: var(--font-mono); font-weight: 700; color: var(--color-text-main);">
            ${escapeHtml(bill.currency)} ${escapeHtml(bill.total)}
          </span>
        </td>
        <td>
          <span class="badge ${statusBadgeClass}">${escapeHtml(bill.status)}</span>
        </td>
        <td style="font-size: 0.8rem; color: var(--color-text-muted); white-space: nowrap;">
          ${escapeHtml(genDate)}
        </td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="btn btn-secondary btn-sm action-view-details" data-id="${bill.id}" style="margin-right: 4px;">
            Line Items
          </button>
          <button class="btn btn-secondary btn-sm action-view-usage" data-id="${bill.id}">
            Reconciled Usage
          </button>
        </td>
      `;

      tableBody.appendChild(tr);
    });

    tableBody.querySelectorAll(".action-view-details").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        openDetailsModal(id);
      });
    });

    tableBody.querySelectorAll(".action-view-usage").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        openReconciledUsageModal(id);
      });
    });
  }

  function openDetailsModal(billId) {
    const bill = cachedBills.find((b) => b.id === billId);
    if (!bill) return;

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
      periodEl.textContent = `${new Date(bill.billingPeriodStart).toLocaleDateString()} to ${new Date(bill.billingPeriodEnd).toLocaleDateString()}`;
    }
    if (currEl) currEl.textContent = bill.currency;
    if (statusEl) {
      statusEl.textContent = bill.status;
      statusEl.className = `badge badge-${bill.status === "finalized" ? "success" : bill.status === "issued" ? "info" : "neutral"}`;
    }

    if (bodyEl) {
      bodyEl.innerHTML = "";
      const lineItems = bill.lineItems || [];

      if (lineItems.length === 0) {
        bodyEl.innerHTML = `
          <tr>
            <td colspan="6" style="text-align: center; color: var(--color-text-muted); padding: 1.5rem;">
              No charges or usage incurred during this billing period ($0.00).
            </td>
          </tr>
        `;
      } else {
        lineItems.forEach((li) => {
          const row = document.createElement("tr");

          let rateText = "--";
          if (li.chargeType === "usage") {
            rateText = `${bill.currency} ${li.unitPrice || "0"} / ${li.unit || "unit"}`;
          } else {
            rateText = "Flat Period Fee";
          }

          row.innerHTML = `
            <td>
              <div style="font-weight: 600;">${escapeHtml(li.serviceName)}</div>
              <div style="font-size: 0.775rem; color: var(--color-text-muted);">${escapeHtml(li.description)}</div>
            </td>
            <td>
              <span class="badge ${li.chargeType === "usage" ? "badge-primary" : "badge-info"}">
                ${escapeHtml(li.chargeType)}
              </span>
            </td>
            <td style="font-family: var(--font-mono);">
              ${li.quantity ? `${escapeHtml(li.quantity)} ${escapeHtml(li.unit || "")}` : "--"}
            </td>
            <td style="font-family: var(--font-mono); font-size: 0.85rem;">
              ${escapeHtml(rateText)}
            </td>
            <td style="font-family: var(--font-mono); font-weight: 600;">
              ${escapeHtml(bill.currency)} ${escapeHtml(li.amount)}
            </td>
            <td>
              <span class="badge badge-neutral">${li.usageRecordCount || 0} events</span>
            </td>
          `;
          bodyEl.appendChild(row);
        });
      }
    }

    if (subtotalEl) subtotalEl.textContent = `${bill.currency} ${bill.subtotal}`;
    if (totalEl) totalEl.textContent = `${bill.currency} ${bill.total}`;

    if (modal) modal.classList.add("open");
  }

  async function openReconciledUsageModal(billId) {
    const bill = cachedBills.find((b) => b.id === billId);
    const modal = document.getElementById("usage-modal");
    const invTitleEl = document.getElementById("usage-invoice-title");
    const infoEl = document.getElementById("reconciled-usage-info");
    const bodyEl = document.getElementById("reconciled-usage-body");

    if (invTitleEl) invTitleEl.textContent = bill ? `Invoice: ${bill.invoiceNumber}` : "";
    if (infoEl) infoEl.textContent = "Loading reconciled usage events...";

    if (bodyEl) {
      bodyEl.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; color: var(--color-text-muted); padding: 1.5rem;">
            Loading usage records...
          </td>
        </tr>
      `;
    }

    if (modal) modal.classList.add("open");

    try {
      const res = await api.get(`/api/billing/${billId}/usage`);
      const usageList = res.data?.usageRecords || [];

      if (infoEl) {
        infoEl.textContent = `Found ${usageList.length} reconciled usage event(s) included in this invoice.`;
      }

      if (bodyEl) {
        bodyEl.innerHTML = "";

        if (usageList.length === 0) {
          bodyEl.innerHTML = `
            <tr>
              <td colspan="5" style="text-align: center; color: var(--color-text-muted); padding: 1.5rem;">
                No metered usage events were reconciled to this invoice (subscription-only or zero usage).
              </td>
            </tr>
          `;
          return;
        }

        usageList.forEach((u) => {
          const row = document.createElement("tr");

          const occurredDate = u.occurredAt
            ? new Date(u.occurredAt).toLocaleString()
            : "--";
          const billedDate = u.billedAt
            ? new Date(u.billedAt).toLocaleString()
            : "--";

          row.innerHTML = `
            <td style="font-weight: 600;">${escapeHtml(u.serviceName)}</td>
            <td style="font-family: var(--font-mono); font-weight: 600;">${escapeHtml(u.quantity)}</td>
            <td><span class="badge badge-neutral">${escapeHtml(u.unit)}</span></td>
            <td style="font-size: 0.8rem; color: var(--color-text-muted);">${escapeHtml(occurredDate)}</td>
            <td style="font-size: 0.8rem; color: var(--color-text-muted);">${escapeHtml(billedDate)}</td>
          `;
          bodyEl.appendChild(row);
        });
      }
    } catch (err) {
      if (infoEl) infoEl.textContent = `Error loading reconciled usage: ${err.message}`;
      if (bodyEl) {
        bodyEl.innerHTML = `
          <tr>
            <td colspan="5" style="text-align: center; color: var(--color-danger); padding: 1.5rem;">
              Failed to fetch reconciled usage records.
            </td>
          </tr>
        `;
      }
    }
  }

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
})(window);
