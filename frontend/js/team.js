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

  function canModifyMemberRole(currentUserRole, targetMemberRole) {
    if (currentUserRole !== "owner") {
      return false; // Only owners can modify member roles
    }
    if (targetMemberRole === "owner") {
      return false; // Owner role cannot be modified or demoted
    }
    return targetMemberRole === "admin" || targetMemberRole === "member";
  }

  function validateModifyRole(role) {
    if (role === undefined || role === null || typeof role !== "string") {
      return { valid: false, error: "Role is required and must be a string." };
    }
    const normalized = role.trim().toLowerCase();
    if (normalized === "owner") {
      return { valid: false, error: "Cannot assign owner role through role modification." };
    }
    if (!["admin", "member"].includes(normalized)) {
      return { valid: false, error: "Role must be 'admin' or 'member'." };
    }
    return { valid: true, error: null, role: normalized };
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

  function formatMemberStatus(status) {
    const normalized = (status || "active").toLowerCase();
    if (normalized === "suspended") {
      return { label: "Suspended", className: "badge badge-warning" };
    }
    return { label: "Active", className: "badge badge-success" };
  }

  function canModifyMemberStatus(currentUserRole, targetMemberRole, isSelf = false) {
    if (isSelf) {
      return false; // Users cannot suspend or modify their own status
    }
    if (targetMemberRole === "owner") {
      return false; // Workspace owner can never be suspended or modified
    }
    if (currentUserRole === "owner") {
      return true; // Owner can suspend/reactivate admins and members
    }
    if (currentUserRole === "admin") {
      return targetMemberRole === "member"; // Admin can suspend/reactivate members, but not other admins
    }
    return false; // Regular members cannot suspend anyone
  }

  function validateModifyStatus(status) {
    if (status === undefined || status === null || typeof status !== "string") {
      return { valid: false, error: "Status is required and must be a string." };
    }
    const normalized = status.trim().toLowerCase();
    if (!["active", "suspended"].includes(normalized)) {
      return { valid: false, error: "Status must be 'active' or 'suspended'." };
    }
    return { valid: true, error: null, status: normalized };
  }

  function canLeaveWorkspace(role) {
    if (!role || typeof role !== "string") return false;
    const normalized = role.trim().toLowerCase();
    return normalized !== "owner";
  }

  function canArchiveWorkspace(role) {
    if (!role || typeof role !== "string") return false;
    const normalized = role.trim().toLowerCase();
    return normalized === "owner";
  }

  function canTransferOwnership(role) {
    if (!role || typeof role !== "string") return false;
    return role.trim().toLowerCase() === "owner";
  }

  function canManageInvitations(role) {
    if (!role || typeof role !== "string") return false;
    const normalized = role.trim().toLowerCase();
    return normalized === "owner" || normalized === "admin";
  }

  function isMemberEligibleForOwnershipTransfer(member, currentUserId) {
    if (!member) return false;
    const targetId = member.userId || member._id || member.id;
    if (!targetId) return false;
    if (currentUserId && String(targetId) === String(currentUserId)) return false;
    if (member.role === "owner") return false;
    if (member.status !== "active") return false;
    return true;
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
  let invitationsList = [];
  let pendingCancelInvitation = null;

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
        inviteBtn.title = "Only workspace owners and admins can invite members";
        inviteBtn.setAttribute("aria-disabled", "true");
      } else {
        inviteBtn.disabled = false;
        inviteBtn.title = "Invite a new member to this workspace";
        inviteBtn.removeAttribute("aria-disabled");
      }
    }

    const invitationsCard = document.getElementById("pending-invitations-card");
    if (invitationsCard) {
      if (canManageInvitations(role) && !isPersonal) {
        invitationsCard.style.display = "block";
      } else {
        invitationsCard.style.display = "none";
      }
    }

    const transferBtn = document.getElementById("open-transfer-ownership-btn");
    if (transferBtn) {
      if (canTransferOwnership(role) && !isPersonal) {
        transferBtn.style.display = "inline-flex";
      } else {
        transferBtn.style.display = "none";
      }
    }

    const leaveBtn = document.getElementById("open-leave-workspace-btn");
    if (leaveBtn) {
      if (canLeaveWorkspace(role)) {
        leaveBtn.style.display = "inline-flex";
      } else {
        leaveBtn.style.display = "none";
      }
    }

    const archiveBtn = document.getElementById("open-archive-workspace-btn");
    if (archiveBtn) {
      if (canArchiveWorkspace(role)) {
        archiveBtn.style.display = "inline-flex";
      } else {
        archiveBtn.style.display = "none";
      }
    }

    if (window.MeterFlowAuth && typeof window.MeterFlowAuth.updateWorkspaceRoleUI === "function") {
      window.MeterFlowAuth.updateWorkspaceRoleUI(role);
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

            await Promise.all([loadMembers(), loadInvitations()]);
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

    const apiClient = window.MeterFlowAPI || api;
    const currentUser = apiClient && typeof apiClient.getUser === "function" ? apiClient.getUser() : null;
    const currentUserId = currentUser ? String(currentUser.id || currentUser.userId || "") : "";

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
      const memberUserIdStr = member.userId ? String(member.userId) : "";
      const isSelf = Boolean(currentUserId && memberUserIdStr && currentUserId === memberUserIdStr);

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

      // Column 3: Role (Badge + Accessible Role Select for Owners)
      const tdRole = document.createElement("td");
      const roleInfo = formatMemberRole(member.role);
      const roleBadge = document.createElement("span");
      roleBadge.className = roleInfo.className;
      roleBadge.textContent = roleInfo.label;
      roleBadge.setAttribute("data-member-role-badge", memberUserIdStr);

      if (canModifyMemberRole(currentWorkspaceRole, member.role)) {
        const roleWrapper = document.createElement("div");
        roleWrapper.className = "role-control-wrapper";

        const roleSelect = document.createElement("select");
        roleSelect.className = "form-select role-select";
        roleSelect.setAttribute("aria-label", `Change role for ${member.name || member.email}`);
        roleSelect.setAttribute("data-member-user-id", memberUserIdStr);

        const optMember = document.createElement("option");
        optMember.value = "member";
        optMember.textContent = "Member";
        if (member.role === "member") optMember.selected = true;

        const optAdmin = document.createElement("option");
        optAdmin.value = "admin";
        optAdmin.textContent = "Admin";
        if (member.role === "admin") optAdmin.selected = true;

        roleSelect.appendChild(optMember);
        roleSelect.appendChild(optAdmin);

        roleSelect.addEventListener("change", async (e) => {
          const newRole = e.target.value;
          if (!newRole || newRole === member.role) return;

          hidePageErrorBanner();
          roleSelect.disabled = true;

          try {
            const res = await apiClient.patch(
              `/api/workspaces/${currentWorkspaceId}/members/${member.userId}/role`,
              { role: newRole }
            );

            if (!res.success) {
              throw new Error(res.message || "Failed to update member role");
            }

            member.role = newRole;
            const updatedInfo = formatMemberRole(newRole);
            roleBadge.className = updatedInfo.className;
            roleBadge.textContent = updatedInfo.label;

            // Re-render table to refresh contextual action permissions
            renderMembersTable(membersList);

            showPageSuccessBanner(
              `Successfully updated ${member.name || member.email}'s role to ${updatedInfo.label}.`
            );
          } catch (err) {
            roleSelect.value = member.role;
            showPageErrorBanner(`Failed to update member role: ${err.message || "Unknown error"}`);
          } finally {
            roleSelect.disabled = false;
          }
        });

        roleWrapper.appendChild(roleBadge);
        roleWrapper.appendChild(roleSelect);
        tdRole.appendChild(roleWrapper);
      } else {
        tdRole.appendChild(roleBadge);
      }

      // Column 4: Status (Active / Suspended)
      const tdStatus = document.createElement("td");
      const statusInfo = formatMemberStatus(member.status);
      const statusBadge = document.createElement("span");
      statusBadge.className = statusInfo.className;
      statusBadge.textContent = statusInfo.label;
      statusBadge.setAttribute("data-member-status-badge", memberUserIdStr);
      tdStatus.appendChild(statusBadge);

      // Column 5: Joined Date
      const tdJoined = document.createElement("td");
      tdJoined.textContent = formatDate(member.joinedAt);

      // Column 6: Actions (Suspend/Reactivate + Remove Button or Protected Badge)
      const tdActions = document.createElement("td");
      tdActions.style.textAlign = "right";

      const actionsWrapper = document.createElement("div");
      actionsWrapper.style.display = "inline-flex";
      actionsWrapper.style.alignItems = "center";
      actionsWrapper.style.gap = "var(--space-xs)";
      actionsWrapper.style.justifyContent = "flex-end";

      const isOwner = member.role === "owner";
      const userCanRemove = canRemoveMember(currentWorkspaceRole, member.role, isOwner);
      const userCanChangeStatus = canModifyMemberStatus(currentWorkspaceRole, member.role, isSelf);

      if (userCanChangeStatus) {
        const isSuspended = member.status === "suspended";
        const statusBtn = document.createElement("button");
        statusBtn.type = "button";
        statusBtn.className = "btn btn-secondary btn-sm status-toggle-btn";
        statusBtn.setAttribute("data-member-user-id", memberUserIdStr);
        statusBtn.setAttribute("data-action", isSuspended ? "reactivate" : "suspend");
        statusBtn.textContent = isSuspended ? "Reactivate" : "Suspend";
        statusBtn.setAttribute(
          "aria-label",
          isSuspended
            ? `Reactivate member ${member.name || member.email}`
            : `Suspend member ${member.name || member.email}`
        );

        statusBtn.addEventListener("click", async () => {
          const nextStatus = member.status === "suspended" ? "active" : "suspended";
          statusBtn.disabled = true;
          hidePageErrorBanner();

          try {
            const res = await apiClient.patch(
              `/api/workspaces/${currentWorkspaceId}/members/${member.userId}/status`,
              { status: nextStatus }
            );

            if (!res.success) {
              throw new Error(res.message || "Failed to update member status");
            }

            member.status = nextStatus;
            renderMembersTable(membersList);

            if (nextStatus === "suspended") {
              showPageSuccessBanner(
                `Successfully suspended ${member.name || member.email}. Member access is paused, and historical billing/usage records remain intact.`
              );
            } else {
              showPageSuccessBanner(
                `Successfully reactivated ${member.name || member.email}. Workspace access has been restored.`
              );
            }
          } catch (err) {
            showPageErrorBanner(`Failed to update member status: ${err.message || "Unknown error"}`);
            statusBtn.disabled = false;
          }
        });

        actionsWrapper.appendChild(statusBtn);
      }

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

        actionsWrapper.appendChild(removeBtn);
      }

      // Transfer Ownership action: Allow owner to initiate ownership transfer to an active non-owner member
      if (canTransferOwnership(currentWorkspaceRole) && isMemberEligibleForOwnershipTransfer(member, currentUserId)) {
        const transferOwnerBtn = document.createElement("button");
        transferOwnerBtn.type = "button";
        transferOwnerBtn.className = "btn btn-secondary btn-sm action-transfer-owner";
        transferOwnerBtn.textContent = "Make Owner";
        transferOwnerBtn.setAttribute("aria-label", `Transfer workspace ownership to ${member.name || member.email}`);
        transferOwnerBtn.addEventListener("click", () => {
          openTransferOwnershipModal(member.userId);
        });
        actionsWrapper.appendChild(transferOwnerBtn);
      }

      // Self-leave action: Allow non-owner to initiate voluntary self-leave from their row
      if (isSelf && canLeaveWorkspace(currentWorkspaceRole)) {
        const leaveRowBtn = document.createElement("button");
        leaveRowBtn.type = "button";
        leaveRowBtn.className = "btn btn-secondary btn-sm leave-row-btn";
        leaveRowBtn.style.color = "var(--color-danger)";
        leaveRowBtn.style.borderColor = "var(--color-danger)";
        leaveRowBtn.textContent = "Leave";
        leaveRowBtn.setAttribute("aria-label", "Leave this workspace");

        leaveRowBtn.addEventListener("click", () => {
          const leaveError = document.getElementById("leave-workspace-error");
          if (leaveError) {
            leaveError.textContent = "";
            leaveError.style.display = "none";
          }
          openModal("leave-workspace-modal", document.getElementById("leave-workspace-confirm-btn"));
        });

        actionsWrapper.appendChild(leaveRowBtn);
      }

      if (actionsWrapper.children.length > 0) {
        tdActions.appendChild(actionsWrapper);
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
      tr.appendChild(tdStatus);
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

  async function loadInvitations() {
    const cardEl = document.getElementById("pending-invitations-card");
    if (!currentWorkspaceId) return;

    if (!canManageInvitations(currentWorkspaceRole) || currentWorkspaceType === "personal") {
      if (cardEl) cardEl.style.display = "none";
      return;
    }

    if (cardEl) cardEl.style.display = "block";

    const apiClient = window.MeterFlowAPI || api;
    try {
      const res = await apiClient.get(`/api/workspaces/${currentWorkspaceId}/invitations?status=pending`);
      if (res.success && res.data && Array.isArray(res.data.invitations)) {
        invitationsList = res.data.invitations;
        renderInvitationsTable(invitationsList);
      }
    } catch {
      renderInvitationsTable([]);
    }
  }

  function renderInvitationsTable(invitations) {
    const tbody = document.getElementById("invitations-table-body");
    const emptyState = document.getElementById("invitations-empty-state");
    const countBadge = document.getElementById("invitations-count-badge");

    if (!tbody) return;
    clearElement(tbody);

    const count = Array.isArray(invitations) ? invitations.length : 0;
    if (countBadge) countBadge.textContent = `${count} pending`;

    if (!Array.isArray(invitations) || invitations.length === 0) {
      if (emptyState) emptyState.style.display = "block";
      return;
    }

    if (emptyState) emptyState.style.display = "none";

    invitations.forEach((inv) => {
      const tr = document.createElement("tr");

      // Column 1: Invitee Email
      const tdEmail = document.createElement("td");
      tdEmail.textContent = inv.email || "—";

      // Column 2: Role
      const tdRole = document.createElement("td");
      const roleBadge = document.createElement("span");
      roleBadge.className = inv.role === "admin" ? "badge badge-info" : "badge badge-neutral";
      roleBadge.textContent = (inv.role || "member").toUpperCase();
      tdRole.appendChild(roleBadge);

      // Column 3: Status
      const tdStatus = document.createElement("td");
      const statusBadge = document.createElement("span");
      statusBadge.className = "badge badge-warning";
      statusBadge.textContent = "Pending";
      tdStatus.appendChild(statusBadge);

      // Column 4: Invited By
      const tdInvitedBy = document.createElement("td");
      tdInvitedBy.textContent = inv.invitedBy?.name || inv.invitedBy?.email || "Admin";

      // Column 5: Expires
      const tdExpires = document.createElement("td");
      tdExpires.textContent = formatDate(inv.expiresAt);

      // Column 6: Actions
      const tdActions = document.createElement("td");
      tdActions.style.textAlign = "right";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn btn-secondary btn-sm";
      cancelBtn.style.color = "var(--color-danger)";
      cancelBtn.style.borderColor = "var(--color-danger)";
      cancelBtn.textContent = "Cancel";
      cancelBtn.setAttribute("aria-label", `Cancel invitation for ${inv.email}`);

      cancelBtn.addEventListener("click", () => {
        openCancelInvitationModal(inv);
      });

      tdActions.appendChild(cancelBtn);

      tr.appendChild(tdEmail);
      tr.appendChild(tdRole);
      tr.appendChild(tdStatus);
      tr.appendChild(tdInvitedBy);
      tr.appendChild(tdExpires);
      tr.appendChild(tdActions);

      tbody.appendChild(tr);
    });
  }

  function openCancelInvitationModal(invitation) {
    pendingCancelInvitation = invitation;
    const emailEl = document.getElementById("cancel-invitation-email");
    const errorEl = document.getElementById("cancel-invitation-error");

    if (emailEl) emailEl.textContent = invitation.email || "this email";
    if (errorEl) {
      errorEl.textContent = "";
      errorEl.style.display = "none";
    }

    const confirmBtn = document.getElementById("cancel-invitation-confirm-btn");
    openModal("cancel-invitation-modal", confirmBtn);
  }

  function populateTransferOwnershipDropdown(preselectedUserId = null) {
    const select = document.getElementById("transfer-ownership-target");
    if (!select) return;
    clearElement(select);

    const apiClient = window.MeterFlowAPI || api;
    const currentUser = apiClient && typeof apiClient.getUser === "function" ? apiClient.getUser() : null;
    const currentUserId = currentUser ? String(currentUser.id || currentUser.userId || "") : "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select an active team member...";
    select.appendChild(placeholder);

    const eligibleMembers = (membersList || []).filter((m) =>
      isMemberEligibleForOwnershipTransfer(m, currentUserId)
    );

    eligibleMembers.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.userId;
      const roleCapitalized = (m.role || "member").charAt(0).toUpperCase() + (m.role || "member").slice(1);
      opt.textContent = `${m.name || "Member"} (${m.email || ""}) — ${roleCapitalized}`;
      if (preselectedUserId && String(m.userId) === String(preselectedUserId)) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  }

  function openTransferOwnershipModal(preselectedUserId = null) {
    const errorEl = document.getElementById("transfer-ownership-error");
    if (errorEl) {
      errorEl.textContent = "";
      errorEl.style.display = "none";
    }

    populateTransferOwnershipDropdown(preselectedUserId);
    const targetSelect = document.getElementById("transfer-ownership-target");
    openModal("transfer-ownership-modal", targetSelect);
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
          inviteSubmitBtn.appendChild(document.createTextNode(" Sending..."));
        }

        try {
          const apiClient = window.MeterFlowAPI || api;
          const res = await apiClient.post(`/api/workspaces/${currentWorkspaceId}/invitations`, {
            email,
            role
          });

          if (!res.success) {
            throw new Error(res.message || "Failed to send invitation");
          }

          closeModal("invite-member-modal", openInviteBtn);
          const inviteUrl = res.data?.invitationUrl;
          if (inviteUrl) {
            showPageSuccessBanner(`Successfully created invitation for ${email}. Link: ${window.location.origin}${inviteUrl}`);
          } else {
            showPageSuccessBanner(`Successfully sent invitation to ${email} as ${role}.`);
          }
          await Promise.all([loadMembers(), loadInvitations()]);
        } catch (err) {
          if (inviteError) {
            inviteError.textContent = err.message || "Failed to send invitation";
            inviteError.style.display = "flex";
          }
        } finally {
          if (inviteSubmitBtn) {
            inviteSubmitBtn.disabled = false;
            inviteSubmitBtn.textContent = "Send Invitation";
          }
        }
      });
    }

    // 4. Handle Cancel Invitation Confirm (P3.3)
    const cancelConfirmBtn = document.getElementById("cancel-invitation-confirm-btn");
    const cancelError = document.getElementById("cancel-invitation-error");

    if (cancelConfirmBtn && !cancelConfirmBtn.dataset.hasCancelListener) {
      cancelConfirmBtn.dataset.hasCancelListener = "true";
      cancelConfirmBtn.addEventListener("click", async () => {
        if (!pendingCancelInvitation || !currentWorkspaceId) return;

        if (cancelError) {
          cancelError.textContent = "";
          cancelError.style.display = "none";
        }

        cancelConfirmBtn.disabled = true;
        cancelConfirmBtn.textContent = "Cancelling...";

        try {
          const apiClient = window.MeterFlowAPI || api;
          const res = await apiClient.patch(
            `/api/workspaces/${currentWorkspaceId}/invitations/${pendingCancelInvitation.id}/cancel`
          );

          if (!res.success) {
            throw new Error(res.message || "Failed to cancel invitation");
          }

          const cancelledEmail = pendingCancelInvitation.email;
          closeModal("cancel-invitation-modal");
          pendingCancelInvitation = null;
          showPageSuccessBanner(`Cancelled invitation for ${cancelledEmail}.`);
          await loadInvitations();
        } catch (err) {
          if (cancelError) {
            cancelError.textContent = err.message || "Failed to cancel invitation";
            cancelError.style.display = "flex";
          }
        } finally {
          cancelConfirmBtn.disabled = false;
          cancelConfirmBtn.textContent = "Cancel Invitation";
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

    // 5. Leave Workspace Modal
    const openLeaveBtn = document.getElementById("open-leave-workspace-btn");
    const leaveConfirmBtn = document.getElementById("leave-workspace-confirm-btn");
    const leaveError = document.getElementById("leave-workspace-error");

    if (openLeaveBtn && !openLeaveBtn.dataset.hasOpenListener) {
      openLeaveBtn.dataset.hasOpenListener = "true";
      openLeaveBtn.addEventListener("click", () => {
        if (leaveError) {
          leaveError.textContent = "";
          leaveError.style.display = "none";
        }
        openModal("leave-workspace-modal", leaveConfirmBtn);
      });
    }

    if (leaveConfirmBtn && !leaveConfirmBtn.dataset.hasConfirmListener) {
      leaveConfirmBtn.dataset.hasConfirmListener = "true";
      leaveConfirmBtn.addEventListener("click", async () => {
        if (leaveConfirmBtn.disabled || !currentWorkspaceId) return;

        if (leaveError) {
          leaveError.textContent = "";
          leaveError.style.display = "none";
        }

        leaveConfirmBtn.disabled = true;
        leaveConfirmBtn.textContent = "";
        const spinner = document.createElement("span");
        spinner.className = "btn-spinner";
        leaveConfirmBtn.appendChild(spinner);
        leaveConfirmBtn.appendChild(document.createTextNode(" Leaving..."));

        try {
          const apiClient = window.MeterFlowAPI || api;
          const res = await apiClient.post(`/api/workspaces/${currentWorkspaceId}/leave`);

          if (!res.success) {
            throw new Error(res.message || "Failed to leave workspace");
          }

          if (res.data) {
            if (res.data.token) {
              apiClient.setToken(res.data.token);
            }
            if (res.data.activeWorkspace) {
              apiClient.setTenant(res.data.activeWorkspace);
              const user = apiClient.getUser();
              if (user) {
                user.tenantId = res.data.activeWorkspace.id;
                apiClient.setUser(user);
              }
              currentWorkspaceId = res.data.activeWorkspace.id;
              currentWorkspaceRole = res.data.activeWorkspace.role || "member";
              currentWorkspaceType = res.data.activeWorkspace.type || "organization";
            }
          }

          closeModal("leave-workspace-modal");
          showPageSuccessBanner("You have successfully left the workspace.");

          // Reset table and reload workspaces & members
          const tbody = document.getElementById("team-table-body");
          clearElement(tbody);
          membersList = [];

          await loadWorkspaces();
          await loadMembers();
        } catch (err) {
          if (leaveError) {
            leaveError.textContent = err.message || "Failed to leave workspace";
            leaveError.style.display = "block";
          }
        } finally {
          leaveConfirmBtn.disabled = false;
          leaveConfirmBtn.textContent = "Leave Workspace";
        }
      });
    }

    // 6. Archive Workspace Modal
    const openArchiveBtn = document.getElementById("open-archive-workspace-btn");
    const archiveConfirmBtn = document.getElementById("archive-workspace-confirm-btn");
    const archiveError = document.getElementById("archive-workspace-error");

    if (openArchiveBtn && !openArchiveBtn.dataset.hasOpenListener) {
      openArchiveBtn.dataset.hasOpenListener = "true";
      openArchiveBtn.addEventListener("click", () => {
        if (archiveError) {
          archiveError.textContent = "";
          archiveError.style.display = "none";
        }
        openModal("archive-workspace-modal", archiveConfirmBtn);
      });
    }

    if (archiveConfirmBtn && !archiveConfirmBtn.dataset.hasConfirmListener) {
      archiveConfirmBtn.dataset.hasConfirmListener = "true";
      archiveConfirmBtn.addEventListener("click", async () => {
        if (archiveConfirmBtn.disabled || !currentWorkspaceId) return;

        if (archiveError) {
          archiveError.textContent = "";
          archiveError.style.display = "none";
        }

        archiveConfirmBtn.disabled = true;
        archiveConfirmBtn.textContent = "";
        const spinner = document.createElement("span");
        spinner.className = "btn-spinner";
        archiveConfirmBtn.appendChild(spinner);
        archiveConfirmBtn.appendChild(document.createTextNode(" Archiving..."));

        try {
          const apiClient = window.MeterFlowAPI || api;
          const res = await apiClient.patch(`/api/workspaces/${currentWorkspaceId}/archive`);

          if (!res.success) {
            throw new Error(res.message || "Failed to archive workspace");
          }

          if (res.data) {
            if (res.data.token) {
              apiClient.setToken(res.data.token);
            }
            if (res.data.activeWorkspace) {
              apiClient.setTenant(res.data.activeWorkspace);
              const user = apiClient.getUser();
              if (user) {
                user.tenantId = res.data.activeWorkspace.id;
                apiClient.setUser(user);
              }
              currentWorkspaceId = res.data.activeWorkspace.id;
              currentWorkspaceRole = res.data.activeWorkspace.role || "member";
              currentWorkspaceType = res.data.activeWorkspace.type || "organization";
            }
          }

          closeModal("archive-workspace-modal");
          showPageSuccessBanner("Workspace has been successfully archived.");

          // Reset table and reload workspaces & members
          const tbody = document.getElementById("team-table-body");
          clearElement(tbody);
          membersList = [];

          await loadWorkspaces();
          await loadMembers();
        } catch (err) {
          if (archiveError) {
            archiveError.textContent = err.message || "Failed to archive workspace";
            archiveError.style.display = "block";
          }
        } finally {
          archiveConfirmBtn.disabled = false;
          archiveConfirmBtn.textContent = "Archive Workspace";
        }
      });
    }

    // 7. Transfer Ownership Modal
    const openTransferBtn = document.getElementById("open-transfer-ownership-btn");
    const transferForm = document.getElementById("transfer-ownership-form");
    const transferConfirmBtn = document.getElementById("transfer-ownership-confirm-btn");
    const transferError = document.getElementById("transfer-ownership-error");
    const transferTargetSelect = document.getElementById("transfer-ownership-target");

    if (openTransferBtn && !openTransferBtn.dataset.hasOpenListener) {
      openTransferBtn.dataset.hasOpenListener = "true";
      openTransferBtn.addEventListener("click", () => {
        openTransferOwnershipModal();
      });
    }

    if (transferForm && !transferForm.dataset.hasSubmitListener) {
      transferForm.dataset.hasSubmitListener = "true";
      transferForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (transferConfirmBtn.disabled || !currentWorkspaceId) return;

        if (transferError) {
          transferError.textContent = "";
          transferError.style.display = "none";
        }

        const targetUserId = transferTargetSelect ? transferTargetSelect.value : "";
        if (!targetUserId) {
          if (transferError) {
            transferError.textContent = "Please select an eligible active team member to become the new owner.";
            transferError.style.display = "block";
          }
          return;
        }

        transferConfirmBtn.disabled = true;
        transferConfirmBtn.textContent = "";
        const spinner = document.createElement("span");
        spinner.className = "btn-spinner";
        transferConfirmBtn.appendChild(spinner);
        transferConfirmBtn.appendChild(document.createTextNode(" Transferring..."));

        try {
          const apiClient = window.MeterFlowAPI || api;
          const res = await apiClient.post(`/api/workspaces/${currentWorkspaceId}/transfer-ownership`, {
            memberUserId: targetUserId
          });

          if (!res.success) {
            throw new Error(res.message || "Failed to transfer workspace ownership");
          }

          // Update caller's role to admin in local session
          currentWorkspaceRole = "admin";
          const tenant = apiClient.getTenant();
          if (tenant) {
            tenant.role = "admin";
            apiClient.setTenant(tenant);
          }
          applyRolePermissions("admin", currentWorkspaceType);

          closeModal("transfer-ownership-modal");
          showPageSuccessBanner(
            "Workspace ownership has been successfully transferred. You are now an Admin in this workspace."
          );

          await loadWorkspaces();
          await loadMembers();
        } catch (err) {
          if (transferError) {
            transferError.textContent = err.message || "Failed to transfer workspace ownership";
            transferError.style.display = "block";
          }
        } finally {
          transferConfirmBtn.disabled = false;
          transferConfirmBtn.textContent = "Confirm Transfer";
        }
      });
    }

    // 8. Refresh Team Button
    const refreshBtn = document.getElementById("refresh-team-btn");
    if (refreshBtn && !refreshBtn.dataset.hasRefreshListener) {
      refreshBtn.dataset.hasRefreshListener = "true";
      refreshBtn.addEventListener("click", async () => {
        refreshBtn.disabled = true;
        await Promise.all([loadMembers(), loadInvitations()]);
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
        await Promise.all([loadMembers(), loadInvitations()]);
      });
    }

    await loadWorkspaces();
    await Promise.all([loadMembers(), loadInvitations()]);
  }

  // Export module helpers to window for isolated VM testing & controller execution
  window.MeterFlowTeam = {
    validateWorkspaceForm,
    validateInviteMemberForm,
    validateModifyRole,
    validateModifyStatus,
    canManageTeam,
    canManageInvitations,
    canModifyMemberRole,
    canModifyMemberStatus,
    canRemoveMember,
    canLeaveWorkspace,
    canArchiveWorkspace,
    canTransferOwnership,
    isMemberEligibleForOwnershipTransfer,
    formatMemberRole,
    formatMemberStatus,
    getInitials,
    formatDate,
    initTeamPage,
    renderMembersTable,
    renderInvitationsTable,
    loadInvitations
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
