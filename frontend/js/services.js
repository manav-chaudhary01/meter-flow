/**
 * MeterFlow Services Screen Controller
 * Scoped to active workspace with role-based CRUD permissions.
 */

(function (window) {
  "use strict";

  const api = window.MeterFlowAPI;
  const auth = window.MeterFlowAuth;

  if (!auth.requireAuth()) return;

  let currentWorkspaceRole = "member";
  let cachedServices = [];

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  document.addEventListener("DOMContentLoaded", initServicesPage);

  async function initServicesPage() {
    setupUserProfile();
    setupMobileMenu();
    setupModals();
    setupFilterEvents();
    setupCreateForm();
    setupEditForm();

    await loadWorkspaces();
    await loadServices();

    const refreshBtn = document.getElementById("refresh-services-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => loadServices(true));
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
    const openCreateBtn = document.getElementById("open-create-modal-btn");
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

          await loadServices(true);
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
    const openCreateBtn = document.getElementById("open-create-modal-btn");

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
    const openCreateBtn = document.getElementById("open-create-modal-btn");
    const createModal = document.getElementById("create-modal");
    const editModal = document.getElementById("edit-modal");

    if (openCreateBtn && createModal) {
      openCreateBtn.addEventListener("click", () => {
        if (currentWorkspaceRole !== "owner" && currentWorkspaceRole !== "admin") {
          alert("Only workspace owners and administrators can create services.");
          return;
        }
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

  function setupCreateForm() {
    const form = document.getElementById("create-service-form");
    const typeSelect = document.getElementById("create-tracking-type");
    const meteredFields = document.getElementById("create-metered-fields");
    const subFields = document.getElementById("create-subscription-fields");
    const unitInput = document.getElementById("create-unit");
    const unitPriceInput = document.getElementById("create-unit-price");
    const subAmountInput = document.getElementById("create-sub-amount");
    const submitBtn = document.getElementById("create-submit-btn");
    const errorBanner = document.getElementById("create-modal-error");

    if (typeSelect) {
      typeSelect.addEventListener("change", () => {
        const val = typeSelect.value;
        if (val === "metered") {
          meteredFields.style.display = "grid";
          subFields.style.display = "none";
          unitInput.required = true;
          unitPriceInput.required = true;
          subAmountInput.required = false;
        } else if (val === "subscription") {
          meteredFields.style.display = "none";
          subFields.style.display = "grid";
          unitInput.required = false;
          unitPriceInput.required = false;
          subAmountInput.required = true;
        } else if (val === "hybrid") {
          meteredFields.style.display = "grid";
          subFields.style.display = "grid";
          unitInput.required = true;
          unitPriceInput.required = true;
          subAmountInput.required = true;
        }
      });
    }

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (errorBanner) errorBanner.style.display = "none";

        const name = document.getElementById("create-name")?.value.trim();
        const provider = document.getElementById("create-provider")?.value.trim();
        const category = document.getElementById("create-category")?.value.trim() || "general";
        const trackingType = typeSelect?.value;
        const currency = document.getElementById("create-currency")?.value.trim().toUpperCase() || "USD";

        const payload = { name, provider, category, trackingType, currency };

        if (trackingType === "metered" || trackingType === "hybrid") {
          payload.unit = unitInput?.value.trim();
          payload.unitPrice = unitPriceInput?.value;
        }

        if (trackingType === "subscription" || trackingType === "hybrid") {
          payload.subscriptionAmount = subAmountInput?.value;
          payload.billingInterval = document.getElementById("create-interval")?.value || "monthly";
        }

        submitBtn.disabled = true;
        submitBtn.textContent = "Creating...";

        try {
          const res = await api.post("/api/services", payload);
          if (res.success) {
            form.reset();
            document.getElementById("create-modal")?.classList.remove("open");
            showSuccessBanner(`Service "${res.data.service.name}" created successfully.`);
            await loadServices(true);
          }
        } catch (err) {
          if (errorBanner) {
            errorBanner.textContent = err.message || "Failed to create service.";
            errorBanner.style.display = "block";
          }
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = "Create Service";
        }
      });
    }
  }

  function setupEditForm() {
    const form = document.getElementById("edit-service-form");
    const submitBtn = document.getElementById("edit-submit-btn");
    const errorBanner = document.getElementById("edit-modal-error");

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (errorBanner) errorBanner.style.display = "none";

        const id = document.getElementById("edit-id")?.value;
        const name = document.getElementById("edit-name")?.value.trim();
        const provider = document.getElementById("edit-provider")?.value.trim();
        const category = document.getElementById("edit-category")?.value.trim();
        const currency = document.getElementById("edit-currency")?.value.trim().toUpperCase();
        const status = document.getElementById("edit-status")?.value;

        const payload = { name, provider, category, currency, status };

        const service = cachedServices.find((s) => s.id === id);
        if (service) {
          if (service.trackingType === "metered" || service.trackingType === "hybrid") {
            const unit = document.getElementById("edit-unit")?.value.trim();
            const unitPrice = document.getElementById("edit-unit-price")?.value;
            if (unit) payload.unit = unit;
            if (unitPrice !== "") payload.unitPrice = unitPrice;
          }

          if (service.trackingType === "subscription" || service.trackingType === "hybrid") {
            const subAmount = document.getElementById("edit-sub-amount")?.value;
            const interval = document.getElementById("edit-interval")?.value;
            if (subAmount !== "") payload.subscriptionAmount = subAmount;
            if (interval) payload.billingInterval = interval;
          }
        }

        submitBtn.disabled = true;
        submitBtn.textContent = "Saving...";

        try {
          const res = await api.put(`/api/services/${id}`, payload);
          if (res.success) {
            document.getElementById("edit-modal")?.classList.remove("open");
            showSuccessBanner(`Service "${res.data.service.name}" updated successfully.`);
            await loadServices(true);
          }
        } catch (err) {
          if (errorBanner) {
            errorBanner.textContent = err.message || "Failed to update service.";
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

  async function loadServices(isRefresh = false) {
    const tableBody = document.getElementById("services-table-body");
    const emptyState = document.getElementById("services-empty");
    const countBadge = document.getElementById("services-count-badge");
    const errorBanner = document.getElementById("services-error-banner");
    const refreshBtn = document.getElementById("refresh-services-btn");

    if (errorBanner) errorBanner.style.display = "none";
    if (emptyState) emptyState.style.display = "none";

    const status = document.getElementById("filter-status")?.value || "active";
    const trackingType = document.getElementById("filter-type")?.value || "";
    const category = document.getElementById("filter-category")?.value.trim() || "";

    const params = { status };
    if (trackingType) params.trackingType = trackingType;
    if (category) params.category = category;

    // Loading State
    if (tableBody) {
      while (tableBody.firstChild) {
        tableBody.removeChild(tableBody.firstChild);
      }
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

      if (tableBody) {
        while (tableBody.firstChild) {
          tableBody.removeChild(tableBody.firstChild);
        }
      }

      if (services.length === 0) {
        if (emptyState) emptyState.style.display = "block";
        return;
      }

      if (emptyState) emptyState.style.display = "none";
      renderServicesTable(services);
    } catch (err) {
      if (errorBanner) {
        errorBanner.textContent = `Error loading services: ${err.message || "Failed to fetch services."}`;
        errorBanner.style.display = "block";
      }
      if (tableBody) {
        while (tableBody.firstChild) {
          tableBody.removeChild(tableBody.firstChild);
        }
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

    while (tableBody.firstChild) {
      tableBody.removeChild(tableBody.firstChild);
    }

    const canManage = currentWorkspaceRole === "owner" || currentWorkspaceRole === "admin";

    services.forEach((svc) => {
      const tr = document.createElement("tr");

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

      if (svc.trackingType === "metered") {
        priceSpan.textContent = `${svc.currency} ${svc.unitPrice} / ${svc.unit || "unit"}`;
      } else if (svc.trackingType === "subscription") {
        priceSpan.textContent = `${svc.currency} ${svc.subscriptionAmount} / ${svc.billingInterval || "cycle"}`;
      } else if (svc.trackingType === "hybrid") {
        priceSpan.textContent = `${svc.currency} ${svc.subscriptionAmount} / ${svc.billingInterval || "cycle"} + ${svc.currency} ${svc.unitPrice} / ${svc.unit || "unit"}`;
      } else {
        priceSpan.textContent = "--";
      }
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

      // 9. Actions (Edit & Archive foundation)
      const actionsTd = document.createElement("td");
      actionsTd.style.textAlign = "right";
      actionsTd.style.whiteSpace = "nowrap";

      const editBtn = document.createElement("button");
      editBtn.className = "btn btn-secondary btn-sm action-edit-btn";
      editBtn.setAttribute("data-id", svc.id);
      editBtn.style.marginRight = "4px";
      editBtn.textContent = "Edit";
      if (!canManage) {
        editBtn.disabled = true;
        editBtn.title = "Requires Admin or Owner role in this workspace";
      }
      editBtn.addEventListener("click", () => openEditModal(svc.id));
      actionsTd.appendChild(editBtn);

      if (svc.status === "active") {
        const archiveBtn = document.createElement("button");
        archiveBtn.className = "btn btn-secondary btn-sm action-archive-btn";
        archiveBtn.setAttribute("data-id", svc.id);
        archiveBtn.style.color = "var(--color-danger)";
        archiveBtn.textContent = "Archive";
        if (!canManage) {
          archiveBtn.disabled = true;
          archiveBtn.title = "Requires Admin or Owner role in this workspace";
        }
        archiveBtn.addEventListener("click", () => archiveServiceAction(svc.id, svc.name));
        actionsTd.appendChild(archiveBtn);
      }
      tr.appendChild(actionsTd);

      tableBody.appendChild(tr);
    });
  }

  function openEditModal(serviceId) {
    const service = cachedServices.find((s) => s.id === serviceId);
    if (!service) return;

    const modal = document.getElementById("edit-modal");
    const editId = document.getElementById("edit-id");
    const editName = document.getElementById("edit-name");
    const editProvider = document.getElementById("edit-provider");
    const editCategory = document.getElementById("edit-category");
    const editCurrency = document.getElementById("edit-currency");
    const editStatus = document.getElementById("edit-status");

    const meteredFields = document.getElementById("edit-metered-fields");
    const subFields = document.getElementById("edit-subscription-fields");
    const unitInput = document.getElementById("edit-unit");
    const unitPriceInput = document.getElementById("edit-unit-price");
    const subAmountInput = document.getElementById("edit-sub-amount");
    const intervalSelect = document.getElementById("edit-interval");

    if (editId) editId.value = service.id;
    if (editName) editName.value = service.name || "";
    if (editProvider) editProvider.value = service.provider || "";
    if (editCategory) editCategory.value = service.category || "";
    if (editCurrency) editCurrency.value = service.currency || "USD";
    if (editStatus) editStatus.value = service.status || "active";

    if (service.trackingType === "metered" || service.trackingType === "hybrid") {
      if (meteredFields) meteredFields.style.display = "grid";
      if (unitInput) unitInput.value = service.unit || "";
      if (unitPriceInput) unitPriceInput.value = service.unitPrice || "";
    } else {
      if (meteredFields) meteredFields.style.display = "none";
    }

    if (service.trackingType === "subscription" || service.trackingType === "hybrid") {
      if (subFields) subFields.style.display = "grid";
      if (subAmountInput) subAmountInput.value = service.subscriptionAmount || "";
      if (intervalSelect) intervalSelect.value = service.billingInterval || "monthly";
    } else {
      if (subFields) subFields.style.display = "none";
    }

    if (modal) modal.classList.add("open");
  }

  async function archiveServiceAction(serviceId, serviceName) {
    if (currentWorkspaceRole !== "owner" && currentWorkspaceRole !== "admin") {
      alert("Only workspace owners and administrators can archive services.");
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to archive "${serviceName}"?\n\nArchived services will no longer accept new usage events and will not be charged recurring subscriptions in future billing cycles.`
    );

    if (!confirmed) return;

    try {
      const res = await api.delete(`/api/services/${serviceId}`);
      if (res.success) {
        showSuccessBanner(`Service "${serviceName}" has been archived.`);
        await loadServices(true);
      }
    } catch (err) {
      alert(`Failed to archive service: ${err.message || "Unknown error"}`);
    }
  }

  function showSuccessBanner(message) {
    const banner = document.getElementById("services-success-banner");
    if (!banner) return;
    banner.textContent = message;
    banner.style.display = "block";
    setTimeout(() => {
      banner.style.display = "none";
    }, 5000);
  }
})(window);
