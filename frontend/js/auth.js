/**
 * MeterFlow Authentication Module
 * Handles login, registration, session management, and auth guard protection.
 */

(function (window) {
  "use strict";

  const api = window.MeterFlowAPI;

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function validateLoginForm(formData) {
    const email = (formData?.email || "").trim();
    const password = formData?.password || "";

    if (!email || !password) {
      return { valid: false, error: "Please enter both email and password." };
    }
    if (!EMAIL_REGEX.test(email)) {
      return { valid: false, error: "Please enter a valid email address." };
    }
    return { valid: true, error: null };
  }

  function validateRegisterForm(formData) {
    const name = (formData?.name || "").trim();
    const email = (formData?.email || "").trim();
    const password = formData?.password || "";
    const organizationName = (formData?.organizationName || "").trim();

    if (!name || !email || !password || !organizationName) {
      return { valid: false, error: "All fields are required." };
    }
    if (name.length < 2) {
      return { valid: false, error: "Name must be at least 2 characters long." };
    }
    if (!EMAIL_REGEX.test(email)) {
      return { valid: false, error: "Please enter a valid email address." };
    }
    if (password.length < 6) {
      return { valid: false, error: "Password must be at least 6 characters long." };
    }
    return { valid: true, error: null };
  }

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

  let workspaceCreatedCallback = null;

  function setWorkspaceCreatedCallback(cb) {
    workspaceCreatedCallback = cb;
  }

  function setupCreateWorkspaceModal(customCallback) {
    if (customCallback) {
      workspaceCreatedCallback = customCallback;
    }

    const modal = document.getElementById("create-workspace-modal");
    const openBtn = document.getElementById("open-create-workspace-btn");
    const form = document.getElementById("create-workspace-form");
    const submitBtn = document.getElementById("create-workspace-submit-btn");
    const errorEl = document.getElementById("create-workspace-error");
    const nameInput = document.getElementById("create-workspace-name");
    const typeSelect = document.getElementById("create-workspace-type");

    if (!modal || !openBtn || !form) return;

    function openModal() {
      if (errorEl) {
        errorEl.textContent = "";
        errorEl.style.display = "none";
      }
      form.reset();
      if (typeSelect) typeSelect.value = "organization";
      modal.classList.add("open");
      modal.setAttribute("aria-hidden", "false");
      if (nameInput) {
        setTimeout(() => nameInput.focus(), 50);
      }
    }

    function closeModal() {
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
      if (openBtn) openBtn.focus();
    }

    if (!openBtn.dataset.hasWorkspaceListener) {
      openBtn.dataset.hasWorkspaceListener = "true";
      openBtn.addEventListener("click", openModal);
    }

    modal.querySelectorAll("[data-close-modal='create-workspace-modal']").forEach((btn) => {
      if (!btn.dataset.hasCloseListener) {
        btn.dataset.hasCloseListener = "true";
        btn.addEventListener("click", closeModal);
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.classList.contains("open")) {
        closeModal();
      }
    });

    if (!form.dataset.hasSubmitListener) {
      form.dataset.hasSubmitListener = "true";
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (errorEl) {
          errorEl.textContent = "";
          errorEl.style.display = "none";
        }

        const name = nameInput ? nameInput.value.trim() : "";
        const type = typeSelect ? typeSelect.value : "organization";

        const validation = validateWorkspaceForm({ name, type });
        if (!validation.valid) {
          if (errorEl) {
            errorEl.textContent = validation.error;
            errorEl.style.display = "flex";
          }
          return;
        }

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "";
          const spinner = document.createElement("span");
          spinner.className = "btn-spinner";
          submitBtn.appendChild(spinner);
          submitBtn.appendChild(document.createTextNode(" Creating..."));
        }

        try {
          const apiClient = window.MeterFlowAPI || api;
          const res = await apiClient.post("/api/workspaces", { name, type });
          if (!res.success || !res.data || !res.data.workspace) {
            throw new Error(res.message || "Failed to create workspace");
          }

          const createdWorkspace = res.data.workspace;

          // Automatically switch to the newly created workspace
          const switchRes = await apiClient.post("/api/workspaces/switch", {
            workspaceId: createdWorkspace.id
          });

          if (!switchRes.success || !switchRes.data) {
            throw new Error(switchRes.message || "Created workspace but failed to switch context");
          }

          apiClient.setToken(switchRes.data.token);
          apiClient.setTenant(switchRes.data.workspace);

          closeModal();

          if (typeof workspaceCreatedCallback === "function") {
            await workspaceCreatedCallback(switchRes.data.workspace);
          } else {
            window.location.reload();
          }
        } catch (err) {
          if (errorEl) {
            errorEl.textContent = err.message || "Failed to create workspace";
            errorEl.style.display = "flex";
          }
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Create Workspace";
          }
        }
      });
    }
  }

  function validateRenameWorkspaceForm(formData) {
    const name = (formData?.name || "").trim();

    if (!name) {
      return { valid: false, error: "Workspace name is required.", fieldId: "rename-workspace-name" };
    }
    if (name.length < 2 || name.length > 100) {
      return {
        valid: false,
        error: "Workspace name must be between 2 and 100 characters.",
        fieldId: "rename-workspace-name"
      };
    }
    return { valid: true, error: null, data: { name } };
  }

  let workspaceRenamedCallback = null;

  function setWorkspaceRenamedCallback(cb) {
    workspaceRenamedCallback = cb;
  }

  function updateWorkspaceRoleUI(role) {
    const renameBtn = document.getElementById("open-rename-workspace-btn");
    if (!renameBtn) return;
    const normalizedRole = (role || "").toLowerCase();
    if (normalizedRole === "member") {
      renameBtn.disabled = true;
      renameBtn.title = "Only workspace owners and admins can rename the workspace";
      renameBtn.setAttribute("aria-disabled", "true");
    } else {
      renameBtn.disabled = false;
      renameBtn.title = "Rename current workspace";
      renameBtn.removeAttribute("aria-disabled");
    }
  }

  function setupRenameWorkspaceModal(customCallback) {
    if (customCallback) {
      workspaceRenamedCallback = customCallback;
    }

    const modal = document.getElementById("rename-workspace-modal");
    const openBtn = document.getElementById("open-rename-workspace-btn");
    const form = document.getElementById("rename-workspace-form");
    const submitBtn = document.getElementById("rename-workspace-submit-btn");
    const errorEl = document.getElementById("rename-workspace-error");
    const nameInput = document.getElementById("rename-workspace-name");
    const selectEl = document.getElementById("workspace-select");

    if (!modal || !openBtn || !form) return;

    // Check initial role if role badge is already populated
    const roleBadgeEl = document.getElementById("workspace-role-badge");
    if (roleBadgeEl && roleBadgeEl.textContent) {
      updateWorkspaceRoleUI(roleBadgeEl.textContent.trim());
    }

    function openModal() {
      if (openBtn.disabled) return;
      if (errorEl) {
        errorEl.textContent = "";
        errorEl.style.display = "none";
      }
      form.reset();

      let currentName = "";
      const apiClient = window.MeterFlowAPI || api;
      const currentTenant = apiClient.getTenant ? apiClient.getTenant() : null;
      if (currentTenant && currentTenant.name) {
        currentName = currentTenant.name;
      } else if (selectEl && selectEl.selectedOptions && selectEl.selectedOptions[0]) {
        const optText = selectEl.selectedOptions[0].textContent || "";
        currentName = optText.replace(/\s*\([^)]*\)$/, "").trim();
      }

      if (nameInput) {
        nameInput.value = currentName;
      }

      modal.classList.add("open");
      modal.setAttribute("aria-hidden", "false");
      if (nameInput) {
        setTimeout(() => {
          nameInput.focus();
          nameInput.select();
        }, 50);
      }
    }

    function closeModal() {
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
      if (openBtn) openBtn.focus();
    }

    if (!openBtn.dataset.hasRenameListener) {
      openBtn.dataset.hasRenameListener = "true";
      openBtn.addEventListener("click", openModal);
    }

    modal.querySelectorAll("[data-close-modal='rename-workspace-modal']").forEach((btn) => {
      if (!btn.dataset.hasCloseListener) {
        btn.dataset.hasCloseListener = "true";
        btn.addEventListener("click", closeModal);
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.classList.contains("open")) {
        closeModal();
      }
    });

    if (!form.dataset.hasSubmitListener) {
      form.dataset.hasSubmitListener = "true";
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (errorEl) {
          errorEl.textContent = "";
          errorEl.style.display = "none";
        }

        const name = nameInput ? nameInput.value.trim() : "";
        const validation = validateRenameWorkspaceForm({ name });
        if (!validation.valid) {
          if (errorEl) {
            errorEl.textContent = validation.error;
            errorEl.style.display = "flex";
          }
          if (nameInput) nameInput.focus();
          return;
        }

        const apiClient = window.MeterFlowAPI || api;
        const currentTenant = apiClient.getTenant ? apiClient.getTenant() : null;
        const workspaceId =
          (selectEl && selectEl.value) ||
          (currentTenant && (currentTenant.id || currentTenant._id));

        if (!workspaceId) {
          if (errorEl) {
            errorEl.textContent = "Could not identify the active workspace ID.";
            errorEl.style.display = "flex";
          }
          return;
        }

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "";
          const spinner = document.createElement("span");
          spinner.className = "btn-spinner";
          submitBtn.appendChild(spinner);
          submitBtn.appendChild(document.createTextNode(" Saving..."));
        }

        try {
          const res = await apiClient.patch(`/api/workspaces/${workspaceId}`, { name });
          if (!res.success || !res.data || !res.data.workspace) {
            throw new Error(res.message || "Failed to rename workspace");
          }

          const updatedWorkspace = res.data.workspace;

          // Update local session tenant object
          const storedTenant = (apiClient.getTenant && apiClient.getTenant()) || {};
          storedTenant.name = updatedWorkspace.name;
          if (apiClient.setTenant) {
            apiClient.setTenant(storedTenant);
          }

          // Update option text in workspace selector immediately
          if (selectEl && selectEl.selectedOptions && selectEl.selectedOptions[0]) {
            const opt = selectEl.selectedOptions[0];
            opt.textContent = `${updatedWorkspace.name} (${updatedWorkspace.type || "organization"})`;
          }

          closeModal();

          // Dispatch event so any page controller can update workspace name in page titles or headers
          window.dispatchEvent(
            new CustomEvent("workspace-renamed", { detail: { workspace: updatedWorkspace } })
          );

          if (typeof workspaceRenamedCallback === "function") {
            await workspaceRenamedCallback(updatedWorkspace);
          }
        } catch (err) {
          if (errorEl) {
            errorEl.textContent = err.message || "Failed to rename workspace";
            errorEl.style.display = "flex";
          }
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Save Changes";
          }
        }
      });
    }
  }

  const auth = {
    validateLoginForm,
    validateRegisterForm,
    validateWorkspaceForm,
    validateRenameWorkspaceForm,
    setWorkspaceCreatedCallback,
    setupCreateWorkspaceModal,
    setWorkspaceRenamedCallback,
    setupRenameWorkspaceModal,
    updateWorkspaceRoleUI,

    // Check authentication for protected pages
    requireAuth() {
      const apiClient = window.MeterFlowAPI || api;
      if (!apiClient || !apiClient.isAuthenticated()) {
        window.location.href = "login.html";
        return false;
      }
      return true;
    },

    // Redirect already authenticated users away from login/register pages
    redirectIfAuthenticated() {
      const apiClient = window.MeterFlowAPI || api;
      if (apiClient && apiClient.isAuthenticated()) {
        window.location.href = "index.html";
        return true;
      }
      return false;
    },

    // Log out user cleanly
    logout() {
      const apiClient = window.MeterFlowAPI || api;
      if (apiClient) {
        apiClient.clearSession();
      }
      window.location.href = "login.html?logged_out=true";
    },

    // Initialize Login Page
    initLoginPage() {
      if (this.redirectIfAuthenticated()) return;

      const form = document.getElementById("login-form");
      const submitBtn = document.getElementById("login-submit-btn");
      const errorBanner = document.getElementById("auth-error-banner");
      const infoBanner = document.getElementById("auth-info-banner");
      const togglePasswordBtn = document.getElementById("toggle-password-btn");
      const passwordInput = document.getElementById("password");

      // Check URL parameters for session state notifications
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get("expired") === "true" && infoBanner) {
        infoBanner.textContent = "Your session has expired. Please sign in again.";
        infoBanner.style.display = "flex";
      } else if (urlParams.get("logged_out") === "true" && infoBanner) {
        infoBanner.textContent = "You have been successfully signed out.";
        infoBanner.style.display = "flex";
      }

      // Password visibility toggle
      if (togglePasswordBtn && passwordInput) {
        togglePasswordBtn.addEventListener("click", () => {
          const isPassword = passwordInput.type === "password";
          passwordInput.type = isPassword ? "text" : "password";
          togglePasswordBtn.textContent = isPassword ? "Hide" : "Show";
          togglePasswordBtn.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
        });
      }

      // Login form submission
      if (form) {
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          if (errorBanner) errorBanner.style.display = "none";
          if (infoBanner) infoBanner.style.display = "none";

          const email = document.getElementById("email")?.value.trim();
          const password = passwordInput?.value;

          // Client-side validation
          const validation = validateLoginForm({ email, password });
          if (!validation.valid) {
            showError(validation.error);
            return;
          }

          // Button protection against accidental double submissions
          setSubmitting(true);

          try {
            const apiClient = window.MeterFlowAPI || api;
            const res = await apiClient.post("/api/auth/login", { email, password });
            if (res.success && res.data) {
              apiClient.setToken(res.data.token);
              apiClient.setUser(res.data.user);
              apiClient.setTenant(res.data.tenant);

              // Redirect to dashboard
              window.location.href = "index.html";
            } else {
              showError(res.message || "Login failed. Please check your credentials.");
              setSubmitting(false);
            }
          } catch (err) {
            showError(err.message || "Invalid email or password");
            setSubmitting(false);
          }
        });
      }

      function showError(msg) {
        if (errorBanner) {
          errorBanner.textContent = msg;
          errorBanner.style.display = "flex";
        }
      }

      function setSubmitting(isSubmitting) {
        if (!submitBtn) return;
        submitBtn.disabled = isSubmitting;
        submitBtn.textContent = "";
        if (isSubmitting) {
          const spinner = document.createElement("span");
          spinner.className = "btn-spinner";
          submitBtn.appendChild(spinner);
          submitBtn.appendChild(document.createTextNode(" Signing in..."));
        } else {
          submitBtn.textContent = "Sign In";
        }
      }
    },

    // Initialize Register Page
    initRegisterPage() {
      if (this.redirectIfAuthenticated()) return;

      const form = document.getElementById("register-form");
      const submitBtn = document.getElementById("register-submit-btn");
      const errorBanner = document.getElementById("auth-error-banner");
      const togglePasswordBtn = document.getElementById("toggle-password-btn");
      const passwordInput = document.getElementById("password");

      // Password visibility toggle
      if (togglePasswordBtn && passwordInput) {
        togglePasswordBtn.addEventListener("click", () => {
          const isPassword = passwordInput.type === "password";
          passwordInput.type = isPassword ? "text" : "password";
          togglePasswordBtn.textContent = isPassword ? "Hide" : "Show";
          togglePasswordBtn.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
        });
      }

      if (form) {
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          if (errorBanner) errorBanner.style.display = "none";

          const name = document.getElementById("name")?.value.trim();
          const email = document.getElementById("email")?.value.trim();
          const password = passwordInput?.value;
          const organizationName = document.getElementById("organization-name")?.value.trim();
          const workspaceType = document.getElementById("workspace-type")?.value || "organization";

          // Client-side validation
          const validation = validateRegisterForm({
            name,
            email,
            password,
            organizationName
          });
          if (!validation.valid) {
            showError(validation.error);
            return;
          }

          // Anti-double-submission
          setSubmitting(true);

          try {
            const apiClient = window.MeterFlowAPI || api;
            const res = await apiClient.post("/api/auth/register", {
              name,
              email,
              password,
              organizationName,
              workspaceType
            });

            if (res.success && res.data) {
              apiClient.setToken(res.data.token);
              apiClient.setUser(res.data.user);
              apiClient.setTenant(res.data.tenant);

              // Direct entry into newly provisioned workspace dashboard
              window.location.href = "index.html";
            } else {
              showError(res.message || "Registration failed. Please review your details.");
              setSubmitting(false);
            }
          } catch (err) {
            const apiClient = window.MeterFlowAPI || api;
            const errorMsg = apiClient?.formatAuthErrorMessage ? apiClient.formatAuthErrorMessage(err) : (err.message || "An unexpected error occurred during registration.");
            showError(errorMsg);
            setSubmitting(false);
          }
        });
      }

      function showError(msg) {
        if (errorBanner) {
          errorBanner.textContent = msg;
          errorBanner.style.display = "flex";
        }
      }

      function setSubmitting(isSubmitting) {
        if (!submitBtn) return;
        submitBtn.disabled = isSubmitting;
        submitBtn.textContent = "";
        if (isSubmitting) {
          const spinner = document.createElement("span");
          spinner.className = "btn-spinner";
          submitBtn.appendChild(spinner);
          submitBtn.appendChild(document.createTextNode(" Creating Account..."));
        } else {
          submitBtn.textContent = "Create Account";
        }
      }
    }
  };

  // Expose to global window scope
  window.MeterFlowAuth = auth;

  // Auto-initialize based on detected form elements without needing inline scripts
  document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("login-form")) {
      auth.initLoginPage();
    } else if (document.getElementById("register-form")) {
      auth.initRegisterPage();
    }
    if (document.getElementById("create-workspace-modal")) {
      auth.setupCreateWorkspaceModal();
    }
    if (document.getElementById("rename-workspace-modal")) {
      auth.setupRenameWorkspaceModal();
    }
  });
})(window);
