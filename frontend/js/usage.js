/**
 * MeterFlow Usage Management & Ingestion Controller
 * Provides usage history, multi-tenant isolation, idempotency handling, and safe DOM rendering.
 */

(function (window) {
  "use strict";

  const DECIMAL_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

  function stringOrEmpty(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function validateQuantity(value) {
    const trimmed = stringOrEmpty(value).trim();
    if (!trimmed) {
      return { error: "Quantity is required", fieldId: "ingest-quantity" };
    }
    if (!DECIMAL_PATTERN.test(trimmed)) {
      return { error: "Quantity must be a valid numeric decimal", fieldId: "ingest-quantity" };
    }
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric) || Number.isNaN(numeric)) {
      return { error: "Quantity must be a valid finite number", fieldId: "ingest-quantity" };
    }
    if (numeric < 0 || trimmed.startsWith("-")) {
      return { error: "Quantity must be a non-negative number (>= 0)", fieldId: "ingest-quantity" };
    }
    return { value: trimmed };
  }

  function validateMetadata(raw) {
    const trimmed = stringOrEmpty(raw).trim();
    if (!trimmed) {
      return { value: null };
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return { error: "Metadata must be a key-value JSON object", fieldId: "ingest-metadata" };
      }
      return { value: parsed };
    } catch (err) {
      return { error: `Invalid JSON format: ${err.message}`, fieldId: "ingest-metadata" };
    }
  }

  function validateIngestForm(values, service) {
    const serviceId = stringOrEmpty(values.serviceId).trim();
    if (!serviceId) {
      return { error: "Please select a tracked service", fieldId: "ingest-service" };
    }

    if (!service) {
      return { error: "Selected service was not found in catalog", fieldId: "ingest-service" };
    }

    if (service.status === "archived") {
      return { error: "Cannot ingest usage for an archived service", fieldId: "ingest-service" };
    }

    if (service.trackingType === "subscription") {
      return {
        error: "Usage ingestion is not supported for subscription-only services",
        fieldId: "ingest-service"
      };
    }

    const qtyCheck = validateQuantity(values.quantity);
    if (qtyCheck.error) {
      return qtyCheck;
    }

    const unit = stringOrEmpty(values.unit).trim();
    if (!unit) {
      return { error: "Unit is required", fieldId: "ingest-unit" };
    }

    if (service.unit && service.unit.trim().toLowerCase() !== unit.toLowerCase()) {
      return {
        error: `Unit mismatch: service expects '${service.unit}', received '${unit}'`,
        fieldId: "ingest-unit"
      };
    }

    if (values.occurredAt) {
      const parsedDate = new Date(values.occurredAt);
      if (Number.isNaN(parsedDate.getTime())) {
        return { error: "Invalid occurredAt timestamp format", fieldId: "ingest-occurred-at" };
      }
    }

    const source = stringOrEmpty(values.source).trim();
    if (source.length > 100) {
      return { error: "Source must be 100 characters or fewer", fieldId: "ingest-source" };
    }

    const idempotencyKey = stringOrEmpty(values.idempotencyKey).trim();
    if (idempotencyKey.length > 200) {
      return { error: "Idempotency key must be 200 characters or fewer", fieldId: "ingest-idempotency-key" };
    }

    const externalEventId = stringOrEmpty(values.externalEventId).trim();
    if (externalEventId.length > 200) {
      return { error: "External Event ID must be 200 characters or fewer", fieldId: "ingest-external-event-id" };
    }

    const metaCheck = validateMetadata(values.metadata);
    if (metaCheck.error) {
      return metaCheck;
    }

    return { valid: true };
  }

  function buildIngestPayload(values, service) {
    const qtyCheck = validateQuantity(values.quantity);
    const metaCheck = validateMetadata(values.metadata);
    const unit = (service && service.unit ? service.unit : stringOrEmpty(values.unit)).trim();
    const source = stringOrEmpty(values.source).trim() || "manual-ui";

    const payload = {
      serviceId: stringOrEmpty(values.serviceId).trim(),
      quantity: qtyCheck.value || stringOrEmpty(values.quantity).trim(),
      unit,
      source
    };

    if (values.occurredAt) {
      payload.occurredAt = new Date(values.occurredAt).toISOString();
    }

    const trimmedKey = stringOrEmpty(values.idempotencyKey).trim();
    if (trimmedKey) {
      payload.idempotencyKey = trimmedKey;
    }

    const trimmedExt = stringOrEmpty(values.externalEventId).trim();
    if (trimmedExt) {
      payload.externalEventId = trimmedExt;
    }

    if (metaCheck.value) {
      payload.metadata = metaCheck.value;
    }

    return payload;
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

  function formatQuantity(qty) {
    if (qty === null || qty === undefined || qty === "") return "0";
    return String(qty);
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
      // Set end of day so all events on that day are captured (< end of day + 1)
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

  // Expose pure helper methods for isolated verification and testing
  window.MeterFlowUsage = {
    validateQuantity,
    validateMetadata,
    validateIngestForm,
    buildIngestPayload,
    formatDateTime,
    formatQuantity,
    parseDateFilterRange
  };

  const api = window.MeterFlowAPI;
  const auth = window.MeterFlowAuth;

  if (!api || !auth || typeof document === "undefined") {
    return;
  }

  if (!auth.requireAuth()) return;

  let currentWorkspaceId = "";
  let currentWorkspaceRole = "member";
  let workspaceServices = [];
  let cachedRecords = [];
  let currentPage = 1;
  let totalPages = 1;
  let isSubmittingIngest = false;
  let bannerTimeout = null;

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

  function clearElement(element) {
    if (!element) return;
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  function showModalError(message) {
    const errorBanner = document.getElementById("ingest-modal-error");
    const replayBanner = document.getElementById("ingest-modal-replay");
    if (replayBanner) replayBanner.style.display = "none";
    if (!errorBanner) return;
    errorBanner.textContent = message;
    errorBanner.style.display = "block";
  }

  function hideModalAlerts() {
    const errorBanner = document.getElementById("ingest-modal-error");
    const replayBanner = document.getElementById("ingest-modal-replay");
    const metaError = document.getElementById("metadata-error");
    if (errorBanner) {
      errorBanner.textContent = "";
      errorBanner.style.display = "none";
    }
    if (replayBanner) {
      replayBanner.textContent = "";
      replayBanner.style.display = "none";
    }
    if (metaError) {
      metaError.textContent = "";
      metaError.style.display = "none";
    }
  }

  function showPageErrorBanner(message) {
    const errEl = document.getElementById("usage-error-banner");
    const succEl = document.getElementById("usage-success-banner");
    const infoEl = document.getElementById("usage-info-banner");
    if (succEl) succEl.style.display = "none";
    if (infoEl) infoEl.style.display = "none";
    if (!errEl) return;
    errEl.textContent = message;
    errEl.style.display = "block";
  }

  function hidePageErrorBanner() {
    const errEl = document.getElementById("usage-error-banner");
    if (!errEl) return;
    errEl.textContent = "";
    errEl.style.display = "none";
  }

  function showPageSuccessBanner(message) {
    const banner = document.getElementById("usage-success-banner");
    hidePageErrorBanner();
    if (!banner) return;
    if (bannerTimeout) clearTimeout(bannerTimeout);
    banner.textContent = message;
    banner.style.display = "block";
    bannerTimeout = setTimeout(() => {
      banner.style.display = "none";
    }, 5000);
  }

  function showPageInfoBanner(message) {
    const banner = document.getElementById("usage-info-banner");
    hidePageErrorBanner();
    if (!banner) return;
    if (bannerTimeout) clearTimeout(bannerTimeout);
    banner.textContent = message;
    banner.style.display = "block";
    bannerTimeout = setTimeout(() => {
      banner.style.display = "none";
    }, 6000);
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
        clearElement(selectEl);
        res.data.workspaces.forEach((ws) => {
          const opt = document.createElement("option");
          opt.value = ws.id;
          opt.textContent = `${ws.name} (${ws.type})`;
          if (ws.isCurrent) {
            opt.selected = true;
            currentWorkspaceId = ws.id;
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
      showPageErrorBanner(`Failed to load workspaces: ${err.message || "Unknown error"}`);
    }

    selectEl.addEventListener("change", async (e) => {
      const targetWorkspaceId = e.target.value;
      if (!targetWorkspaceId || targetWorkspaceId === currentWorkspaceId) return;

      hidePageErrorBanner();
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

          // Close open modals
          closeModal("ingest-modal");
          closeModal("metadata-modal");

          // Reset filter inputs
          const filterService = document.getElementById("filter-service");
          const filterStart = document.getElementById("filter-start-date");
          const filterEnd = document.getElementById("filter-end-date");
          if (filterService) filterService.value = "";
          if (filterStart) filterStart.value = "";
          if (filterEnd) filterEnd.value = "";

          // Reload workspace data
          await loadServicesCatalog();
          await loadUsageSummary();
          await loadUsageHistory(1);
        }
      } catch (switchErr) {
        selectEl.value = currentWorkspaceId;
        showPageErrorBanner(`Failed to switch workspace: ${switchErr.message || "Unknown error"}`);
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

      // Populate filter dropdown (all active services in workspace)
      const filterSelect = document.getElementById("filter-service");
      if (filterSelect) {
        clearElement(filterSelect);
        const allOpt = document.createElement("option");
        allOpt.value = "";
        allOpt.textContent = "All Services";
        filterSelect.appendChild(allOpt);

        services.forEach((s) => {
          const opt = document.createElement("option");
          opt.value = s.id;
          opt.textContent = `${s.name} (${s.trackingType})`;
          filterSelect.appendChild(opt);
        });
      }

      // Populate ingest modal dropdown: ONLY billable metered or hybrid services
      const ingestSelect = document.getElementById("ingest-service");
      if (ingestSelect) {
        clearElement(ingestSelect);
        const defaultOpt = document.createElement("option");
        defaultOpt.value = "";
        defaultOpt.textContent = "Select a metered/hybrid service...";
        ingestSelect.appendChild(defaultOpt);

        const billable = services.filter(
          (s) => s.status === "active" && (s.trackingType === "metered" || s.trackingType === "hybrid")
        );

        billable.forEach((s) => {
          const opt = document.createElement("option");
          opt.value = s.id;
          opt.textContent = `${s.name} (${s.unit || "unit"}) — ${s.trackingType}`;
          opt.setAttribute("data-unit", s.unit || "");
          ingestSelect.appendChild(opt);
        });
      }
    } catch (err) {
      console.error("Failed to load services for usage ingestion:", err.message);
    }
  }

  function resetIngestModalState() {
    const form = document.getElementById("ingest-usage-form");
    const unitInput = document.getElementById("ingest-unit");
    const hint = document.getElementById("service-unit-hint");
    hideModalAlerts();
    if (form) form.reset();
    if (unitInput) unitInput.value = "";
    if (hint) hint.textContent = "Unit will be matched automatically from selected service.";
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal || !modal.classList.contains("open")) return;
    if (modalId === "ingest-modal" && isSubmittingIngest) return;

    modal.classList.remove("open");
    if (modalId === "ingest-modal") {
      resetIngestModalState();
    }
  }

  function setupModals() {
    const openBtn = document.getElementById("open-ingest-modal-btn");
    const ingestModal = document.getElementById("ingest-modal");
    const metadataModal = document.getElementById("metadata-modal");

    if (openBtn && ingestModal) {
      openBtn.addEventListener("click", () => {
        resetIngestModalState();
        ingestModal.classList.add("open");
        document.getElementById("ingest-service")?.focus();
      });
    }

    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const modalId = btn.getAttribute("data-close-modal");
        closeModal(modalId);
      });
    });

    [ingestModal, metadataModal].forEach((modal) => {
      if (modal) {
        modal.addEventListener("click", (e) => {
          if (e.target === modal) closeModal(modal.id);
        });
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (metadataModal?.classList.contains("open")) closeModal("metadata-modal");
        else if (ingestModal?.classList.contains("open")) closeModal("ingest-modal");
      }
    });
  }

  function readIngestFormValues() {
    return {
      serviceId: document.getElementById("ingest-service")?.value,
      quantity: document.getElementById("ingest-quantity")?.value,
      unit: document.getElementById("ingest-unit")?.value,
      occurredAt: document.getElementById("ingest-occurred-at")?.value,
      source: document.getElementById("ingest-source")?.value,
      idempotencyKey: document.getElementById("ingest-idempotency-key")?.value,
      externalEventId: document.getElementById("ingest-external-event-id")?.value,
      metadata: document.getElementById("ingest-metadata")?.value
    };
  }

  function setupIngestForm() {
    const form = document.getElementById("ingest-usage-form");
    const serviceSelect = document.getElementById("ingest-service");
    const unitInput = document.getElementById("ingest-unit");
    const unitHint = document.getElementById("service-unit-hint");
    const genKeyBtn = document.getElementById("generate-key-btn");
    const keyInput = document.getElementById("ingest-idempotency-key");
    const submitBtn = document.getElementById("ingest-submit-btn");
    const replayBanner = document.getElementById("ingest-modal-replay");

    // Automatically fill unit and update hint when service is selected
    if (serviceSelect && unitInput) {
      serviceSelect.addEventListener("change", () => {
        const selectedId = serviceSelect.value;
        const service = workspaceServices.find((s) => s.id === selectedId);
        const unit = service?.unit || "";
        unitInput.value = unit;
        if (unitHint) {
          unitHint.textContent = unit
            ? `Expected unit: ${unit} (${service.trackingType})`
            : "Unit will be matched automatically from selected service.";
        }
      });
    }

    // Generator for client idempotency key
    if (genKeyBtn && keyInput) {
      genKeyBtn.addEventListener("click", () => {
        const rand = Math.random().toString(36).substring(2, 10);
        keyInput.value = `evt-${Date.now()}-${rand}`;
        keyInput.focus();
      });
    }

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (isSubmittingIngest) return;
        hideModalAlerts();

        const values = readIngestFormValues();
        const selectedService = workspaceServices.find((s) => s.id === values.serviceId);

        const validation = validateIngestForm(values, selectedService);
        if (validation.error) {
          showModalError(validation.error);
          if (validation.fieldId) document.getElementById(validation.fieldId)?.focus();
          return;
        }

        const payload = buildIngestPayload(values, selectedService);

        isSubmittingIngest = true;
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Submitting...";
        }

        try {
          const res = await api.post("/api/usage", payload);

          if (res.success && res.data) {
            const isReplay = res.data.idempotentReplay === true;
            const rec = res.data.record;

            if (isReplay) {
              const replayMsg = `Idempotent Replay (200 OK): An event with key "${payload.idempotencyKey || payload.externalEventId || 'provided'}" was already recorded previously. No duplicate usage was charged.`;
              if (replayBanner) {
                replayBanner.textContent = replayMsg;
                replayBanner.style.display = "block";
              }
              showPageInfoBanner(replayMsg);
            } else {
              isSubmittingIngest = false;
              closeModal("ingest-modal");
              showPageSuccessBanner(
                `Usage event recorded successfully: ${rec.quantity} ${rec.unit} for "${rec.serviceName || selectedService?.name || 'Service'}".`
              );
            }

            // Refresh table & summary metrics in active workspace
            await loadUsageSummary();
            await loadUsageHistory(1);
          }
        } catch (err) {
          if (err?.status === 409) {
            showModalError(
              `Idempotency Conflict (409): An event with key "${payload.idempotencyKey || payload.externalEventId}" already exists with a different payload (different quantity, unit, service, or timestamp).`
            );
          } else {
            showModalError(err?.message || "Failed to ingest usage event.");
          }
        } finally {
          isSubmittingIngest = false;
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Submit Usage";
          }
        }
      });
    }
  }

  function setupFilterEvents() {
    const applyBtn = document.getElementById("apply-filters-btn");
    const resetBtn = document.getElementById("reset-filters-btn");
    const serviceSelect = document.getElementById("filter-service");

    if (serviceSelect) {
      serviceSelect.addEventListener("change", () => {
        loadUsageHistory(1);
        loadUsageSummary();
      });
    }

    if (applyBtn) {
      applyBtn.addEventListener("click", () => {
        loadUsageHistory(1);
        loadUsageSummary();
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        const filterService = document.getElementById("filter-service");
        const filterStart = document.getElementById("filter-start-date");
        const filterEnd = document.getElementById("filter-end-date");
        if (filterService) filterService.value = "";
        if (filterStart) filterStart.value = "";
        if (filterEnd) filterEnd.value = "";
        hidePageErrorBanner();
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
    const startVal = document.getElementById("filter-start-date")?.value;
    const endVal = document.getElementById("filter-end-date")?.value;

    const rangeCheck = parseDateFilterRange(startVal, endVal);
    if (rangeCheck.error) {
      showPageErrorBanner(rangeCheck.error);
      return;
    }

    const params = { groupBy: "service" };
    if (serviceFilter) params.serviceId = serviceFilter;
    if (rangeCheck.startDateISO) params.startDate = rangeCheck.startDateISO;
    if (rangeCheck.endDateISO) params.endDate = rangeCheck.endDateISO;

    try {
      const res = await api.get("/api/usage/summary", params);
      const summaryList = res.data?.summary || [];

      let totalEvents = 0;
      let totalQty = 0;

      summaryList.forEach((item) => {
        totalEvents += item.eventCount || 0;
        const q = parseFloat(item.totalQuantity?.$numberDecimal || item.totalQuantity || 0);
        if (Number.isFinite(q)) totalQty += q;
      });

      const totalEventsEl = document.getElementById("metric-total-events");
      const aggregateVolEl = document.getElementById("metric-aggregate-volume");
      const distinctSvcEl = document.getElementById("metric-distinct-services");

      if (totalEventsEl) totalEventsEl.textContent = totalEvents.toLocaleString();
      if (aggregateVolEl) aggregateVolEl.textContent = totalQty.toLocaleString(undefined, { maximumFractionDigits: 4 });
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
    const refreshBtn = document.getElementById("refresh-usage-btn");

    hidePageErrorBanner();
    if (emptyState) emptyState.style.display = "none";

    const serviceId = document.getElementById("filter-service")?.value;
    const startVal = document.getElementById("filter-start-date")?.value;
    const endVal = document.getElementById("filter-end-date")?.value;

    const rangeCheck = parseDateFilterRange(startVal, endVal);
    if (rangeCheck.error) {
      showPageErrorBanner(rangeCheck.error);
      return;
    }

    const params = { page, limit: 20 };
    if (serviceId) params.serviceId = serviceId;
    if (rangeCheck.startDateISO) params.startDate = rangeCheck.startDateISO;
    if (rangeCheck.endDateISO) params.endDate = rangeCheck.endDateISO;

    // Loading State with safe DOM
    if (tableBody) {
      clearElement(tableBody);
      const loadingRow = document.createElement("tr");
      const loadingTd = document.createElement("td");
      loadingTd.colSpan = 8;
      loadingTd.style.textAlign = "center";
      loadingTd.style.color = "var(--color-text-muted)";
      loadingTd.style.padding = "2.5rem";
      loadingTd.textContent = "Loading usage audit records...";
      loadingRow.appendChild(loadingTd);
      tableBody.appendChild(loadingRow);
    }

    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.textContent = "Refreshing...";
    }

    try {
      const res = await api.get("/api/usage", params);
      const records = res.data && Array.isArray(res.data.records) ? res.data.records : [];
      const pagination = res.data?.pagination || { total: 0, page: 1, pages: 1 };
      cachedRecords = records;

      currentPage = pagination.page;
      totalPages = Math.max(1, pagination.pages);

      if (countBadge) {
        countBadge.textContent = `${pagination.total} Event${pagination.total === 1 ? "" : "s"}`;
      }

      clearElement(tableBody);

      if (records.length === 0) {
        if (emptyState) emptyState.style.display = "block";
        if (paginationBar) paginationBar.style.display = "none";
        return;
      }

      if (emptyState) emptyState.style.display = "none";
      if (paginationBar) paginationBar.style.display = "flex";

      updatePaginationControls(pagination);
      renderUsageTable(records);
    } catch (err) {
      showPageErrorBanner(`Error loading usage history: ${err.message || "Failed to fetch usage history."}`);
      if (tableBody) {
        clearElement(tableBody);
        const errRow = document.createElement("tr");
        const errTd = document.createElement("td");
        errTd.colSpan = 8;
        errTd.style.textAlign = "center";
        errTd.style.color = "var(--color-danger)";
        errTd.style.padding = "2.5rem";
        errTd.textContent = "Failed to load usage history. Please check connection and try again.";
        errRow.appendChild(errTd);
        tableBody.appendChild(errRow);
      }
    } finally {
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.textContent = "Refresh";
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

  /**
   * Pure safe DOM rendering for usage table.
   * Strictly avoids unsafe innerHTML injection of untrusted API values.
   */
  function renderUsageTable(records) {
    const tableBody = document.getElementById("usage-table-body");
    if (!tableBody) return;

    clearElement(tableBody);

    records.forEach((rec) => {
      const tr = document.createElement("tr");
      tr.setAttribute("data-usage-id", rec.id);

      // 1. Timestamp
      const dateTd = document.createElement("td");
      dateTd.style.whiteSpace = "nowrap";
      dateTd.style.fontSize = "0.8rem";
      dateTd.style.color = "var(--color-text-muted)";
      dateTd.textContent = formatDateTime(rec.occurredAt);
      tr.appendChild(dateTd);

      // 2. Service Name
      const nameTd = document.createElement("td");
      const nameSpan = document.createElement("span");
      nameSpan.style.fontWeight = "600";
      nameSpan.style.color = "var(--color-text-main)";
      nameSpan.textContent = rec.serviceName || (rec.serviceId && rec.serviceId.name) || "Tracked Service";
      nameTd.appendChild(nameSpan);
      tr.appendChild(nameTd);

      // 3. Quantity
      const qtyTd = document.createElement("td");
      const qtySpan = document.createElement("span");
      qtySpan.style.fontFamily = "var(--font-mono)";
      qtySpan.style.fontWeight = "600";
      qtySpan.textContent = formatQuantity(rec.quantity);
      qtyTd.appendChild(qtySpan);
      tr.appendChild(qtyTd);

      // 4. Unit
      const unitTd = document.createElement("td");
      const unitBadge = document.createElement("span");
      unitBadge.className = "badge badge-neutral";
      unitBadge.textContent = rec.unit || "--";
      unitTd.appendChild(unitBadge);
      tr.appendChild(unitTd);

      // 5. Source
      const sourceTd = document.createElement("td");
      sourceTd.style.fontSize = "0.8rem";
      sourceTd.style.color = "var(--color-text-muted)";
      sourceTd.textContent = rec.source || "api";
      tr.appendChild(sourceTd);

      // 6. Idempotency Key
      const keyTd = document.createElement("td");
      if (rec.idempotencyKey) {
        const keySpan = document.createElement("span");
        keySpan.style.fontFamily = "var(--font-mono)";
        keySpan.style.fontSize = "0.75rem";
        keySpan.style.color = "var(--color-text-muted)";
        keySpan.title = rec.idempotencyKey;
        keySpan.textContent =
          rec.idempotencyKey.length > 18
            ? `${rec.idempotencyKey.slice(0, 18)}...`
            : rec.idempotencyKey;
        keyTd.appendChild(keySpan);
      } else if (rec.externalEventId) {
        const extSpan = document.createElement("span");
        extSpan.style.fontFamily = "var(--font-mono)";
        extSpan.style.fontSize = "0.75rem";
        extSpan.style.color = "var(--color-text-muted)";
        extSpan.title = `Ext: ${rec.externalEventId}`;
        extSpan.textContent =
          rec.externalEventId.length > 18
            ? `ext:${rec.externalEventId.slice(0, 14)}...`
            : `ext:${rec.externalEventId}`;
        keyTd.appendChild(extSpan);
      } else {
        const noneSpan = document.createElement("span");
        noneSpan.style.color = "var(--color-text-light)";
        noneSpan.style.fontSize = "0.75rem";
        noneSpan.textContent = "None";
        keyTd.appendChild(noneSpan);
      }
      tr.appendChild(keyTd);

      // 7. Billing Status
      const billingTd = document.createElement("td");
      const isBilled = Boolean(rec.billingRecordId || rec.billedAt);
      const statusBadge = document.createElement("span");
      statusBadge.className = `badge ${isBilled ? "badge-success" : "badge-neutral"}`;
      statusBadge.textContent = isBilled ? "Billed" : "Unbilled";
      billingTd.appendChild(statusBadge);
      tr.appendChild(billingTd);

      // 8. Metadata Inspector
      const metaTd = document.createElement("td");
      metaTd.style.textAlign = "right";
      const hasMetadata = rec.metadata && typeof rec.metadata === "object" && Object.keys(rec.metadata).length > 0;

      if (hasMetadata) {
        const metaBtn = document.createElement("button");
        metaBtn.type = "button";
        metaBtn.className = "btn btn-secondary btn-sm inspect-metadata-btn";
        metaBtn.setAttribute("data-id", rec.id);
        metaBtn.style.fontSize = "0.75rem";
        metaBtn.style.padding = "0.2rem 0.5rem";
        metaBtn.textContent = "JSON";
        metaBtn.setAttribute("aria-label", `View metadata for event ${rec.id}`);
        metaBtn.addEventListener("click", () => openMetadataModal(rec.id));
        metaTd.appendChild(metaBtn);
      } else {
        const dashSpan = document.createElement("span");
        dashSpan.style.color = "var(--color-text-light)";
        dashSpan.style.fontSize = "0.75rem";
        dashSpan.textContent = "--";
        metaTd.appendChild(dashSpan);
      }
      tr.appendChild(metaTd);

      tableBody.appendChild(tr);
    });
  }

  function openMetadataModal(recordId) {
    const record = cachedRecords.find((r) => r.id === recordId);
    if (!record || !record.metadata) return;

    const modal = document.getElementById("metadata-modal");
    const contentEl = document.getElementById("metadata-content");

    if (contentEl) {
      contentEl.textContent = JSON.stringify(record.metadata, null, 2);
    }
    if (modal) {
      modal.classList.add("open");
    }
  }
})(window);
