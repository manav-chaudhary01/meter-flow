import crypto from "crypto";

/**
 * Cryptographically secure invitation token utilities
 */

/**
 * Generates a 64-character hex cryptographically secure random token (256 bits entropy)
 * @returns {string}
 */
export function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Hashes an invitation token using SHA-256
 * @param {string} token
 * @returns {string}
 */
export function hashToken(token) {
  if (!token || typeof token !== "string") {
    throw new Error("Token must be a non-empty string");
  }
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
}

/**
 * Validates whether a token matches the expected 64-character hexadecimal format
 * @param {string} token
 * @returns {boolean}
 */
export function isValidTokenFormat(token) {
  return typeof token === "string" && /^[a-f0-9]{64}$/i.test(token.trim());
}
