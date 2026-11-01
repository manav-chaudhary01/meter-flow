/**
 * MeterFlow Usage Management & Ingestion Controller
 * Provides usage history, multi-tenant isolation, idempotency key generation, and aggregation.
 */

(function (window) {
  "use strict";

  const api = window.MeterFlowAPI;
  const auth = window.MeterFlowAuth;

  if (!auth.requireAuth()) return;

  let currentWorkspaceRole = "member";
  let workspaceServices = [];
  let currentPage = 1;
  let totalPages = 1;
  let cachedRecords = [];

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  document.addEventListener("DOMContentLoaded", initUsagePage);

  async function initUsagePage() {
    setupUserProfile();
    setupMobileMenu();
    setupModals();
    setupFilterEvents();
    setupIngestForm();
    setupPagination();

    await loadWorkspaces();
    await loadServicesCatalog();
    await loadUsageSummary();
    await loadUsageHistory(1);

    const refreshBtn = document.getElementById("refresh-usage-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        await loadUsageSummary();
        await loadUsageHistory(currentPage);
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

        if (roleBadgeEl) {
          roleBadgeEl.textContent = currentWorkspaceRole;
          roleBadgeEl.className = `badge badge-${currentWorkspaceRole === "owner" ? "primary" : currentWorkspaceRole === "admin" ? "info" : "neutral"}`;
        }
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
          if (roleBadgeEl) {
            roleBadgeEl.textContent = currentWorkspaceRole;
            roleBadgeEl.className = `badge badge-${currentWorkspaceRole === "owner" ? "primary" : currentWorkspaceRole === "admin" ? "info" : "neutral"}`;
          }

          // Reload workspace data
          await loadServicesCatalog();
          await loadUsageSummary();
          await loadUsageHistory(1);
        }
      } catch (switchErr) {
        alert("Failed to switch workspace: " + (switchErr.message || "Unknown error"));
      } finally {
        selectEl.disabled = false;
      }
    });
  }

  async function loadServicesCatalog() {
    try {
      const res = await api.get("/api/services", { status: "active" });
      const services = res.data && Array.isArray(res.data.services) ? res.data.services : [];
      workspaceServices = services;

      // Populate filter dropdown
      const filterSelect = document.getElementById("filter-service");
      if (filterSelect) {
        filterSelect.innerHTML = '<option value="">All Services</option>';
        services.forEach((s) => {
          const opt = document.createElement("option");
          opt.value = s.id;
          opt.textContent = `${s.name} (${s.trackingType})`;
          filterSelect.appendChild(opt);
        });
      }

      // Populate ingest modal dropdown (metered or hybrid only)
      const ingestSelect = document.getElementById("ingest-service");
      if (ingestSelect) {
        ingestSelect.innerHTML = '<option value="">Select a metered/hybrid service...</option>';
        const billableServices = services.filter((s) => s.trackingType === "metered" || s.trackingType === "hybrid");
        billableServices.forEach((s) => {
          const opt = document.createElement("option");
          opt.value = s.id;
          opt.textContent = `${s.name} (${s.unit || "unit"})`;
          opt.setAttribute("data-unit", s.unit || "");
          ingestSelect.appendChild(opt);
        });
      }
    } catch (err) {
      console.error("Failed to load services for usage ingestion:", err.message);
    }
  }

  function setupModals() {
    const openBtn = document.getElementById("open-ingest-modal-btn");
    const ingestModal = document.getElementById("ingest-modal");
    const metadataModal = document.getElementById("metadata-modal");

    if (openBtn && ingestModal) {
      openBtn.addEventListener("click", () => {
        ingestModal.classList.add("open");
      });
    }

    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const modalId = btn.getAttribute("data-close-modal");
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.remove("open");
      });
    });

    [ingestModal, metadataModal].forEach((modal) => {
      if (modal) {
        modal.addEventListener("click", (e) => {
          if (e.target === modal) modal.classList.remove("open");
        });
      }
    });
  }

  function setupIngestForm() {
    const form = document.getElementById("ingest-usage-form");
    const serviceSelect = document.getElementById("ingest-service");
    const unitInput = document.getElementById("ingest-unit");
    const unitHint = document.getElementById("service-unit-hint");
    const genKeyBtn = document.getElementById("generate-key-btn");
    const keyInput = document.getElementById("ingest-idempotency-key");
    const metadataInput = document.getElementById("ingest-metadata");
    const metadataError = document.getElementById("metadata-error");
    const submitBtn = document.getElementById("ingest-submit-btn");
    const errorBanner = document.getElementById("ingest-modal-error");
    const replayBanner = document.getElementById("ingest-modal-replay");

    // Automatically fill unit when service is chosen
    if (serviceSelect && unitInput) {
      serviceSelect.addEventListener("change", () => {
        const selectedOption = serviceSelect.options[serviceSelect.selectedIndex];
        const unit = selectedOption ? selectedOption.getAttribute("data-unit") : "";
        unitInput.value = unit || "";
        if (unitHint) {
          unitHint.textContent = unit ? `Expected unit: ${unit}` : "Select a service above.";
        }
      });
    }

    // Helper: generate random idempotency key
    if (genKeyBtn && keyInput) {
      genKeyBtn.addEventListener("click", () => {
        const rand = Math.random().toString(36).substring(2, 10);
        keyInput.value = `evt-${Date.now()}-${rand}`;
      });
    }

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (errorBanner) errorBanner.style.display = "none";
        if (replayBanner) replayBanner.style.display = "none";
        if (metadataError) metadataError.style.display = "none";

        const serviceId = serviceSelect?.value;
        const quantity = document.getElementById("ingest-quantity")?.value;
        const unit = unitInput?.value.trim();
        const occurredAtVal = document.getElementById("ingest-occurred-at")?.value;
        const source = document.getElementById("ingest-source")?.value.trim() || "manual-ui";
        const idempotencyKey = keyInput?.value.trim() || undefined;
        const externalEventId = document.getElementById("ingest-external-event-id")?.value.trim() || undefined;

        if (!serviceId) {
          showModalError("Please select a tracked service.");
          return;
        }

        if (quantity === "" || isNaN(Number(quantity)) || Number(quantity) < 0) {
          showModalError("Quantity must be a non-negative number (>= 0).");
          return;
        }

        let metadataObj;
        const rawMetadata = metadataInput?.value.trim();
        if (rawMetadata) {
          try {
            metadataObj = JSON.parse(rawMetadata);
            if (typeof metadataObj !== "object" || Array.isArray(metadataObj) || metadataObj === null) {
              throw new Error("Metadata must be a key-value JSON object");
            }
          } catch (jsonErr) {
            if (metadataError) {
              metadataError.textContent = `JSON Error: ${jsonErr.message}`;
              metadataError.style.display = "block";
            }
            return;
          }
        }

        const payload = {
          serviceId,
          quantity,
          unit,
          source
        };

        if (occurredAtVal) {
          payload.occurredAt = new Date(occurredAtVal).toISOString();
        }
        if (idempotencyKey) payload.idempotencyKey = idempotencyKey;
        if (externalEventId) payload.externalEventId = externalEventId;
        if (metadataObj) payload.metadata = metadataObj;

        submitBtn.disabled = true;
        submitBtn.textContent = "Submitting...";

        try {
          const res = await api.post("/api/usage", payload);

          if (res.success) {
            const isReplay = res.data?.idempotentReplay;
            if (isReplay) {
              if (replayBanner) {
                replayBanner.textContent = "Idempotent Replay: An identical event with this key was already recorded. No duplicate usage charged.";
                replayBanner.style.display = "block";
              }
              showGlobalInfo("Idempotent replay: event was already recorded previously.");
            } else {
              form.reset();
              if (unitInput) unitInput.value = "";
              document.getElementById("ingest-modal")?.classList.remove("open");
              showGlobalSuccess("Usage event recorded successfully.");
            }

            // Refresh table and summary
            await loadUsageSummary();
            await loadUsageHistory(1);
          }
        } catch (err) {
          if (err.status === 409) {
            showModalError("Idempotency conflict: A record with this key already exists with a different payload (different quantity, unit, or service).");
          } else {
            showModalError(err.message || "Failed to ingest usage event.");
          }
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = "Submit Usage";
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

    if (applyBtn) {
      applyBtn.addEventListener("click", () => {
        loadUsageHistory(1);
        loadUsageSummary();
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        const serviceSelect = document.getElementById("filter-service");
        const startInput = document.getElementById("filter-start-date");
        const endInput = document.getElementById("filter-end-date");
        if (serviceSelect) serviceSelect.value = "";
        if (startInput) startInput.value = "";
        if (endInput) endInput.value = "";
        loadUsageHistory(1);
        loadUsageSummary();
      });
    }
  }

  function setupPagination() {
    const prevBtn = document.getElementById("prev-page-btn");
    const nextBtn = document.getElementById("next-page-btn");

    if (prevBtn) {
      prevBtn.addEventListener("click", () => {
        if (currentPage > 1) {
          loadUsageHistory(currentPage - 1);
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        if (currentPage < totalPages) {
          loadUsageHistory(currentPage + 1);
        }
      });
    }
  }

  async function loadUsageSummary() {
    const serviceFilter = document.getElementById("filter-service")?.value;
    const startDate = document.getElementById("filter-start-date")?.value;
    const endDate = document.getElementById("filter-end-date")?.value;

    const params = { groupBy: "service" };
    if (serviceFilter) params.serviceId = serviceFilter;
    if (startDate) params.startDate = new Date(startDate).toISOString();
    if (endDate) params.endDate = new Date(endDate).toISOString();

    try {
      const res = await api.get("/api/usage/summary", params);
      const summaryList = res.data?.summary || [];

      let totalEvents = 0;
      let totalQty = 0;

      summaryList.forEach((item) => {
        totalEvents += item.eventCount || 0;
        const q = parseFloat(item.totalQuantity?.$numberDecimal || item.totalQuantity || 0);
        if (!isNaN(q)) totalQty += q;
      });

      const totalEventsEl = document.getElementById("metric-total-events");
      const aggregateVolEl = document.getElementById("metric-aggregate-volume");
      const distinctSvcEl = document.getElementById("metric-distinct-services");

      if (totalEventsEl) totalEventsEl.textContent = totalEvents.toLocaleString();
      if (aggregateVolEl) aggregateVolEl.textContent = totalQty.toLocaleString(undefined, { maximumFractionDigits: 2 });
      if (distinctSvcEl) distinctSvcEl.textContent = summaryList.length.toString();
    } catch (err) {
      console.error("Failed to load usage summary:", err.message);
    }
  }

  async function loadUsageHistory(page = 1) {
    const tableBody = document.getElementById("usage-table-body");
    const emptyState = document.getElementById("usage-empty");
    const paginationBar = document.getElementById("usage-pagination");
    const countBadge = document.getElementById("usage-count-badge");
    const errorBanner = document.getElementById("usage-error-banner");

    if (errorBanner) errorBanner.style.display = "none";

    const serviceId = document.getElementById("filter-service")?.value;
    const startDate = document.getElementById("filter-start-date")?.value;
    const endDate = document.getElementById("filter-end-date")?.value;

    const params = { page, limit: 20 };
    if (serviceId) params.serviceId = serviceId;
    if (startDate) params.startDate = new Date(startDate).toISOString();
    if (endDate) params.endDate = new Date(endDate).toISOString();

    if (tableBody) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; color: var(--color-text-muted); padding: 2rem;">
            Loading usage records...
          </td>
        </tr>
      `;
    }

    try {
      const res = await api.get("/api/usage", params);
      const records = res.data && Array.isArray(res.data.records) ? res.data.records : [];
      const pagination = res.data?.pagination || { total: 0, page: 1, pages: 1 };
      cachedRecords = records;

      currentPage = pagination.page;
      totalPages = pagination.pages;

      if (countBadge) {
        countBadge.textContent = `${pagination.total} Event${pagination.total === 1 ? "" : "s"}`;
      }

      if (records.length === 0) {
        if (tableBody) tableBody.innerHTML = "";
        if (emptyState) emptyState.style.display = "block";
        if (paginationBar) paginationBar.style.display = "none";
        return;
      }

      if (emptyState) emptyState.style.display = "none";
      if (paginationBar) paginationBar.style.display = "flex";

      updatePaginationControls(pagination);
      renderUsageTable(records);
    } catch (err) {
      if (errorBanner) {
        errorBanner.textContent = `Error loading usage history: ${err.message}`;
        errorBanner.style.display = "block";
      }
      if (tableBody) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="8" style="text-align: center; color: var(--color-danger); padding: 2rem;">
              Failed to load usage history.
            </td>
          </tr>
        `;
      }
    }
  }

  function updatePaginationControls(pagination) {
    const infoEl = document.getElementById("pagination-info");
    const prevBtn = document.getElementById("prev-page-btn");
    const nextBtn = document.getElementById("next-page-btn");

    if (infoEl) {
      infoEl.textContent = `Page ${pagination.page} of ${pagination.pages} (${pagination.total} total records)`;
    }
    if (prevBtn) prevBtn.disabled = pagination.page <= 1;
    if (nextBtn) nextBtn.disabled = pagination.page >= pagination.pages;
  }

  function renderUsageTable(records) {
    const tableBody = document.getElementById("usage-table-body");
    if (!tableBody) return;

    tableBody.innerHTML = "";

    records.forEach((rec) => {
      const tr = document.createElement("tr");

      const dateStr = rec.occurredAt
        ? new Date(rec.occurredAt).toLocaleString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
          })
        : "--";

      const hasMetadata = rec.metadata && Object.keys(rec.metadata).length > 0;
      const isBilled = Boolean(rec.billingRecordId || rec.billedAt);

      tr.innerHTML = `
        <td style="white-space: nowrap; font-size: 0.8rem; color: var(--color-text-muted);">
          ${escapeHtml(dateStr)}
        </td>
        <td>
          <span style="font-weight: 600; color: var(--color-text-main);">
            ${escapeHtml(rec.serviceName || "Service")}
          </span>
        </td>
        <td>
          <span style="font-family: var(--font-mono); font-weight: 600;">
            ${escapeHtml(rec.quantity)}
          </span>
        </td>
        <td>
          <span class="badge badge-neutral">${escapeHtml(rec.unit)}</span>
        </td>
        <td style="font-size: 0.8rem; color: var(--color-text-muted);">
          ${escapeHtml(rec.source || "api")}
        </td>
        <td>
          ${
            rec.idempotencyKey
              ? `<span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--color-text-muted);">${escapeHtml(rec.idempotencyKey.slice(0, 16))}...</span>`
              : '<span style="color: var(--color-text-light); font-size: 0.75rem;">None</span>'
          }
        </td>
        <td>
          <span class="badge ${isBilled ? "badge-success" : "badge-neutral"}">
            ${isBilled ? "Billed" : "Unbilled"}
          </span>
        </td>
        <td style="text-align: right;">
          ${
            hasMetadata
              ? `<button class="btn btn-secondary btn-sm inspect-metadata-btn" data-id="${rec.id}" style="font-size: 0.75rem; padding: 0.2rem 0.5rem;">JSON</button>`
              : '<span style="color: var(--color-text-light); font-size: 0.75rem;">--</span>'
          }
        </td>
      `;

      tableBody.appendChild(tr);
    });

    tableBody.querySelectorAll(".inspect-metadata-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const record = cachedRecords.find((r) => r.id === id);
        if (record && record.metadata) {
          const contentEl = document.getElementById("metadata-content");
          if (contentEl) {
            contentEl.textContent = JSON.stringify(record.metadata, null, 2);
          }
          document.getElementById("metadata-modal")?.classList.add("open");
        }
      });
    });
  }

  function showGlobalSuccess(msg) {
    const banner = document.getElementById("usage-success-banner");
    if (!banner) return;
    banner.textContent = msg;
    banner.style.display = "block";
    setTimeout(() => {
      banner.style.display = "none";
    }, 5000);
  }

  function showGlobalInfo(msg) {
    const banner = document.getElementById("usage-info-banner");
    if (!banner) return;
    banner.textContent = msg;
    banner.style.display = "block";
    setTimeout(() => {
      banner.style.display = "none";
    }, 6000);
  }
})(window);
