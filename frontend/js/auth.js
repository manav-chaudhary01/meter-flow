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

  const auth = {
    validateLoginForm,
    validateRegisterForm,

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
  });
})(window);
