/**
 * MeterFlow Team & Member Management Screen Controller
 * Handles workspace members roster, adding members, removals, and RBAC permissions.
 * Strictly safe DOM manipulation with zero innerHTML and full keyboard a11y.
 */

(function (window) {
  "use strict";

  const api = window.MeterFlowAPI;
  const auth = window.MeterFlowAuth;

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Pure validation & helper functions exposed for VM testing
  function validateWorkspaceForm(formData) {
    const name = (formData?.name || "").trim();
    const type = (formData?.type || "organization").trim().toLowerCase();

    if (!name) {
      return { valid: false, error: "Workspace name is required.", fieldId: "create-workspace-name" };
    }
    if (name.length < 2 || name.length > 100) {
      return {
        valid: false,
        error: "Workspace name must be between 2 and 100 characters.",
        fieldId: "create-workspace-name"
      };
    }
    if (!["personal", "organization"].includes(type)) {
      return {
        valid: false,
        error: "Workspace type must be either 'personal' or 'organization'.",
        fieldId: "create-workspace-type"
      };
    }
    return { valid: true, error: null, data: { name, type } };
  }

  function validateInviteMemberForm(formData) {
    const email = (formData?.email || "").trim().toLowerCase();
    const role = (formData?.role || "member").trim().toLowerCase();

    if (!email) {
      return { valid: false, error: "Member email is required.", fieldId: "invite-member-email" };
    }
    if (!EMAIL_REGEX.test(email)) {
      return { valid: false, error: "Please enter a valid email address.", fieldId: "invite-member-email" };
    }
    if (!["admin", "member"].includes(role)) {
      return { valid: false, error: "Role must be 'admin' or 'member'.", fieldId: "invite-member-role" };
    }
    return { valid: true, error: null, data: { email, role } };
  }

  function canManageTeam(role) {
    return role === "owner" || role === "admin";
  }

  function canRemoveMember(currentUserRole, targetMemberRole, isWorkspaceOwner = false) {
    if (isWorkspaceOwner || targetMemberRole === "owner") {
      return false; // Cannot remove workspace owner
    }
    if (currentUserRole === "owner") {
      return true; // Owner can remove admins and members
    }
    if (currentUserRole === "admin") {
      return targetMemberRole === "member"; // Admin can remove members, but not other admins
    }
    return false; // Regular members cannot remove anyone
  }

  function formatMemberRole(role) {
    const normalized = (role || "member").toLowerCase();
    switch (normalized) {
      case "owner":
        return { label: "Owner", className: "badge badge-primary" };
      case "admin":
        return { label: "Admin", className: "badge badge-info" };
      case "member":
      default:
        return { label: "Member", className: "badge badge-neutral" };
    }
  }

  function getInitials(name) {
    if (!name || typeof name !== "string") return "U";
    return name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "U";
  }

  function formatDate(dateVal) {
    if (!dateVal) return "—";
    try {
      const d = new Date(dateVal);
      if (Number.isNaN(d.getTime())) return "—";
      return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric"
      });
    } catch {
      return "—";
    }
  }

  // Controller State
  let currentWorkspaceId = null;
  let currentWorkspaceRole = "member";
  let currentWorkspaceType = "organization";
  let membersList = [];
  let pendingRemoveMember = null;

  function clearElement(element) {
    if (!element) return;
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  function showPageErrorBanner(message) {
    const banner = document.getElementById("page-error-banner");
    if (!banner) return;
    banner.textContent = message;
    banner.style.display = "flex";
  }

  function hidePageErrorBanner() {
    const banner = document.getElementById("page-error-banner");
    if (!banner) return;
    banner.textContent = "";
    banner.style.display = "none";
  }

  function showPageSuccessBanner(message) {
    const banner = document.getElementById("page-success-banner");
    if (!banner) return;
    banner.textContent = message;
    banner.style.display = "flex";
    setTimeout(() => {
      if (banner.textContent === message) {
        banner.textContent = "";
        banner.style.display = "none";
      }
    }, 5000);
  }

  function openModal(modalId, focusEl) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    if (focusEl) {
      setTimeout(() => focusEl.focus(), 50);
    }
  }

  function closeModal(modalId, returnFocusEl) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    if (returnFocusEl) {
      returnFocusEl.focus();
    }
  }

  function setupUserProfile() {
    const apiClient = window.MeterFlowAPI || api;
    const authClient = window.MeterFlowAuth || auth;
    const user = apiClient ? apiClient.getUser() : null;
    const logoutBtn = document.getElementById("logout-btn");
    const userNameEl = document.getElementById("header-user-name");
    const userRoleEl = document.getElementById("header-user-role");
    const userAvatarEl = document.getElementById("header-user-avatar");

    if (user) {
      if (userNameEl) userNameEl.textContent = user.name || "User";
      if (userRoleEl) userRoleEl.textContent = user.email || "";
      if (userAvatarEl && user.name) {
        userAvatarEl.textContent = getInitials(user.name);
      }
    }

    if (logoutBtn && !logoutBtn.dataset.hasListener) {
      logoutBtn.dataset.hasListener = "true";
      logoutBtn.addEventListener("click", (e) => {
        e.preventDefault();
        if (authClient) authClient.logout();
      });
    }
  }

  function setupMobileMenu() {
    const mobileBtn = document.getElementById("mobile-menu-btn");
    const sidebar = document.getElementById("sidebar");
    if (mobileBtn && sidebar && !mobileBtn.dataset.hasListener) {
      mobileBtn.dataset.hasListener = "true";
      mobileBtn.addEventListener("click", () => {
        sidebar.classList.toggle("open");
        mobileBtn.setAttribute("aria-expanded", String(sidebar.classList.contains("open")));
      });
      document.addEventListener("click", (e) => {
        if (sidebar.classList.contains("open") && !sidebar.contains(e.target) && !mobileBtn.contains(e.target)) {
          sidebar.classList.remove("open");
          mobileBtn.setAttribute("aria-expanded", "false");
        }
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && sidebar.classList.contains("open")) {
          sidebar.classList.remove("open");
          mobileBtn.setAttribute("aria-expanded", "false");
          mobileBtn.focus();
        }
      });
    }
  }

  function applyRolePermissions(role, type) {
    const inviteBtn = document.getElementById("open-invite-modal-btn");
    const personalBanner = document.getElementById("personal-workspace-banner");
    const metricRole = document.getElementById("metric-user-role");
    const metricType = document.getElementById("metric-workspace-type");

    if (metricRole) {
      metricRole.textContent = role || "Member";
    }
    if (metricType) {
      metricType.textContent = type || "Organization";
    }

    const isPersonal = type === "personal";
    if (personalBanner) {
      personalBanner.style.display = isPersonal ? "flex" : "none";
    }

    if (inviteBtn) {
      if (isPersonal) {
        inviteBtn.disabled = true;
        inviteBtn.title = "Personal workspaces cannot have team members";
        inviteBtn.setAttribute("aria-disabled", "true");
      } else if (!canManageTeam(role)) {
        inviteBtn.disabled = true;
        inviteBtn.title = "Only workspace owners and admins can add members";
        inviteBtn.setAttribute("aria-disabled", "true");
      } else {
        inviteBtn.disabled = false;
        inviteBtn.title = "Add an existing user to this workspace";
        inviteBtn.removeAttribute("aria-disabled");
      }
    }
  }

  async function loadWorkspaces() {
    const apiClient = window.MeterFlowAPI || api;
    const selectEl = document.getElementById("workspace-select");
    const roleBadgeEl = document.getElementById("workspace-role-badge");
    if (!selectEl) return;

    try {
      const res = await apiClient.get("/api/workspaces");
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
            currentWorkspaceType = ws.type || "organization";
          }
          selectEl.appendChild(opt);
        });

        if (roleBadgeEl) {
          roleBadgeEl.textContent = currentWorkspaceRole;
          roleBadgeEl.className = `badge badge-${currentWorkspaceRole === "owner" ? "primary" : currentWorkspaceRole === "admin" ? "info" : "neutral"}`;
        }

        applyRolePermissions(currentWorkspaceRole, currentWorkspaceType);
      }
    } catch (err) {
      showPageErrorBanner(`Failed to load workspaces: ${err.message || "Unknown error"}`);
    }

    if (!selectEl.dataset.hasChangeListener) {
      selectEl.dataset.hasChangeListener = "true";
      selectEl.addEventListener("change", async (e) => {
        const targetWorkspaceId = e.target.value;
        if (!targetWorkspaceId || targetWorkspaceId === currentWorkspaceId) return;

        hidePageErrorBanner();
        selectEl.disabled = true;

        try {
          const switchRes = await apiClient.post("/api/workspaces/switch", {
            workspaceId: targetWorkspaceId
          });

          if (switchRes.success && switchRes.data) {
            apiClient.setToken(switchRes.data.token);
            apiClient.setTenant(switchRes.data.workspace);

            currentWorkspaceId = switchRes.data.workspace.id;
            currentWorkspaceRole = switchRes.data.workspace.role || "member";
            currentWorkspaceType = switchRes.data.workspace.type || "organization";

            if (roleBadgeEl) {
              roleBadgeEl.textContent = currentWorkspaceRole;
              roleBadgeEl.className = `badge badge-${currentWorkspaceRole === "owner" ? "primary" : currentWorkspaceRole === "admin" ? "info" : "neutral"}`;
            }

            applyRolePermissions(currentWorkspaceRole, currentWorkspaceType);

            // Close open modals
            closeModal("invite-member-modal");
            closeModal("remove-member-modal");
            closeModal("create-workspace-modal");

            // Clear table and reload members
            const tbody = document.getElementById("team-table-body");
            clearElement(tbody);
            membersList = [];

            await loadMembers();
          }
        } catch (switchErr) {
          selectEl.value = currentWorkspaceId;
          showPageErrorBanner(`Failed to switch workspace: ${switchErr.message || "Unknown error"}`);
        } finally {
          selectEl.disabled = false;
        }
      });
    }
  }

  function renderMembersTable(members) {
    const tbody = document.getElementById("team-table-body");
    const emptyState = document.getElementById("team-empty-state");
    const totalMetric = document.getElementById("metric-total-members");
    const countBadge = document.getElementById("members-count-badge");

    if (!tbody) return;
    clearElement(tbody);

    const count = Array.isArray(members) ? members.length : 0;
    if (totalMetric) totalMetric.textContent = String(count);
    if (countBadge) countBadge.textContent = `${count} ${count === 1 ? "member" : "members"}`;

    if (!Array.isArray(members) || members.length === 0) {
      if (emptyState) emptyState.style.display = "block";
      return;
    }

    if (emptyState) emptyState.style.display = "none";

    members.forEach((member) => {
      const tr = document.createElement("tr");

      // Column 1: Member (Avatar + Name)
      const tdMember = document.createElement("td");
      const cellWrapper = document.createElement("div");
      cellWrapper.className = "team-member-cell";

      const avatar = document.createElement("div");
      avatar.className = "user-avatar";
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = getInitials(member.name);

      const details = document.createElement("div");
      details.className = "team-member-details";

      const nameEl = document.createElement("span");
      nameEl.className = "team-member-name";
      nameEl.textContent = member.name || "Unknown User";

      details.appendChild(nameEl);
      cellWrapper.appendChild(avatar);
      cellWrapper.appendChild(details);
      tdMember.appendChild(cellWrapper);

      // Column 2: Email
      const tdEmail = document.createElement("td");
      tdEmail.textContent = member.email || "—";

      // Column 3: Role Badge
      const tdRole = document.createElement("td");
      const roleInfo = formatMemberRole(member.role);
      const roleBadge = document.createElement("span");
      roleBadge.className = roleInfo.className;
      roleBadge.textContent = roleInfo.label;
      tdRole.appendChild(roleBadge);

      // Column 4: Joined Date
      const tdJoined = document.createElement("td");
      tdJoined.textContent = formatDate(member.joinedAt);

      // Column 5: Actions (Remove Button or Protected Badge)
      const tdActions = document.createElement("td");
      tdActions.style.textAlign = "right";

      const isOwner = member.role === "owner";
      const userCanRemove = canRemoveMember(currentWorkspaceRole, member.role, isOwner);

      if (userCanRemove) {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "btn btn-secondary btn-sm";
        removeBtn.style.color = "var(--color-danger)";
        removeBtn.textContent = "Remove";
        removeBtn.setAttribute("aria-label", `Remove member ${member.name || member.email}`);

        removeBtn.addEventListener("click", () => {
          pendingRemoveMember = member;
          const nameSpan = document.getElementById("remove-member-name");
          const emailSpan = document.getElementById("remove-member-email");
          const errorEl = document.getElementById("remove-member-error");

          if (nameSpan) nameSpan.textContent = member.name || "this user";
          if (emailSpan) emailSpan.textContent = member.email || "";
          if (errorEl) {
            errorEl.textContent = "";
            errorEl.style.display = "none";
          }

          openModal("remove-member-modal", document.getElementById("remove-member-confirm-btn"));
        });

        tdActions.appendChild(removeBtn);
      } else if (isOwner) {
        const ownerTag = document.createElement("span");
        ownerTag.className = "badge badge-primary";
        ownerTag.style.opacity = "0.75";
        ownerTag.textContent = "Owner";
        tdActions.appendChild(ownerTag);
      } else if (member.role === "admin" && currentWorkspaceRole === "admin") {
        const adminTag = document.createElement("span");
        adminTag.className = "badge badge-info";
        adminTag.style.opacity = "0.75";
        adminTag.textContent = "Admin";
        tdActions.appendChild(adminTag);
      } else {
        const dash = document.createElement("span");
        dash.className = "text-muted";
        dash.textContent = "—";
        tdActions.appendChild(dash);
      }

      tr.appendChild(tdMember);
      tr.appendChild(tdEmail);
      tr.appendChild(tdRole);
      tr.appendChild(tdJoined);
      tr.appendChild(tdActions);

      tbody.appendChild(tr);
    });
  }

  async function loadMembers() {
    const apiClient = window.MeterFlowAPI || api;
    if (!currentWorkspaceId) return;

    hidePageErrorBanner();
    try {
      const res = await apiClient.get(`/api/workspaces/${currentWorkspaceId}/members`);
      if (res.success && res.data && Array.isArray(res.data.members)) {
        membersList = res.data.members;
        renderMembersTable(membersList);
      } else {
        throw new Error(res.message || "Failed to load members");
      }
    } catch (err) {
      showPageErrorBanner(`Could not load team members: ${err.message || "Unknown error"}`);
    }
  }

  function setupModals() {
    // 1. Generic Modal Dismissers
    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      if (!btn.dataset.hasCloseListener) {
        btn.dataset.hasCloseListener = "true";
        btn.addEventListener("click", () => {
          const modalId = btn.getAttribute("data-close-modal");
          closeModal(modalId);
        });
      }
    });

    // 2. Open Invite Modal
    const openInviteBtn = document.getElementById("open-invite-modal-btn");
    const inviteModal = document.getElementById("invite-member-modal");
    const inviteForm = document.getElementById("invite-member-form");
    const inviteError = document.getElementById("invite-member-error");
    const inviteEmailInput = document.getElementById("invite-member-email");
    const inviteRoleSelect = document.getElementById("invite-member-role");
    const inviteSubmitBtn = document.getElementById("invite-member-submit-btn");

    if (openInviteBtn && !openInviteBtn.dataset.hasOpenListener) {
      openInviteBtn.dataset.hasOpenListener = "true";
      openInviteBtn.addEventListener("click", () => {
        if (openInviteBtn.disabled) return;
        if (inviteError) {
          inviteError.textContent = "";
          inviteError.style.display = "none";
        }
        if (inviteForm) inviteForm.reset();
        if (inviteRoleSelect) inviteRoleSelect.value = "member";
        openModal("invite-member-modal", inviteEmailInput);
      });
    }

    // 3. Handle Invite Form Submission
    if (inviteForm && !inviteForm.dataset.hasSubmitListener) {
      inviteForm.dataset.hasSubmitListener = "true";
      inviteForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (inviteError) {
          inviteError.textContent = "";
          inviteError.style.display = "none";
        }

        const email = inviteEmailInput ? inviteEmailInput.value.trim() : "";
        const role = inviteRoleSelect ? inviteRoleSelect.value : "member";

        const validation = validateInviteMemberForm({ email, role });
        if (!validation.valid) {
          if (inviteError) {
            inviteError.textContent = validation.error;
            inviteError.style.display = "flex";
          }
          return;
        }

        if (inviteSubmitBtn) {
          inviteSubmitBtn.disabled = true;
          inviteSubmitBtn.textContent = "";
          const spinner = document.createElement("span");
          spinner.className = "btn-spinner";
          inviteSubmitBtn.appendChild(spinner);
          inviteSubmitBtn.appendChild(document.createTextNode(" Adding..."));
        }

        try {
          const apiClient = window.MeterFlowAPI || api;
          const res = await apiClient.post(`/api/workspaces/${currentWorkspaceId}/members`, {
            email,
            role
          });

          if (!res.success) {
            throw new Error(res.message || "Failed to add member");
          }

          closeModal("invite-member-modal", openInviteBtn);
          showPageSuccessBanner(`Successfully added ${email} as ${role}.`);
          await loadMembers();
        } catch (err) {
          if (inviteError) {
            inviteError.textContent = err.message || "Failed to add member";
            inviteError.style.display = "flex";
          }
        } finally {
          if (inviteSubmitBtn) {
            inviteSubmitBtn.disabled = false;
            inviteSubmitBtn.textContent = "Add Member";
          }
        }
      });
    }

    // 4. Handle Remove Member Confirm
    const removeConfirmBtn = document.getElementById("remove-member-confirm-btn");
    const removeError = document.getElementById("remove-member-error");

    if (removeConfirmBtn && !removeConfirmBtn.dataset.hasConfirmListener) {
      removeConfirmBtn.dataset.hasConfirmListener = "true";
      removeConfirmBtn.addEventListener("click", async () => {
        if (!pendingRemoveMember || !currentWorkspaceId) return;

        if (removeError) {
          removeError.textContent = "";
          removeError.style.display = "none";
        }

        removeConfirmBtn.disabled = true;
        removeConfirmBtn.textContent = "";
        const spinner = document.createElement("span");
        spinner.className = "btn-spinner";
        removeConfirmBtn.appendChild(spinner);
        removeConfirmBtn.appendChild(document.createTextNode(" Removing..."));

        try {
          const apiClient = window.MeterFlowAPI || api;
          const res = await apiClient.delete(
            `/api/workspaces/${currentWorkspaceId}/members/${pendingRemoveMember.userId}`
          );

          if (!res.success) {
            throw new Error(res.message || "Failed to remove member");
          }

          const removedName = pendingRemoveMember.name || pendingRemoveMember.email;
          closeModal("remove-member-modal");
          pendingRemoveMember = null;
          showPageSuccessBanner(`Successfully removed ${removedName} from this workspace.`);
          await loadMembers();
        } catch (err) {
          if (removeError) {
            removeError.textContent = err.message || "Failed to remove member";
            removeError.style.display = "flex";
          }
        } finally {
          removeConfirmBtn.disabled = false;
          removeConfirmBtn.textContent = "Remove Member";
        }
      });
    }

    // 5. Refresh Team Button
    const refreshBtn = document.getElementById("refresh-team-btn");
    if (refreshBtn && !refreshBtn.dataset.hasRefreshListener) {
      refreshBtn.dataset.hasRefreshListener = "true";
      refreshBtn.addEventListener("click", async () => {
        refreshBtn.disabled = true;
        await loadMembers();
        refreshBtn.disabled = false;
      });
    }
  }

  async function initTeamPage() {
    const authClient = window.MeterFlowAuth || auth;
    if (authClient && !authClient.requireAuth()) {
      return;
    }

    setupUserProfile();
    setupMobileMenu();
    setupModals();

    // Wire up workspace creation modal callback
    if (authClient && typeof authClient.setWorkspaceCreatedCallback === "function") {
      authClient.setWorkspaceCreatedCallback(async () => {
        await loadWorkspaces();
        await loadMembers();
      });
    }

    await loadWorkspaces();
    await loadMembers();
  }

  // Export module helpers to window for isolated VM testing & controller execution
  window.MeterFlowTeam = {
    validateWorkspaceForm,
    validateInviteMemberForm,
    canManageTeam,
    canRemoveMember,
    formatMemberRole,
    getInitials,
    formatDate,
    initTeamPage,
    renderMembersTable
  };

  // Auto-initialize when loaded on team.html
  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", () => {
      if (document.getElementById("team-table")) {
        initTeamPage();
      }
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
