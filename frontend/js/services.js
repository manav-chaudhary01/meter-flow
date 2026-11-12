/**
 * MeterFlow Services Screen Controller
 * Scoped to active workspace with role-based CRUD permissions and safe DOM rendering.
 */

(function (window) {
  "use strict";

  const VALID_TRACKING_TYPES = ["metered", "subscription", "hybrid"];
  const VALID_BILLING_INTERVALS = ["daily", "monthly", "quarterly", "yearly"];
  const VALID_STATUSES = ["active", "archived"];
  const DECIMAL_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

  function canManageWorkspace(role) {
    return role === "owner" || role === "admin";
  }

  function stringOrEmpty(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function validateNonNegativeDecimal(rawValue, fieldName, fieldId = null) {
    const trimmed = stringOrEmpty(rawValue).trim();
    if (!trimmed) {
      return { error: `${fieldName} is required`, fieldId };
    }
    if (!DECIMAL_PATTERN.test(trimmed)) {
      return { error: `${fieldName} must be a valid numeric decimal`, fieldId };
    }
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric) || Number.isNaN(numeric)) {
      return { error: `${fieldName} must be a valid finite number`, fieldId };
    }
    if (numeric < 0 || trimmed.startsWith("-")) {
      return { error: `${fieldName} must be a non-negative amount`, fieldId };
    }
    return { value: trimmed };
  }

  function validateServiceForm(mode, values, trackingTypeOverride = null) {
    const prefix = mode === "edit" ? "edit" : "create";
    const trackingType = trackingTypeOverride || stringOrEmpty(values.trackingType).trim();

    const name = stringOrEmpty(values.name).trim();
    if (!name) {
      return { error: "Service name is required", fieldId: `${prefix}-name` };
    }
    if (name.length < 2 || name.length > 100) {
      return {
        error: "Service name must be between 2 and 100 characters",
        fieldId: `${prefix}-name`
      };
    }

    const provider = stringOrEmpty(values.provider).trim();
    if (provider.length > 100) {
      return { error: "Provider must be 100 characters or fewer", fieldId: `${prefix}-provider` };
    }

    const category = stringOrEmpty(values.category).trim();
    if (category.length > 100) {
      return { error: "Category must be 100 characters or fewer", fieldId: `${prefix}-category` };
    }

    if (!VALID_TRACKING_TYPES.includes(trackingType)) {
      return {
        error: "Tracking type must be 'metered', 'subscription', or 'hybrid'",
        fieldId: `${prefix}-tracking-type`
      };
    }

    const rawCurrency = stringOrEmpty(values.currency).trim().toUpperCase();
    const currency = rawCurrency || (mode === "create" ? "USD" : "");
    if (!/^[A-Z]{3}$/.test(currency)) {
      return {
        error: "Currency must be a valid 3-letter ISO code (e.g. USD, EUR)",
        fieldId: `${prefix}-currency`
      };
    }

    if (mode === "edit") {
      const status = stringOrEmpty(values.status).trim().toLowerCase();
      if (!VALID_STATUSES.includes(status)) {
        return { error: "Status must be 'active' or 'archived'", fieldId: "edit-status" };
      }
    }

    if (trackingType === "metered" || trackingType === "hybrid") {
      const unit = stringOrEmpty(values.unit).trim();
      if (!unit) {
        return { error: `Unit is required for ${trackingType} services`, fieldId: `${prefix}-unit` };
      }
      if (unit.length > 50) {
        return { error: "Unit of measure must be 50 characters or fewer", fieldId: `${prefix}-unit` };
      }

      const unitPriceCheck = validateNonNegativeDecimal(values.unitPrice, "Unit price", `${prefix}-unit-price`);
      if (unitPriceCheck.error) {
        return unitPriceCheck;
      }
    }

    if (trackingType === "subscription" || trackingType === "hybrid") {
      const subAmountCheck = validateNonNegativeDecimal(
        values.subscriptionAmount,
        "Subscription amount",
        `${prefix}-sub-amount`
      );
      if (subAmountCheck.error) {
        return subAmountCheck;
      }

      const interval = stringOrEmpty(values.billingInterval || "monthly").trim().toLowerCase();
      if (!VALID_BILLING_INTERVALS.includes(interval)) {
        return {
          error: "Billing interval must be 'daily', 'monthly', 'quarterly', or 'yearly'",
          fieldId: `${prefix}-interval`
        };
      }
    }

    return { valid: true };
  }

  function buildServicePayload(mode, values, trackingTypeOverride = null) {
    const trackingType = trackingTypeOverride || stringOrEmpty(values.trackingType).trim();
    const currency = stringOrEmpty(values.currency).trim().toUpperCase() || "USD";
    const category = stringOrEmpty(values.category).trim() || "general";
    const provider = stringOrEmpty(values.provider).trim();

    const payload = {
      name: stringOrEmpty(values.name).trim(),
      provider,
      category,
      currency
    };

    if (mode === "create") {
      payload.trackingType = trackingType;
    } else {
      payload.status = stringOrEmpty(values.status).trim().toLowerCase();
    }

    if (trackingType === "metered" || trackingType === "hybrid") {
      payload.unit = stringOrEmpty(values.unit).trim();
      payload.unitPrice = stringOrEmpty(values.unitPrice).trim();
    }

    if (trackingType === "subscription" || trackingType === "hybrid") {
      payload.subscriptionAmount = stringOrEmpty(values.subscriptionAmount).trim();
      payload.billingInterval = stringOrEmpty(values.billingInterval || "monthly").trim().toLowerCase();
    }

    return payload;
  }

  function formatPricingRate(svc) {
    if (!svc) return "--";
    const currency = svc.currency || "USD";
    if (svc.trackingType === "metered") {
      const price = svc.unitPrice !== null && svc.unitPrice !== undefined ? svc.unitPrice : "0";
      return `${currency} ${price} / ${svc.unit || "unit"}`;
    }
    if (svc.trackingType === "subscription") {
      const amount = svc.subscriptionAmount !== null && svc.subscriptionAmount !== undefined ? svc.subscriptionAmount : "0";
      return `${currency} ${amount} / ${svc.billingInterval || "cycle"}`;
    }
    if (svc.trackingType === "hybrid") {
      const amount = svc.subscriptionAmount !== null && svc.subscriptionAmount !== undefined ? svc.subscriptionAmount : "0";
      const price = svc.unitPrice !== null && svc.unitPrice !== undefined ? svc.unitPrice : "0";
      return `${currency} ${amount} / ${svc.billingInterval || "cycle"} + ${currency} ${price} / ${svc.unit || "unit"}`;
    }
    return "--";
  }

  // Expose pure validation & formatting helpers for direct verification/testing
  window.MeterFlowServices = {
    canManageWorkspace,
    validateNonNegativeDecimal,
    validateServiceForm,
    buildServicePayload,
    formatPricingRate
  };

  const api = window.MeterFlowAPI;
  const auth = window.MeterFlowAuth;

  if (!api || !auth || typeof document === "undefined") {
    return;
  }

  if (!auth.requireAuth()) return;

  let currentWorkspaceId = "";
  let currentWorkspaceRole = "member";
  let cachedServices = [];
  let activeEditService = null;
  let pendingArchiveService = null;
  let isSubmittingCreate = false;
  let isSubmittingEdit = false;
  let isSubmittingArchive = false;
  let successBannerTimeout = null;

  document.addEventListener("DOMContentLoaded", initServicesPage);

  async function initServicesPage() {
    setupUserProfile();
    setupMobileMenu();
    setupModals();
    setupFilterEvents();
    setupCreateForm();
    setupEditForm();
    setupArchiveModal();

    await loadWorkspaces();
    await loadServices();

    const refreshBtn = document.getElementById("refresh-services-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => loadServices(true));
    }
  }

  function clearElement(element) {
    if (!element) return;
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  function showModalError(errorEl, message) {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.style.display = "block";
  }

  function hideModalError(errorEl) {
    if (!errorEl) return;
    errorEl.textContent = "";
    errorEl.style.display = "none";
  }

  function showPageErrorBanner(message) {
    const errorBanner = document.getElementById("services-error-banner");
    const successBanner = document.getElementById("services-success-banner");
    if (successBanner) successBanner.style.display = "none";
    if (!errorBanner) return;
    errorBanner.textContent = message;
    errorBanner.style.display = "block";
  }

  function hidePageErrorBanner() {
    const errorBanner = document.getElementById("services-error-banner");
    if (!errorBanner) return;
    errorBanner.textContent = "";
    errorBanner.style.display = "none";
  }

  function showSuccessBanner(message) {
    const banner = document.getElementById("services-success-banner");
    hidePageErrorBanner();
    if (!banner) return;
    if (successBannerTimeout) {
      clearTimeout(successBannerTimeout);
    }
    banner.textContent = message;
    banner.style.display = "block";
    successBannerTimeout = setTimeout(() => {
      banner.style.display = "none";
    }, 5000);
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

        applyRolePermissions(currentWorkspaceRole);
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
          applyRolePermissions(currentWorkspaceRole);

          closeModal("create-modal");
          closeModal("edit-modal");
          closeModal("archive-modal");

          await loadServices(true);
        }
      } catch (switchErr) {
        selectEl.value = currentWorkspaceId;
        showPageErrorBanner(`Failed to switch workspace: ${switchErr.message || "Unknown error"}`);
      } finally {
        selectEl.disabled = false;
      }
    });
  }

  function applyRolePermissions(role) {
    const roleBadgeEl = document.getElementById("workspace-role-badge");
    const openCreateBtn = document.getElementById("open-create-modal-btn");

    if (roleBadgeEl) {
      roleBadgeEl.textContent = role;
      roleBadgeEl.className = `badge badge-${role === "owner" ? "primary" : role === "admin" ? "info" : "neutral"}`;
    }

    const canManage = canManageWorkspace(role);
    if (openCreateBtn) {
      openCreateBtn.disabled = !canManage;
      openCreateBtn.setAttribute("aria-disabled", String(!canManage));
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

  function syncPricingVisibilityAndState(prefix, trackingType) {
    const meteredFields = document.getElementById(`${prefix}-metered-fields`);
    const subFields = document.getElementById(`${prefix}-subscription-fields`);
    const unitInput = document.getElementById(`${prefix}-unit`);
    const unitPriceInput = document.getElementById(`${prefix}-unit-price`);
    const subAmountInput = document.getElementById(`${prefix}-sub-amount`);
    const intervalSelect = document.getElementById(`${prefix}-interval`);

    const needsMetered = trackingType === "metered" || trackingType === "hybrid";
    const needsSub = trackingType === "subscription" || trackingType === "hybrid";

    if (meteredFields) meteredFields.style.display = needsMetered ? "grid" : "none";
    if (unitInput) {
      unitInput.disabled = !needsMetered;
      unitInput.required = needsMetered;
    }
    if (unitPriceInput) {
      unitPriceInput.disabled = !needsMetered;
      unitPriceInput.required = needsMetered;
    }

    if (subFields) subFields.style.display = needsSub ? "grid" : "none";
    if (subAmountInput) {
      subAmountInput.disabled = !needsSub;
      subAmountInput.required = needsSub;
    }
    if (intervalSelect) {
      intervalSelect.disabled = !needsSub;
      intervalSelect.required = needsSub;
    }
  }

  function resetCreateModalState() {
    const form = document.getElementById("create-service-form");
    const errorBanner = document.getElementById("create-modal-error");
    const typeSelect = document.getElementById("create-tracking-type");

    hideModalError(errorBanner);
    if (form) form.reset();
    if (typeSelect) typeSelect.value = "metered";
    syncPricingVisibilityAndState("create", "metered");
  }

  function resetEditModalState() {
    const form = document.getElementById("edit-service-form");
    const errorBanner = document.getElementById("edit-modal-error");
    const loadingBanner = document.getElementById("edit-modal-loading");

    activeEditService = null;
    hideModalError(errorBanner);
    if (loadingBanner) loadingBanner.style.display = "none";
    if (form) form.reset();
  }

  function resetArchiveModalState() {
    const errorBanner = document.getElementById("archive-modal-error");
    const nameEl = document.getElementById("archive-service-name");
    pendingArchiveService = null;
    hideModalError(errorBanner);
    if (nameEl) nameEl.textContent = "this service";
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal || !modal.classList.contains("open")) return;

    if (modalId === "create-modal" && isSubmittingCreate) return;
    if (modalId === "edit-modal" && isSubmittingEdit) return;
    if (modalId === "archive-modal" && isSubmittingArchive) return;

    modal.classList.remove("open");

    if (modalId === "create-modal") resetCreateModalState();
    if (modalId === "edit-modal") resetEditModalState();
    if (modalId === "archive-modal") resetArchiveModalState();
  }

  function setupModals() {
    const openCreateBtn = document.getElementById("open-create-modal-btn");
    const createModal = document.getElementById("create-modal");
    const editModal = document.getElementById("edit-modal");
    const archiveModal = document.getElementById("archive-modal");

    if (openCreateBtn && createModal) {
      openCreateBtn.addEventListener("click", () => {
        if (!canManageWorkspace(currentWorkspaceRole)) {
          showPageErrorBanner("Only workspace owners and administrators can create services.");
          return;
        }
        resetCreateModalState();
        createModal.classList.add("open");
        document.getElementById("create-name")?.focus();
      });
    }

    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const modalId = btn.getAttribute("data-close-modal");
        closeModal(modalId);
      });
    });

    [createModal, editModal, archiveModal].forEach((modal) => {
      if (modal) {
        modal.addEventListener("click", (e) => {
          if (e.target === modal) closeModal(modal.id);
        });
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (archiveModal?.classList.contains("open")) closeModal("archive-modal");
      else if (editModal?.classList.contains("open")) closeModal("edit-modal");
      else if (createModal?.classList.contains("open")) closeModal("create-modal");
    });
  }

  function readCreateFormValues() {
    return {
      name: document.getElementById("create-name")?.value,
      provider: document.getElementById("create-provider")?.value,
      category: document.getElementById("create-category")?.value,
      trackingType: document.getElementById("create-tracking-type")?.value,
      currency: document.getElementById("create-currency")?.value,
      unit: document.getElementById("create-unit")?.value,
      unitPrice: document.getElementById("create-unit-price")?.value,
      subscriptionAmount: document.getElementById("create-sub-amount")?.value,
      billingInterval: document.getElementById("create-interval")?.value
    };
  }

  function setupCreateForm() {
    const form = document.getElementById("create-service-form");
    const typeSelect = document.getElementById("create-tracking-type");
    const submitBtn = document.getElementById("create-submit-btn");
    const errorBanner = document.getElementById("create-modal-error");

    if (typeSelect) {
      syncPricingVisibilityAndState("create", typeSelect.value || "metered");
      typeSelect.addEventListener("change", () => {
        hideModalError(errorBanner);
        syncPricingVisibilityAndState("create", typeSelect.value);
      });
    }

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (isSubmittingCreate) return;
        hideModalError(errorBanner);

        if (!canManageWorkspace(currentWorkspaceRole)) {
          showModalError(errorBanner, "Forbidden: only workspace owners and administrators can create services.");
          return;
        }

        const values = readCreateFormValues();
        const validation = validateServiceForm("create", values, values.trackingType);
        if (validation.error) {
          showModalError(errorBanner, validation.error);
          if (validation.fieldId) document.getElementById(validation.fieldId)?.focus();
          return;
        }

        const payload = buildServicePayload("create", values, values.trackingType);

        isSubmittingCreate = true;
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Creating...";
        }

        try {
          const res = await api.post("/api/services", payload);
          if (res.success && res.data?.service) {
            const created = res.data.service;
            isSubmittingCreate = false;
            closeModal("create-modal");

            // Ensure newly created active service is visible under current filters
            const statusSelect = document.getElementById("filter-status");
            const filterTypeSelect = document.getElementById("filter-type");
            const filterCatInput = document.getElementById("filter-category");
            if (statusSelect && statusSelect.value === "archived") {
              statusSelect.value = "active";
            }
            if (filterTypeSelect && filterTypeSelect.value && filterTypeSelect.value !== created.trackingType) {
              filterTypeSelect.value = "";
            }
            if (filterCatInput && filterCatInput.value.trim() && filterCatInput.value.trim() !== created.category) {
              filterCatInput.value = "";
            }

            showSuccessBanner(`Service "${created.name}" created successfully.`);
            await loadServices(true);
          }
        } catch (err) {
          showModalError(errorBanner, formatApiErrorMessage(err, "create service"));
        } finally {
          isSubmittingCreate = false;
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Create Service";
          }
        }
      });
    }
  }

  function setEditFormInputsDisabled(disabled) {
    const ids = [
      "edit-name",
      "edit-provider",
      "edit-category",
      "edit-currency",
      "edit-status",
      "edit-unit",
      "edit-unit-price",
      "edit-sub-amount",
      "edit-interval",
      "edit-submit-btn"
    ];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    });
  }

  async function openEditModal(serviceId) {
    if (!canManageWorkspace(currentWorkspaceRole)) {
      showPageErrorBanner("Only workspace owners and administrators can edit services.");
      return;
    }

    const modal = document.getElementById("edit-modal");
    const errorBanner = document.getElementById("edit-modal-error");
    const loadingBanner = document.getElementById("edit-modal-loading");

    resetEditModalState();
    setEditFormInputsDisabled(true);
    if (loadingBanner) loadingBanner.style.display = "block";
    if (modal) modal.classList.add("open");

    try {
      const res = await api.get(`/api/services/${serviceId}`);
      if (!modal?.classList.contains("open")) return;
      const service = res?.data?.service;
      if (!service) {
        throw new Error("Service details could not be loaded.");
      }

      activeEditService = service;
      if (loadingBanner) loadingBanner.style.display = "none";

      const editId = document.getElementById("edit-id");
      const editName = document.getElementById("edit-name");
      const editProvider = document.getElementById("edit-provider");
      const editCategory = document.getElementById("edit-category");
      const editTrackingType = document.getElementById("edit-tracking-type");
      const editCurrency = document.getElementById("edit-currency");
      const editStatus = document.getElementById("edit-status");
      const unitInput = document.getElementById("edit-unit");
      const unitPriceInput = document.getElementById("edit-unit-price");
      const subAmountInput = document.getElementById("edit-sub-amount");
      const intervalSelect = document.getElementById("edit-interval");

      if (editId) editId.value = service.id;
      if (editName) editName.value = stringOrEmpty(service.name);
      if (editProvider) editProvider.value = stringOrEmpty(service.provider);
      if (editCategory) editCategory.value = stringOrEmpty(service.category || "general");
      if (editTrackingType) editTrackingType.value = service.trackingType || "metered";
      if (editCurrency) editCurrency.value = stringOrEmpty(service.currency || "USD");
      if (editStatus) editStatus.value = service.status || "active";

      setEditFormInputsDisabled(false);
      syncPricingVisibilityAndState("edit", service.trackingType);

      if (service.trackingType === "metered" || service.trackingType === "hybrid") {
        if (unitInput) unitInput.value = stringOrEmpty(service.unit);
        if (unitPriceInput) unitPriceInput.value = stringOrEmpty(service.unitPrice);
      } else {
        if (unitInput) unitInput.value = "";
        if (unitPriceInput) unitPriceInput.value = "";
      }

      if (service.trackingType === "subscription" || service.trackingType === "hybrid") {
        if (subAmountInput) subAmountInput.value = stringOrEmpty(service.subscriptionAmount);
        if (intervalSelect) intervalSelect.value = service.billingInterval || "monthly";
      } else {
        if (subAmountInput) subAmountInput.value = "";
        if (intervalSelect) intervalSelect.value = "monthly";
      }

      editName?.focus();
    } catch (err) {
      if (loadingBanner) loadingBanner.style.display = "none";
      showModalError(errorBanner, formatApiErrorMessage(err, "load service details"));
    }
  }

  function readEditFormValues() {
    return {
      id: document.getElementById("edit-id")?.value,
      name: document.getElementById("edit-name")?.value,
      provider: document.getElementById("edit-provider")?.value,
      category: document.getElementById("edit-category")?.value,
      currency: document.getElementById("edit-currency")?.value,
      status: document.getElementById("edit-status")?.value,
      unit: document.getElementById("edit-unit")?.value,
      unitPrice: document.getElementById("edit-unit-price")?.value,
      subscriptionAmount: document.getElementById("edit-sub-amount")?.value,
      billingInterval: document.getElementById("edit-interval")?.value
    };
  }

  function setupEditForm() {
    const form = document.getElementById("edit-service-form");
    const submitBtn = document.getElementById("edit-submit-btn");
    const errorBanner = document.getElementById("edit-modal-error");

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (isSubmittingEdit) return;
        hideModalError(errorBanner);

        if (!canManageWorkspace(currentWorkspaceRole)) {
          showModalError(errorBanner, "Forbidden: only workspace owners and administrators can edit services.");
          return;
        }

        if (!activeEditService) {
          showModalError(errorBanner, "No service selected for editing. Please close and try again.");
          return;
        }

        const values = readEditFormValues();
        const trackingType = activeEditService.trackingType;
        const validation = validateServiceForm("edit", values, trackingType);
        if (validation.error) {
          showModalError(errorBanner, validation.error);
          if (validation.fieldId) document.getElementById(validation.fieldId)?.focus();
          return;
        }

        const payload = buildServicePayload("edit", values, trackingType);

        isSubmittingEdit = true;
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Saving...";
        }

        try {
          const res = await api.put(`/api/services/${values.id}`, payload);
          if (res.success && res.data?.service) {
            const updatedName = res.data.service.name;
            isSubmittingEdit = false;
            closeModal("edit-modal");
            showSuccessBanner(`Service "${updatedName}" updated successfully.`);
            await loadServices(true);
          }
        } catch (err) {
          showModalError(errorBanner, formatApiErrorMessage(err, "update service"));
          if (err?.status === 404) {
            await loadServices(true);
          }
        } finally {
          isSubmittingEdit = false;
          if (submitBtn) {
            submitBtn.disabled = !activeEditService;
            submitBtn.textContent = "Save Changes";
          }
        }
      });
    }
  }

  function openArchiveModal(serviceId, serviceName) {
    if (!canManageWorkspace(currentWorkspaceRole)) {
      showPageErrorBanner("Only workspace owners and administrators can archive services.");
      return;
    }

    const modal = document.getElementById("archive-modal");
    const nameEl = document.getElementById("archive-service-name");
    const errorBanner = document.getElementById("archive-modal-error");
    const confirmBtn = document.getElementById("archive-confirm-btn");
    const cancelBtn = document.getElementById("archive-cancel-btn");

    resetArchiveModalState();
    pendingArchiveService = { id: serviceId, name: serviceName };
    if (nameEl) nameEl.textContent = serviceName || "this service";
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Archive Service";
    }
    if (cancelBtn) cancelBtn.disabled = false;
    hideModalError(errorBanner);

    if (modal) modal.classList.add("open");
    cancelBtn?.focus();
  }

  function setupArchiveModal() {
    const confirmBtn = document.getElementById("archive-confirm-btn");
    const cancelBtn = document.getElementById("archive-cancel-btn");
    const errorBanner = document.getElementById("archive-modal-error");

    if (!confirmBtn) return;

    confirmBtn.addEventListener("click", async () => {
      if (isSubmittingArchive) return;
      hideModalError(errorBanner);

      if (!canManageWorkspace(currentWorkspaceRole)) {
        showModalError(errorBanner, "Forbidden: only workspace owners and administrators can archive services.");
        return;
      }

      if (!pendingArchiveService?.id) {
        showModalError(errorBanner, "No service selected for archival.");
        return;
      }

      isSubmittingArchive = true;
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Archiving...";
      if (cancelBtn) cancelBtn.disabled = true;

      try {
        const res = await api.delete(`/api/services/${pendingArchiveService.id}`);
        if (res.success) {
          const archivedName = res.data?.service?.name || pendingArchiveService.name;
          isSubmittingArchive = false;
          closeModal("archive-modal");
          showSuccessBanner(`Service "${archivedName}" has been archived.`);
          await loadServices(true);
        }
      } catch (err) {
        showModalError(errorBanner, formatApiErrorMessage(err, "archive service"));
        if (err?.status === 404) {
          await loadServices(true);
        }
      } finally {
        isSubmittingArchive = false;
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Archive Service";
        if (cancelBtn) cancelBtn.disabled = false;
      }
    });
  }

  function formatApiErrorMessage(err, actionLabel) {
    const baseMsg = err?.message || `Failed to ${actionLabel}.`;
    if (err?.status === 403) {
      return `Permission denied (403): ${baseMsg}`;
    }
    if (err?.status === 404) {
      return `Not found (404): ${baseMsg}`;
    }
    if (err?.status === 409) {
      return `Conflict (409): ${baseMsg}`;
    }
    return baseMsg;
  }

  function setupFilterEvents() {
    const statusSelect = document.getElementById("filter-status");
    const typeSelect = document.getElementById("filter-type");
    const categoryInput = document.getElementById("filter-category");
    const resetBtn = document.getElementById("reset-filters-btn");

    [statusSelect, typeSelect].forEach((el) => {
      if (el) el.addEventListener("change", () => loadServices(false));
    });

    if (categoryInput) {
      let debounceTimeout;
      categoryInput.addEventListener("input", () => {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => loadServices(false), 300);
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        if (statusSelect) statusSelect.value = "active";
        if (typeSelect) typeSelect.value = "";
        if (categoryInput) categoryInput.value = "";
        loadServices(false);
      });
    }
  }

  async function loadServices() {
    const tableBody = document.getElementById("services-table-body");
    const emptyState = document.getElementById("services-empty");
    const countBadge = document.getElementById("services-count-badge");
    const refreshBtn = document.getElementById("refresh-services-btn");

    hidePageErrorBanner();
    if (emptyState) emptyState.style.display = "none";

    const status = document.getElementById("filter-status")?.value || "active";
    const trackingType = document.getElementById("filter-type")?.value || "";
    const category = document.getElementById("filter-category")?.value.trim() || "";

    const params = { status };
    if (trackingType) params.trackingType = trackingType;
    if (category) params.category = category;

    // Loading State
    if (tableBody) {
      clearElement(tableBody);
      const loadingRow = document.createElement("tr");
      const loadingTd = document.createElement("td");
      loadingTd.colSpan = 9;
      loadingTd.style.textAlign = "center";
      loadingTd.style.color = "var(--color-text-muted)";
      loadingTd.style.padding = "2.5rem";
      loadingTd.textContent = "Loading services for active workspace...";
      loadingRow.appendChild(loadingTd);
      tableBody.appendChild(loadingRow);
    }

    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.textContent = "Refreshing...";
    }

    try {
      const res = await api.get("/api/services", params);
      const services = res.data && Array.isArray(res.data.services) ? res.data.services : [];
      cachedServices = services;

      if (countBadge) {
        countBadge.textContent = `${services.length} Service${services.length === 1 ? "" : "s"}`;
      }

      clearElement(tableBody);

      if (services.length === 0) {
        if (emptyState) emptyState.style.display = "block";
        return;
      }

      if (emptyState) emptyState.style.display = "none";
      renderServicesTable(services);
    } catch (err) {
      showPageErrorBanner(`Error loading services: ${err.message || "Failed to fetch services."}`);
      if (tableBody) {
        clearElement(tableBody);
        const errRow = document.createElement("tr");
        const errTd = document.createElement("td");
        errTd.colSpan = 9;
        errTd.style.textAlign = "center";
        errTd.style.color = "var(--color-danger)";
        errTd.style.padding = "2.5rem";
        errTd.textContent = "Failed to load services. Please check connection and try again.";
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

  /**
   * Pure safe DOM rendering for services table.
   * Completely avoids unsafe innerHTML injection of untrusted API values.
   */
  function renderServicesTable(services) {
    const tableBody = document.getElementById("services-table-body");
    if (!tableBody) return;

    clearElement(tableBody);

    const canManage = canManageWorkspace(currentWorkspaceRole);

    services.forEach((svc) => {
      const tr = document.createElement("tr");
      tr.setAttribute("data-service-id", svc.id);

      // 1. Service Name & Provider
      const nameTd = document.createElement("td");
      const nameDiv = document.createElement("div");
      nameDiv.style.fontWeight = "600";
      nameDiv.style.color = "var(--color-text-main)";
      nameDiv.textContent = svc.name || "";
      nameTd.appendChild(nameDiv);

      if (svc.provider) {
        const providerDiv = document.createElement("div");
        providerDiv.style.fontSize = "0.775rem";
        providerDiv.style.color = "var(--color-text-muted)";
        providerDiv.textContent = svc.provider;
        nameTd.appendChild(providerDiv);
      }
      tr.appendChild(nameTd);

      // 2. Category
      const catTd = document.createElement("td");
      const catSpan = document.createElement("span");
      catSpan.style.fontSize = "0.85rem";
      catSpan.style.color = "var(--color-text-muted)";
      catSpan.style.textTransform = "capitalize";
      catSpan.textContent = svc.category || "general";
      catTd.appendChild(catSpan);
      tr.appendChild(catTd);

      // 3. Tracking Type Badge
      const typeTd = document.createElement("td");
      const typeBadge = document.createElement("span");
      const typeBadgeClass =
        svc.trackingType === "metered"
          ? "badge-primary"
          : svc.trackingType === "subscription"
          ? "badge-info"
          : "badge-warning";
      typeBadge.className = `badge ${typeBadgeClass}`;
      typeBadge.textContent = svc.trackingType || "";
      typeTd.appendChild(typeBadge);
      tr.appendChild(typeTd);

      // 4. Unit of Measure
      const unitTd = document.createElement("td");
      if (svc.unit) {
        const unitBadge = document.createElement("span");
        unitBadge.className = "badge badge-neutral";
        unitBadge.textContent = svc.unit;
        unitTd.appendChild(unitBadge);
      } else {
        const dashSpan = document.createElement("span");
        dashSpan.style.color = "var(--color-text-muted)";
        dashSpan.textContent = "--";
        unitTd.appendChild(dashSpan);
      }
      tr.appendChild(unitTd);

      // 5. Billing Interval
      const intervalTd = document.createElement("td");
      if (svc.billingInterval) {
        const intervalSpan = document.createElement("span");
        intervalSpan.style.fontSize = "0.85rem";
        intervalSpan.style.textTransform = "capitalize";
        intervalSpan.textContent = svc.billingInterval;
        intervalTd.appendChild(intervalSpan);
      } else {
        const dashSpan = document.createElement("span");
        dashSpan.style.color = "var(--color-text-muted)";
        dashSpan.textContent = "--";
        intervalTd.appendChild(dashSpan);
      }
      tr.appendChild(intervalTd);

      // 6. Pricing Rate
      const priceTd = document.createElement("td");
      const priceSpan = document.createElement("span");
      priceSpan.style.fontFamily = "var(--font-mono)";
      priceSpan.style.fontSize = "0.85rem";
      priceSpan.textContent = formatPricingRate(svc);
      priceTd.appendChild(priceSpan);
      tr.appendChild(priceTd);

      // 7. Currency
      const currTd = document.createElement("td");
      const currSpan = document.createElement("span");
      currSpan.style.fontWeight = "500";
      currSpan.textContent = svc.currency || "";
      currTd.appendChild(currSpan);
      tr.appendChild(currTd);

      // 8. Status Badge
      const statusTd = document.createElement("td");
      const statusBadge = document.createElement("span");
      statusBadge.className = `badge ${svc.status === "active" ? "badge-success" : "badge-neutral"}`;
      statusBadge.textContent = svc.status || "";
      statusTd.appendChild(statusBadge);
      tr.appendChild(statusTd);

      // 9. Actions (Edit & Archive)
      const actionsTd = document.createElement("td");
      actionsTd.style.textAlign = "right";
      actionsTd.style.whiteSpace = "nowrap";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn btn-secondary btn-sm action-edit-btn";
      editBtn.setAttribute("data-id", svc.id);
      editBtn.style.marginRight = "4px";
      editBtn.textContent = "Edit";
      editBtn.setAttribute("aria-label", `Edit ${svc.name || "service"}`);
      if (!canManage) {
        editBtn.disabled = true;
        editBtn.setAttribute("aria-disabled", "true");
        editBtn.title = "Requires Admin or Owner role in this workspace";
      }
      editBtn.addEventListener("click", () => openEditModal(svc.id));
      actionsTd.appendChild(editBtn);

      if (svc.status === "active") {
        const archiveBtn = document.createElement("button");
        archiveBtn.type = "button";
        archiveBtn.className = "btn btn-secondary btn-sm action-archive-btn";
        archiveBtn.setAttribute("data-id", svc.id);
        archiveBtn.style.color = "var(--color-danger)";
        archiveBtn.textContent = "Archive";
        archiveBtn.setAttribute("aria-label", `Archive ${svc.name || "service"}`);
        if (!canManage) {
          archiveBtn.disabled = true;
          archiveBtn.setAttribute("aria-disabled", "true");
          archiveBtn.title = "Requires Admin or Owner role in this workspace";
        }
        archiveBtn.addEventListener("click", () => openArchiveModal(svc.id, svc.name));
        actionsTd.appendChild(archiveBtn);
      }
      tr.appendChild(actionsTd);

      tableBody.appendChild(tr);
    });
  }
})(window);
