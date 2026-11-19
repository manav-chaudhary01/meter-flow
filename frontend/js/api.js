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

    parseJwtPayload(token) {
      if (!token || typeof token !== "string") return null;
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      try {
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const pad = base64.length % 4;
        const padded = pad ? base64 + "=".repeat(4 - pad) : base64;

        let rawStr;
        if (typeof atob === "function") {
          rawStr = atob(padded);
        } else if (typeof Buffer !== "undefined") {
          rawStr = Buffer.from(padded, "base64").toString("utf-8");
        } else {
          return null;
        }

        try {
          const jsonStr = decodeURIComponent(
            rawStr
              .split("")
              .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
              .join("")
          );
          return JSON.parse(jsonStr);
        } catch {
          return JSON.parse(rawStr);
        }
      } catch {
        return null;
      }
    },

    isAuthenticated() {
      const token = this.getToken();
      if (!token) return false;

      const user = this.getUser();
      if (!user) {
        this.clearSession();
        return false;
      }

      const payload = this.parseJwtPayload(token);
      if (!payload) {
        this.clearSession();
        return false;
      }

      if (payload.exp && typeof payload.exp === "number") {
        if (payload.exp * 1000 <= Date.now()) {
          this.clearSession();
          return false;
        }
      }

      return true;
    },

    formatAuthErrorMessage(err) {
      if (!err) return "An unexpected error occurred.";
      const msg = String(err.message || "");
      if (err.status === 400) {
        return msg || "Invalid request. Please check your input.";
      }
      if (err.status === 401) {
        if (msg && !msg.toLowerCase().includes("session") && !msg.toLowerCase().includes("expired")) {
          return msg;
        }
        return "Your session has expired. Please sign in again.";
      }
      if (err.status === 403) {
        const lower = msg.toLowerCase();
        if (lower.includes("suspended") || lower.includes("inactive")) {
          return "Access Denied: Your workspace membership is suspended or inactive.";
        }
        if (lower.includes("not an active member")) {
          return "Access Denied: You are not an active member of this workspace.";
        }
        if (lower.includes("requires one of the following roles") || lower.includes("role")) {
          return "Access Denied: You do not have permission to perform this administrative action.";
        }
        return err.message || "Access Denied: You do not have permission to access this resource.";
      }
      if (err.status === 404) {
        return msg || "The requested resource was not found.";
      }
      if (err.status === 409) {
        return msg || "A conflict occurred with an existing resource.";
      }
      if (err.status === 413) {
        return msg || "Request payload is too large. Please reduce input size.";
      }
      if (err.status >= 500) {
        return msg || "A server error occurred. Please try again later.";
      }
      return err.message || "An unexpected error occurred.";
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
        const currentPath = (window.location.pathname || "").toLowerCase();
        const isAuthEndpoint =
          typeof endpoint === "string" &&
          (endpoint.startsWith("/api/auth/login") || endpoint.startsWith("/api/auth/register"));
        const isAuthPage =
          currentPath.endsWith("login.html") ||
          currentPath.endsWith("register.html") ||
          currentPath.endsWith("/login") ||
          currentPath.endsWith("/register") ||
          currentPath === "/login" ||
          currentPath === "/register";

        if (!isAuthPage && !isAuthEndpoint) {
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
          data = text ? { message: text } : null;
        } catch {
          data = null;
        }
      }

      if (!response.ok) {
        let errorMessage = "";
        if (data && typeof data === "object") {
          if (typeof data.message === "string" && data.message.trim()) {
            errorMessage = data.message.trim();
          } else if (typeof data.error === "string" && data.error.trim()) {
            errorMessage = data.error.trim();
          } else if (Array.isArray(data.errors) && data.errors.length > 0) {
            errorMessage = data.errors
              .map((e) => (typeof e === "string" ? e : (e.msg || e.message || JSON.stringify(e))))
              .join("; ");
          }
        }
        if (!errorMessage) {
          errorMessage = `Request failed with status ${response.status}`;
        }
        const error = new Error(errorMessage);
        error.status = response.status;
        error.data = data;
        throw error;
      }

      return data || {};
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

    delete(endpoint, body = null) {
      return this.request(endpoint, { method: "DELETE", body });
    }
  };

  // Expose to global window scope
  window.MeterFlowAPI = api;
})(window);
