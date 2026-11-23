/**
 * MeterFlow Workspace Invitation Acceptance Screen Controller
 * Strictly safe DOM manipulation with zero innerHTML, outerHTML, alert, or confirm.
 */

(function (window) {
  "use strict";

  const api = window.MeterFlowAPI;
  const auth = window.MeterFlowAuth;

  // Pure helpers exposed for testing
  function getTokenFromUrl(searchStr) {
    if (!searchStr || typeof searchStr !== "string") return "";
    try {
      if (typeof URLSearchParams !== "undefined") {
        const params = new URLSearchParams(searchStr);
        const tok = params.get("token");
        if (tok !== null) return tok.trim();
      }
    } catch {
      // fallback to regex below
    }
    const match = searchStr.match(/[?&]token=([^&#]*)/);
    return match ? decodeURIComponent(match[1]).trim() : "";
  }

  function isMatchingUser(currentUserEmail, invitedEmail) {
    if (!currentUserEmail || !invitedEmail) return false;
    return currentUserEmail.trim().toLowerCase() === invitedEmail.trim().toLowerCase();
  }

  function getInvitationState(invitation, currentUser) {
    if (!invitation) return "error";
    if (invitation.status !== "pending") return "terminal";
    if (!currentUser || !currentUser.email) return "unauthenticated";
    if (isMatchingUser(currentUser.email, invitation.email)) return "authenticated_match";
    return "mismatched";
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

  // DOM Helpers
  function clearElement(el) {
    if (!el) return;
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  function showError(msg) {
    const banner = document.getElementById("invite-error-banner");
    if (banner) {
      banner.textContent = msg;
      banner.style.display = "block";
    }
  }

  function showSuccess(msg) {
    const banner = document.getElementById("invite-success-banner");
    if (banner) {
      banner.textContent = msg;
      banner.style.display = "block";
    }
  }

  function showWarning(msg) {
    const banner = document.getElementById("invite-warning-banner");
    if (banner) {
      banner.textContent = msg;
      banner.style.display = "block";
    }
  }

  // Controller execution
  async function initAcceptInvite() {
    const loadingEl = document.getElementById("invite-loading");
    const detailsContainer = document.getElementById("invite-details-container");
    const actionsAuth = document.getElementById("invite-actions-authenticated");
    const actionsUnauth = document.getElementById("invite-actions-unauthenticated");
    const actionsMismatched = document.getElementById("invite-actions-mismatched");
    const actionsTerminal = document.getElementById("invite-actions-terminal");

    const token = getTokenFromUrl(window.location.search);
    if (!token) {
      if (loadingEl) loadingEl.style.display = "none";
      showError("Invitation token is missing or invalid. Please check your invitation link.");
      return;
    }

    const apiClient = window.MeterFlowAPI || api;

    try {
      const res = await apiClient.get(`/api/invitations/${encodeURIComponent(token)}`);
      const invitation = res.data?.invitation;

      if (!invitation) {
        throw new Error(res.message || "Invitation not found.");
      }

      if (loadingEl) loadingEl.style.display = "none";
      if (detailsContainer) detailsContainer.style.display = "block";

      // Populate details
      const wsNameEl = document.getElementById("invite-workspace-name");
      const emailEl = document.getElementById("invite-email");
      const roleBadge = document.getElementById("invite-role-badge");
      const invitedByEl = document.getElementById("invite-invited-by");
      const expiresEl = document.getElementById("invite-expires");

      if (wsNameEl) wsNameEl.textContent = invitation.workspace?.name || "Workspace";
      if (emailEl) emailEl.textContent = invitation.email || "—";
      if (roleBadge) {
        const roleLabel = (invitation.role || "member").toUpperCase();
        roleBadge.textContent = roleLabel;
        roleBadge.className = invitation.role === "admin" ? "badge badge-info" : "badge badge-neutral";
      }
      if (invitedByEl) {
        invitedByEl.textContent = invitation.invitedBy?.name || invitation.invitedBy?.email || "Workspace Admin";
      }
      if (expiresEl) expiresEl.textContent = formatDate(invitation.expiresAt);

      // Check user session
      const currentUser = apiClient.isAuthenticated() ? apiClient.getUser() : null;
      const state = getInvitationState(invitation, currentUser);

      if (state === "terminal") {
        showWarning(`This invitation is currently ${invitation.status} and can no longer be accepted.`);
        if (actionsTerminal) actionsTerminal.style.display = "block";
      } else if (state === "unauthenticated") {
        if (actionsUnauth) actionsUnauth.style.display = "block";

        const loginLink = document.getElementById("invite-login-link");
        const registerLink = document.getElementById("invite-register-link");
        const redirectParam = encodeURIComponent(`accept-invite.html?token=${token}`);

        if (loginLink) {
          loginLink.href = `login.html?redirect=${redirectParam}`;
        }
        if (registerLink) {
          registerLink.href = `register.html?redirect=${redirectParam}&email=${encodeURIComponent(invitation.email)}`;
        }
      } else if (state === "mismatched") {
        if (actionsMismatched) actionsMismatched.style.display = "block";
        const mismatchedUserEl = document.getElementById("mismatched-user-email");
        const mismatchedInvitedEl = document.getElementById("mismatched-invited-email");

        if (mismatchedUserEl) mismatchedUserEl.textContent = currentUser.email || "current account";
        if (mismatchedInvitedEl) mismatchedInvitedEl.textContent = invitation.email || "invited account";

        const switchBtn = document.getElementById("switch-account-btn");
        if (switchBtn) {
          switchBtn.addEventListener("click", () => {
            apiClient.clearSession();
            window.location.href = `login.html?redirect=${encodeURIComponent(`accept-invite.html?token=${token}`)}`;
          });
        }
      } else if (state === "authenticated_match") {
        if (actionsAuth) actionsAuth.style.display = "flex";

        const acceptBtn = document.getElementById("accept-invite-btn");
        const declineBtn = document.getElementById("decline-invite-btn");

        if (acceptBtn) {
          acceptBtn.addEventListener("click", async () => {
            acceptBtn.disabled = true;
            if (declineBtn) declineBtn.disabled = true;

            try {
              const acceptRes = await apiClient.post(`/api/invitations/${encodeURIComponent(token)}/accept`);
              if (!acceptRes.success) {
                throw new Error(acceptRes.message || "Failed to accept invitation");
              }

              showSuccess(`Welcome! You are now a member of ${invitation.workspace?.name || "the workspace"}. Redirecting...`);
              if (actionsAuth) actionsAuth.style.display = "none";
              setTimeout(() => {
                window.location.href = "team.html";
              }, 1200);
            } catch (err) {
              showError(err.message || "Failed to accept invitation.");
              acceptBtn.disabled = false;
              if (declineBtn) declineBtn.disabled = false;
            }
          });
        }

        if (declineBtn) {
          declineBtn.addEventListener("click", async () => {
            acceptBtn.disabled = true;
            declineBtn.disabled = true;

            try {
              const declineRes = await apiClient.post(`/api/invitations/${encodeURIComponent(token)}/decline`);
              if (!declineRes.success) {
                throw new Error(declineRes.message || "Failed to decline invitation");
              }

              showWarning("You have declined this invitation.");
              if (actionsAuth) actionsAuth.style.display = "none";
              if (actionsTerminal) actionsTerminal.style.display = "block";
            } catch (err) {
              showError(err.message || "Failed to decline invitation.");
              acceptBtn.disabled = false;
              declineBtn.disabled = false;
            }
          });
        }
      }
    } catch (err) {
      if (loadingEl) loadingEl.style.display = "none";
      showError(err.message || "Failed to load invitation. The link may be invalid or expired.");
    }
  }

  // Initialize on DOM load if in browser
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("DOMContentLoaded", initAcceptInvite);
  }

  // Expose helpers for testing
  window.MeterFlowAcceptInvite = {
    getTokenFromUrl,
    isMatchingUser,
    getInvitationState,
    formatDate
  };
})(typeof window !== "undefined" ? window : globalThis);
