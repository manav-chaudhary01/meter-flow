/**
 * MeterFlow Authentication Module
 * Handles login, registration, session management, and auth guard protection.
 */

(function (window) {
  "use strict";

  const api = window.MeterFlowAPI;

  const auth = {
    // Check authentication for protected pages
    requireAuth() {
      if (!api.isAuthenticated()) {
        window.location.href = "login.html";
        return false;
      }
      return true;
    },

    // Redirect already authenticated users away from login/register pages
    redirectIfAuthenticated() {
      if (api.isAuthenticated()) {
        window.location.href = "index.html";
        return true;
      }
      return false;
    },

    // Log out user cleanly
    logout() {
      api.clearSession();
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

          const email = document.getElementById("email")?.value.trim();
          const password = passwordInput?.value;

          // Client-side validation
          if (!email || !password) {
            showError("Please enter both email and password.");
            return;
          }

          // Button protection against accidental double submissions
          setSubmitting(true);

          try {
            const res = await api.post("/api/auth/login", { email, password });
            if (res.success && res.data) {
              api.setToken(res.data.token);
              api.setUser(res.data.user);
              api.setTenant(res.data.tenant);

              // Redirect to dashboard
              window.location.href = "index.html";
            } else {
              showError(res.message || "Login failed. Please check your credentials.");
              setSubmitting(false);
            }
          } catch (err) {
            showError(err.message || "An unexpected error occurred. Please try again.");
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
        if (isSubmitting) {
          submitBtn.innerHTML = '<span class="btn-spinner"></span> Signing in...';
        } else {
          submitBtn.innerHTML = "Sign In";
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
          if (!name || !email || !password || !organizationName) {
            showError("All fields are required.");
            return;
          }

          if (password.length < 6) {
            showError("Password must be at least 6 characters long.");
            return;
          }

          // Anti-double-submission
          setSubmitting(true);

          try {
            const res = await api.post("/api/auth/register", {
              name,
              email,
              password,
              organizationName,
              workspaceType
            });

            if (res.success && res.data) {
              api.setToken(res.data.token);
              api.setUser(res.data.user);
              api.setTenant(res.data.tenant);

              // Direct entry into newly provisioned workspace dashboard
              window.location.href = "index.html";
            } else {
              showError(res.message || "Registration failed. Please review your details.");
              setSubmitting(false);
            }
          } catch (err) {
            showError(err.message || "An unexpected error occurred during registration.");
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
        if (isSubmitting) {
          submitBtn.innerHTML = '<span class="btn-spinner"></span> Creating Account...';
        } else {
          submitBtn.innerHTML = "Create Account";
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
