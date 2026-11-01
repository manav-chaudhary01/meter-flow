/**
 * MeterFlow API Client Module
 * Provides unified, safe, and configurable HTTP access to the MeterFlow REST backend.
 */

(function (window) {
  "use strict";

  // Determine base API URL (relative by default for single-origin serving, or custom override)
  const BASE_URL = window.METERFLOW_API_URL || "";

  // Session keys
  const TOKEN_KEY = "meterflow_token";
  const USER_KEY = "meterflow_user";
  const TENANT_KEY = "meterflow_tenant";

  const api = {
    // Session & Token Helpers
    getToken() {
      try {
        return localStorage.getItem(TOKEN_KEY);
      } catch {
        return null;
      }
    },

    setToken(token) {
      try {
        if (token) {
          localStorage.setItem(TOKEN_KEY, token);
        } else {
          localStorage.removeItem(TOKEN_KEY);
        }
      } catch (err) {
        console.error("Storage access failed:", err.message);
      }
    },

    getUser() {
      try {
        const raw = localStorage.getItem(USER_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },

    setUser(user) {
      try {
        if (user) {
          localStorage.setItem(USER_KEY, JSON.stringify(user));
        } else {
          localStorage.removeItem(USER_KEY);
        }
      } catch (err) {
        console.error("Storage access failed:", err.message);
      }
    },

    getTenant() {
      try {
        const raw = localStorage.getItem(TENANT_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },

    setTenant(tenant) {
      try {
        if (tenant) {
          localStorage.setItem(TENANT_KEY, JSON.stringify(tenant));
        } else {
          localStorage.removeItem(TENANT_KEY);
        }
      } catch (err) {
        console.error("Storage access failed:", err.message);
      }
    },

    clearSession() {
      try {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(TENANT_KEY);
      } catch (err) {
        console.error("Storage clear failed:", err.message);
      }
    },

    isAuthenticated() {
      return Boolean(this.getToken());
    },

    // Core HTTP Request Driver
    async request(endpoint, options = {}) {
      const url = new URL(BASE_URL + endpoint, window.location.origin);

      // Append query parameters if supplied
      if (options.params && typeof options.params === "object") {
        Object.entries(options.params).forEach(([key, val]) => {
          if (val !== undefined && val !== null && val !== "") {
            url.searchParams.append(key, String(val));
          }
        });
      }

      const headers = {
        Accept: "application/json",
        ...(options.headers || {})
      };

      // Attach Bearer token if session exists
      const token = this.getToken();
      if (token && !headers.Authorization) {
        headers.Authorization = `Bearer ${token}`;
      }

      // Automatically serialize JSON request bodies
      let body = options.body;
      if (body && typeof body === "object" && !(body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(body);
      }

      const config = {
        method: (options.method || "GET").toUpperCase(),
        headers,
        body
      };

      let response;
      try {
        response = await fetch(url.toString(), config);
      } catch (netErr) {
        const networkError = new Error("Unable to connect to MeterFlow server. Please check your network connection.");
        networkError.status = 0;
        throw networkError;
      }

      // Handle session expiration (HTTP 401 Unauthorized)
      if (response.status === 401) {
        const currentPath = window.location.pathname;
        const isAuthPage = currentPath.endsWith("login.html") || currentPath.endsWith("register.html");

        if (!isAuthPage) {
          this.clearSession();
          window.location.href = "login.html?expired=true";
          const err = new Error("Session expired. Please sign in again.");
          err.status = 401;
          throw err;
        }
      }

      // Parse payload safely
      let data = null;
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        try {
          data = await response.json();
        } catch {
          data = null;
        }
      } else {
        try {
          const text = await response.text();
          data = { message: text };
        } catch {
          data = null;
        }
      }

      if (!response.ok) {
        const errorMessage = (data && data.message) ? data.message : `Request failed with status ${response.status}`;
        const error = new Error(errorMessage);
        error.status = response.status;
        error.data = data;
        throw error;
      }

      return data;
    },

    // HTTP Convenience Methods
    get(endpoint, params = null) {
      return this.request(endpoint, { method: "GET", params });
    },

    post(endpoint, body = null) {
      return this.request(endpoint, { method: "POST", body });
    },

    put(endpoint, body = null) {
      return this.request(endpoint, { method: "PUT", body });
    },

    patch(endpoint, body = null) {
      return this.request(endpoint, { method: "PATCH", body });
    },

    delete(endpoint) {
      return this.request(endpoint, { method: "DELETE" });
    }
  };

  // Expose to global window scope
  window.MeterFlowAPI = api;
})(window);
