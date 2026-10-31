import jwt from "jsonwebtoken";
import Membership from "../models/Membership.js";
import User from "../models/User.js";

export async function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication token is required"
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    // 1. Check for any existing membership record for this user and workspace
    let membership = await Membership.findOne({
      userId: decoded.userId,
      tenantId: decoded.tenantId
    });

    // If membership exists but is suspended, immediately deny access
    if (membership && membership.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Access denied: your workspace membership is suspended or inactive"
      });
    }

    // 2. Backward-compatibility auto-heal for unmigrated legacy accounts created prior to Membership model
    // CRITICAL SECURITY GUARD: Only auto-heal if NO owner membership exists for this workspace.
    // If the workspace already has an owner, an unauthorized or removed user must NEVER be granted ownership!
    if (!membership) {
      const user = await User.findById(decoded.userId);
      if (user && user.tenantId && user.tenantId.toString() === decoded.tenantId) {
        const ownerExists = await Membership.exists({
          tenantId: decoded.tenantId,
          role: "owner"
        });

        if (!ownerExists) {
          membership = await Membership.create({
            userId: user._id,
            tenantId: user.tenantId,
            role: "owner",
            status: "active"
          }).catch(() => null);
        }
      }
    }

    if (!membership || membership.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Access denied: you are not an active member of this workspace"
      });
    }

    req.user = {
      userId: decoded.userId,
      tenantId: decoded.tenantId,
      role: membership.role
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token"
    });
  }
}

/**
 * Middleware factory to enforce workspace roles (e.g. ['owner', 'admin'])
 */
export function requireWorkspaceRole(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json({
        success: false,
        message: "Workspace membership role could not be verified"
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: this action requires one of the following roles: ${allowedRoles.join(", ")}`
      });
    }

    next();
  };
}
