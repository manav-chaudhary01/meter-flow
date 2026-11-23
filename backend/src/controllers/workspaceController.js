import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import Membership from "../models/Membership.js";

export async function listWorkspaces(req, res) {
  try {
    const memberships = await Membership.find({
      userId: req.user.userId,
      status: "active"
    }).populate("tenantId");

    const workspaces = memberships
      .filter((m) => m.tenantId && m.tenantId.status !== "archived")
      .map((m) => ({
        id: m.tenantId._id,
        name: m.tenantId.name,
        type: m.tenantId.type || "organization",
        role: m.role,
        isCurrent: m.tenantId._id.toString() === req.user.tenantId.toString(),
        createdAt: m.tenantId.createdAt
      }))
      .sort((a, b) => {
        if (a.isCurrent) return -1;
        if (b.isCurrent) return 1;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

    return res.status(200).json({
      success: true,
      data: {
        workspaces
      }
    });
  } catch (error) {
    console.error("List workspaces error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch workspaces"
    });
  }
}

export async function createWorkspace(req, res) {
  try {
    const { name, type } = req.body;

    if (!name || typeof name !== "string") {
      return res.status(400).json({
        success: false,
        message: "Workspace name is required"
      });
    }

    const normalizedName = name.trim();
    const chosenType = (typeof type === "string" ? type : "organization").trim().toLowerCase();

    if (normalizedName.length < 2 || normalizedName.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Workspace name must be between 2 and 100 characters"
      });
    }

    if (!["personal", "organization"].includes(chosenType)) {
      return res.status(400).json({
        success: false,
        message: "Workspace type must be either 'personal' or 'organization'"
      });
    }

    // Single personal workspace constraint per user
    if (chosenType === "personal") {
      const activeMemberships = await Membership.find({
        userId: req.user.userId,
        status: "active"
      }).populate("tenantId");

      const hasPersonal = activeMemberships.some(
        (m) => m.tenantId && m.tenantId.type === "personal"
      );

      if (hasPersonal) {
        return res.status(409).json({
          success: false,
          message: "User already has a personal workspace"
        });
      }
    }

    const workspace = await Tenant.create({
      name: normalizedName,
      type: chosenType,
      createdBy: req.user.userId
    });

    const membership = await Membership.create({
      userId: req.user.userId,
      tenantId: workspace._id,
      role: "owner",
      status: "active"
    });

    return res.status(201).json({
      success: true,
      message: "Workspace created successfully",
      data: {
        workspace: {
          id: workspace._id,
          name: workspace.name,
          type: workspace.type,
          role: membership.role,
          createdAt: workspace.createdAt
        }
      }
    });
  } catch (error) {
    console.error("Create workspace error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create workspace"
    });
  }
}

export async function switchWorkspace(req, res) {
  try {
    const { workspaceId } = req.body;

    if (!workspaceId || !mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({
        success: false,
        message: "A valid workspaceId is required"
      });
    }

    // Verify authorized membership in target workspace
    const membership = await Membership.findOne({
      userId: req.user.userId,
      tenantId: workspaceId,
      status: "active"
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: "Access denied: you are not an active member of this workspace"
      });
    }

    const targetWorkspace = await Tenant.findById(workspaceId);
    if (!targetWorkspace) {
      return res.status(404).json({
        success: false,
        message: "Target workspace not found"
      });
    }

    if (targetWorkspace.status === "archived") {
      return res.status(403).json({
        success: false,
        message: "Access denied: workspace is archived and cannot be activated"
      });
    }

    // Update user's active tenant pointer
    await User.findByIdAndUpdate(req.user.userId, {
      tenantId: workspaceId
    });

    // Issue newly signed token scoped to target workspace
    const token = jwt.sign(
      {
        userId: req.user.userId.toString(),
        tenantId: workspaceId.toString()
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1d"
      }
    );

    return res.status(200).json({
      success: true,
      message: "Switched workspace successfully",
      data: {
        token,
        workspace: {
          id: targetWorkspace._id,
          name: targetWorkspace.name,
          type: targetWorkspace.type || "organization",
          role: membership.role
        }
      }
    });
  } catch (error) {
    console.error("Switch workspace error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to switch workspace"
    });
  }
}

export async function renameWorkspace(req, res) {
  try {
    const { id: workspaceId } = req.params;
    const { name } = req.body;

    if (!workspaceId || !mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({
        success: false,
        message: "A valid workspace ID is required"
      });
    }

    if (name === undefined || name === null || typeof name !== "string") {
      return res.status(400).json({
        success: false,
        message: "Workspace name is required and must be a string"
      });
    }

    const normalizedName = name.trim();
    if (normalizedName.length < 2 || normalizedName.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Workspace name must be between 2 and 100 characters"
      });
    }

    // Verify caller has active membership in this workspace with role 'owner' or 'admin'
    const membership = await Membership.findOne({
      userId: req.user.userId,
      tenantId: workspaceId,
      status: "active"
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: "Access denied: you are not an active member of this workspace"
      });
    }

    if (!["owner", "admin"].includes(membership.role)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: only workspace owners and admins can rename the workspace"
      });
    }

    const workspace = await Tenant.findById(workspaceId);
    if (!workspace) {
      return res.status(404).json({
        success: false,
        message: "Workspace not found"
      });
    }

    if (workspace.status === "archived") {
      return res.status(403).json({
        success: false,
        message: "Archived workspace cannot be renamed"
      });
    }

    // Update name only; preserve _id, type, createdBy, timestamps, etc.
    workspace.name = normalizedName;
    await workspace.save();

    return res.status(200).json({
      success: true,
      message: "Workspace renamed successfully",
      data: {
        workspace: {
          id: workspace._id,
          name: workspace.name,
          type: workspace.type || "organization",
          role: membership.role
        }
      }
    });
  } catch (error) {
    console.error("Rename workspace error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to rename workspace"
    });
  }
}

export async function getWorkspaceMembers(req, res) {
  try {
    const { id: workspaceId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid workspace ID"
      });
    }

    // Caller must be an active member of this workspace
    const callerMembership = await Membership.findOne({
      userId: req.user.userId,
      tenantId: workspaceId,
      status: "active"
    });

    if (!callerMembership) {
      return res.status(403).json({
        success: false,
        message: "Access denied: you are not a member of this workspace"
      });
    }

    const memberships = await Membership.find({
      tenantId: workspaceId,
      status: { $in: ["active", "suspended"] }
    }).populate("userId", "name email");

    const members = memberships
      .filter((m) => m.userId)
      .map((m) => ({
        userId: m.userId._id,
        name: m.userId.name,
        email: m.userId.email,
        role: m.role,
        status: m.status || "active",
        joinedAt: m.createdAt
      }));

    return res.status(200).json({
      success: true,
      data: {
        members
      }
    });
  } catch (error) {
    console.error("Get workspace members error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch workspace members"
    });
  }
}

/**
 * Adds a member directly to an organization workspace.
 * @deprecated Deprecated in P3.3 in favor of the invitation lifecycle (POST /api/workspaces/:id/invitations).
 * Maintained with deprecation header for backward compatibility and test fixtures.
 */
export async function addWorkspaceMember(req, res) {
  try {
    res.setHeader("Deprecation", "true");
    const { id: workspaceId } = req.params;
    const { email, role } = req.body;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid workspace ID"
      });
    }

    if (!email || typeof email !== "string") {
      return res.status(400).json({
        success: false,
        message: "Member email is required"
      });
    }

    const chosenRole = (typeof role === "string" ? role : "member").trim().toLowerCase();
    if (!["admin", "member"].includes(chosenRole)) {
      return res.status(400).json({
        success: false,
        message: "Role must be 'admin' or 'member'"
      });
    }

    // Caller must be owner or admin
    const callerMembership = await Membership.findOne({
      userId: req.user.userId,
      tenantId: workspaceId,
      status: "active"
    });

    if (!callerMembership || !["owner", "admin"].includes(callerMembership.role)) {
      return res.status(403).json({
        success: false,
        message: "Only workspace owners and admins can add members"
      });
    }

    const workspace = await Tenant.findById(workspaceId);
    if (!workspace) {
      return res.status(404).json({
        success: false,
        message: "Workspace not found"
      });
    }

    if (workspace.status === "archived") {
      return res.status(403).json({
        success: false,
        message: "Cannot add members to an archived workspace"
      });
    }

    if (workspace.type === "personal") {
      return res.status(400).json({
        success: false,
        message: "Personal workspaces cannot have additional members"
      });
    }

    const targetUser = await User.findOne({
      email: email.trim().toLowerCase()
    });

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found with this email"
      });
    }

    const existingMembership = await Membership.findOne({
      userId: targetUser._id,
      tenantId: workspaceId
    });

    if (existingMembership) {
      return res.status(409).json({
        success: false,
        message: "User is already a member of this workspace"
      });
    }

    const newMembership = await Membership.create({
      userId: targetUser._id,
      tenantId: workspaceId,
      role: chosenRole,
      status: "active"
    });

    return res.status(201).json({
      success: true,
      message: "Member added successfully",
      data: {
        member: {
          userId: targetUser._id,
          name: targetUser.name,
          email: targetUser.email,
          role: newMembership.role,
          joinedAt: newMembership.createdAt
        }
      }
    });
  } catch (error) {
    console.error("Add workspace member error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to add member"
    });
  }
}

export async function removeWorkspaceMember(req, res) {
  try {
    const { id: workspaceId, memberUserId } = req.params;

    if (
      !mongoose.Types.ObjectId.isValid(workspaceId) ||
      !mongoose.Types.ObjectId.isValid(memberUserId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid workspace or member user ID"
      });
    }

    // Caller must be owner or admin
    const callerMembership = await Membership.findOne({
      userId: req.user.userId,
      tenantId: workspaceId,
      status: "active"
    });

    if (!callerMembership || !["owner", "admin"].includes(callerMembership.role)) {
      return res.status(403).json({
        success: false,
        message: "Only workspace owners and admins can remove members"
      });
    }

    const targetMembership = await Membership.findOne({
      userId: memberUserId,
      tenantId: workspaceId
    });

    if (!targetMembership) {
      return res.status(404).json({
        success: false,
        message: "Membership not found"
      });
    }

    // Workspace owner cannot be removed
    if (targetMembership.role === "owner") {
      return res.status(403).json({
        success: false,
        message: "Cannot remove the workspace owner"
      });
    }

    // Admins cannot remove other admins
    if (callerMembership.role === "admin" && targetMembership.role === "admin") {
      return res.status(403).json({
        success: false,
        message: "Admins cannot remove other admins"
      });
    }

    await Membership.findByIdAndDelete(targetMembership._id);

    // If the removed user's active tenant was pointing to this workspace, reset it
    const removedUser = await User.findById(memberUserId);
    if (removedUser && removedUser.tenantId && removedUser.tenantId.toString() === workspaceId.toString()) {
      const fallbackMembership = await Membership.findOne({
        userId: memberUserId,
        status: "active"
      });
      removedUser.tenantId = fallbackMembership ? fallbackMembership.tenantId : null;
      await removedUser.save();
    }

    return res.status(200).json({
      success: true,
      message: "Member removed successfully"
    });
  } catch (error) {
    console.error("Remove workspace member error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to remove member"
    });
  }
}

export async function modifyWorkspaceMemberRole(req, res) {
  try {
    const { id: workspaceId, memberUserId } = req.params;
    const { role } = req.body;

    if (
      !mongoose.Types.ObjectId.isValid(workspaceId) ||
      !mongoose.Types.ObjectId.isValid(memberUserId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid workspace or member user ID"
      });
    }

    if (role === undefined || role === null || typeof role !== "string") {
      return res.status(400).json({
        success: false,
        message: "Role is required and must be a string"
      });
    }

    const normalizedRole = role.trim().toLowerCase();

    if (normalizedRole === "owner") {
      return res.status(400).json({
        success: false,
        message: "Cannot assign owner role through role modification"
      });
    }

    if (!["admin", "member"].includes(normalizedRole)) {
      return res.status(400).json({
        success: false,
        message: "Role must be 'admin' or 'member'"
      });
    }

    // Caller must be an active member of this workspace with role 'owner'
    const callerMembership = await Membership.findOne({
      userId: req.user.userId,
      tenantId: workspaceId,
      status: "active"
    });

    if (!callerMembership) {
      return res.status(403).json({
        success: false,
        message: "Access denied: you are not an active member of this workspace"
      });
    }

    if (callerMembership.role !== "owner") {
      return res.status(403).json({
        success: false,
        message: "Forbidden: only workspace owners can modify member roles"
      });
    }

    const targetMembership = await Membership.findOne({
      userId: memberUserId,
      tenantId: workspaceId
    });

    if (!targetMembership) {
      return res.status(404).json({
        success: false,
        message: "Membership not found"
      });
    }

    // Workspace owner role cannot be modified or demoted
    if (targetMembership.role === "owner") {
      return res.status(403).json({
        success: false,
        message: "Workspace owner role cannot be modified"
      });
    }

    targetMembership.role = normalizedRole;
    await targetMembership.save();

    const targetUser = await User.findById(memberUserId);

    return res.status(200).json({
      success: true,
      message: "Member role updated successfully",
      data: {
        member: {
          userId: targetMembership.userId,
          name: targetUser ? targetUser.name : "",
          email: targetUser ? targetUser.email : "",
          role: targetMembership.role,
          joinedAt: targetMembership.createdAt,
          updatedAt: targetMembership.updatedAt
        }
      }
    });
  } catch (error) {
    console.error("Modify workspace member role error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to modify member role"
    });
  }
}

export async function modifyWorkspaceMemberStatus(req, res) {
  try {
    const { id: workspaceId, memberUserId } = req.params;
    const { status } = req.body;

    if (
      !mongoose.Types.ObjectId.isValid(workspaceId) ||
      !mongoose.Types.ObjectId.isValid(memberUserId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid workspace or member user ID"
      });
    }

    if (status === undefined || status === null || typeof status !== "string") {
      return res.status(400).json({
        success: false,
        message: "Status is required and must be a string"
      });
    }

    const normalizedStatus = status.trim().toLowerCase();
    if (!["active", "suspended"].includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: "Status must be 'active' or 'suspended'"
      });
    }

    // Caller must be an active member of this workspace with role 'owner' or 'admin'
    const callerMembership = await Membership.findOne({
      userId: req.user.userId,
      tenantId: workspaceId,
      status: "active"
    });

    if (!callerMembership) {
      return res.status(403).json({
        success: false,
        message: "Access denied: you are not an active member of this workspace"
      });
    }

    if (!["owner", "admin"].includes(callerMembership.role)) {
      return res.status(403).json({
        success: false,
        message: "Only workspace owners and admins can modify member status"
      });
    }

    const targetMembership = await Membership.findOne({
      userId: memberUserId,
      tenantId: workspaceId
    });

    if (!targetMembership) {
      return res.status(404).json({
        success: false,
        message: "Membership not found"
      });
    }

    // Owner protection: Workspace owner can NEVER be suspended or have status modified
    if (targetMembership.role === "owner") {
      return res.status(403).json({
        success: false,
        message: "Workspace owner cannot be suspended or have status modified"
      });
    }

    // Self-protection: A user cannot modify their own status
    if (req.user.userId.toString() === memberUserId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Users cannot modify their own membership status"
      });
    }

    // Admin vs Admin protection: Admins cannot suspend or modify other admins
    if (callerMembership.role === "admin" && targetMembership.role === "admin") {
      return res.status(403).json({
        success: false,
        message: "Admins cannot modify other admins' status"
      });
    }

    targetMembership.status = normalizedStatus;
    await targetMembership.save();

    const targetUser = await User.findById(memberUserId);

    return res.status(200).json({
      success: true,
      message: `Member ${normalizedStatus === "suspended" ? "suspended" : "reactivated"} successfully`,
      data: {
        member: {
          userId: targetMembership.userId,
          name: targetUser ? targetUser.name : "",
          email: targetUser ? targetUser.email : "",
          role: targetMembership.role,
          status: targetMembership.status,
          joinedAt: targetMembership.createdAt,
          updatedAt: targetMembership.updatedAt
        }
      }
    });
  } catch (error) {
    console.error("Modify workspace member status error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to modify member status"
    });
  }
}

// In-process concurrency mutex for user-level critical sections (e.g. self-leave)
const userLocks = new Map();

export async function withUserLock(userId, fn) {
  const key = userId.toString();
  while (userLocks.has(key)) {
    await userLocks.get(key);
  }
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  userLocks.set(key, promise);
  try {
    return await fn();
  } finally {
    userLocks.delete(key);
    resolve();
  }
}

// In-process concurrency mutex for workspace-level critical sections (e.g. transfer-ownership)
const workspaceLocks = new Map();

export async function withWorkspaceLock(workspaceId, fn) {
  const key = workspaceId.toString();
  while (workspaceLocks.has(key)) {
    await workspaceLocks.get(key);
  }
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  workspaceLocks.set(key, promise);
  try {
    return await fn();
  } finally {
    workspaceLocks.delete(key);
    resolve();
  }
}

/**
 * Transfer workspace ownership to an active member.
 * Post-condition:
 * - Current owner becomes an active admin
 * - Target member becomes the active owner
 * - Invariant: Exactly one active owner per workspace
 */
export async function transferOwnership(req, res) {
  try {
    const { id: workspaceId } = req.params;
    const { memberUserId } = req.body || {};

    if (!workspaceId || !mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({
        success: false,
        message: "A valid workspace ID is required"
      });
    }

    if (!memberUserId || !mongoose.Types.ObjectId.isValid(memberUserId)) {
      return res.status(400).json({
        success: false,
        message: "A valid target member user ID is required"
      });
    }

    const callerUserId = req.user.userId;

    // Self-transfer is disallowed
    if (callerUserId.toString() === memberUserId.toString()) {
      return res.status(400).json({
        success: false,
        message: "Cannot transfer ownership to yourself"
      });
    }

    return await withWorkspaceLock(workspaceId, async () => {
      // 1. Verify workspace exists and is not archived
      const workspace = await Tenant.findById(workspaceId);
      if (!workspace) {
        return res.status(404).json({
          success: false,
          message: "Workspace not found"
        });
      }

      if (workspace.status === "archived") {
        return res.status(403).json({
          success: false,
          message: "Access denied: workspace is archived or inactive"
        });
      }

      // 2. Verify caller's membership and owner role in this workspace
      const callerMembership = await Membership.findOne({
        userId: callerUserId,
        tenantId: workspaceId
      });

      if (!callerMembership) {
        return res.status(403).json({
          success: false,
          message: "Access denied: you are not a member of this workspace"
        });
      }

      if (callerMembership.status !== "active") {
        return res.status(403).json({
          success: false,
          message: "Access denied: your workspace membership is suspended or inactive"
        });
      }

      if (callerMembership.role !== "owner") {
        return res.status(403).json({
          success: false,
          message: "Forbidden: only the workspace owner can transfer ownership"
        });
      }

      // 3. Verify target member existence in this workspace
      const targetMembership = await Membership.findOne({
        userId: memberUserId,
        tenantId: workspaceId
      });

      if (!targetMembership) {
        return res.status(404).json({
          success: false,
          message: "Target member not found in this workspace"
        });
      }

      if (targetMembership.status !== "active") {
        return res.status(400).json({
          success: false,
          message: "Cannot transfer ownership to a suspended or inactive member"
        });
      }

      if (targetMembership.role === "owner") {
        return res.status(400).json({
          success: false,
          message: "Target member is already the owner of this workspace"
        });
      }

      // 4. Atomic role transition:
      // Current owner becomes admin
      callerMembership.role = "admin";
      await callerMembership.save();

      // Target member becomes owner
      targetMembership.role = "owner";
      await targetMembership.save();

      const [callerUser, targetUser] = await Promise.all([
        User.findById(callerUserId),
        User.findById(memberUserId)
      ]);

      return res.status(200).json({
        success: true,
        message: "Workspace ownership transferred successfully",
        data: {
          workspace: {
            id: workspace._id,
            name: workspace.name
          },
          previousOwner: {
            userId: callerMembership.userId,
            name: callerUser ? callerUser.name : "",
            email: callerUser ? callerUser.email : "",
            role: callerMembership.role
          },
          newOwner: {
            userId: targetMembership.userId,
            name: targetUser ? targetUser.name : "",
            email: targetUser ? targetUser.email : "",
            role: targetMembership.role
          }
        }
      });
    });
  } catch (error) {
    console.error("Transfer workspace ownership error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to transfer workspace ownership"
    });
  }
}

export async function leaveWorkspace(req, res) {
  try {
    const { id: workspaceId } = req.params;

    if (!workspaceId || !mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({
        success: false,
        message: "A valid workspace ID is required"
      });
    }

    const userId = req.user.userId;

    return await withUserLock(userId, async () => {
      // 1. Verify target membership in the specified workspace
      const targetMembership = await Membership.findOne({
        userId,
        tenantId: workspaceId
      });

      if (!targetMembership) {
        return res.status(403).json({
          success: false,
          message: "Access denied: you are not a member of this workspace"
        });
      }

      if (targetMembership.status !== "active") {
        return res.status(403).json({
          success: false,
          message: "Access denied: your workspace membership is suspended or inactive"
        });
      }

      // 2. Critical owner protection: Workspace owners can NEVER self-leave
      if (targetMembership.role === "owner") {
        return res.status(403).json({
          success: false,
          message: "Workspace owners cannot leave the workspace. Ownership must be transferred or workspace archived."
        });
      }

      // 3. Last-workspace protection: User must retain at least one active workspace
      const activeMemberships = await Membership.find({
        userId,
        status: "active"
      });

      const otherMemberships = activeMemberships.filter(
        (m) => m.tenantId.toString() !== workspaceId.toString()
      );

      let fallbackMembership = null;
      let fallbackTenant = null;

      for (const m of otherMemberships) {
        const tenant = await Tenant.findById(m.tenantId);
        if (tenant && tenant.status !== "archived") {
          fallbackMembership = m;
          fallbackTenant = tenant;
          break;
        }
      }

      if (!fallbackMembership || !fallbackTenant) {
        return res.status(409).json({
          success: false,
          message: "Cannot leave your only active workspace. A user must retain at least one active workspace."
        });
      }

      // 4. Remove the user's membership from the departed workspace
      await Membership.findByIdAndDelete(targetMembership._id);

      // 5. Update User.tenantId pointer if it pointed to the departed workspace
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      let activeTenant = fallbackTenant;
      let activeRole = fallbackMembership.role;
      let switched = false;

      if (user.tenantId && user.tenantId.toString() === workspaceId.toString()) {
        user.tenantId = fallbackTenant._id;
        await user.save();
        switched = true;
      } else {
        const currentTenant = await Tenant.findById(user.tenantId);
        const currentMembership = await Membership.findOne({
          userId,
          tenantId: user.tenantId,
          status: "active"
        });
        if (currentTenant && currentMembership) {
          activeTenant = currentTenant;
          activeRole = currentMembership.role;
        } else {
          user.tenantId = fallbackTenant._id;
          await user.save();
          switched = true;
        }
      }

      // 6. Sign fresh JWT scoped to the active workspace context
      const token = jwt.sign(
        {
          userId: user._id.toString(),
          tenantId: activeTenant._id.toString()
        },
        process.env.JWT_SECRET,
        {
          expiresIn: "1d"
        }
      );

      return res.status(200).json({
        success: true,
        message: "Left workspace successfully",
        data: {
          leftWorkspaceId: workspaceId,
          token,
          switched,
          activeWorkspace: {
            id: activeTenant._id,
            name: activeTenant.name,
            type: activeTenant.type || "organization",
            role: activeRole
          }
        }
      });
    });
  } catch (error) {
    console.error("Leave workspace error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to leave workspace"
    });
  }
}

export async function archiveWorkspace(req, res) {
  try {
    const { id: workspaceId } = req.params;

    if (!workspaceId || !mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({
        success: false,
        message: "A valid workspace ID is required"
      });
    }

    const userId = req.user.userId;

    return await withUserLock(userId, async () => {
      // 1. Caller must be an active member with role 'owner' in this workspace
      const callerMembership = await Membership.findOne({
        userId,
        tenantId: workspaceId
      });

      if (!callerMembership) {
        return res.status(403).json({
          success: false,
          message: "Access denied: you are not a member of this workspace"
        });
      }

      if (callerMembership.status !== "active") {
        return res.status(403).json({
          success: false,
          message: "Access denied: your workspace membership is suspended or inactive"
        });
      }

      if (callerMembership.role !== "owner") {
        return res.status(403).json({
          success: false,
          message: "Forbidden: only the workspace owner can archive this workspace"
        });
      }

      const workspace = await Tenant.findById(workspaceId);
      if (!workspace) {
        return res.status(404).json({
          success: false,
          message: "Workspace not found"
        });
      }

      // Idempotency: If already archived, return deterministic 200 without altering state
      if (workspace.status === "archived") {
        return res.status(200).json({
          success: true,
          message: "Workspace is already archived",
          data: {
            workspace: {
              id: workspace._id,
              name: workspace.name,
              status: "archived",
              archivedAt: workspace.archivedAt
            },
            alreadyArchived: true
          }
        });
      }

      // 2. Last-active-workspace invariant: Owner cannot archive their only active workspace
      const activeMemberships = await Membership.find({
        userId,
        status: "active"
      });

      const otherMemberships = activeMemberships.filter(
        (m) => m.tenantId.toString() !== workspaceId.toString()
      );

      let fallbackMembership = null;
      let fallbackTenant = null;

      for (const m of otherMemberships) {
        const candidate = await Tenant.findById(m.tenantId);
        if (candidate && candidate.status !== "archived") {
          fallbackMembership = m;
          fallbackTenant = candidate;
          break;
        }
      }

      if (!fallbackMembership || !fallbackTenant) {
        return res.status(409).json({
          success: false,
          message: "Cannot archive your only active workspace. A user must retain at least one active workspace."
        });
      }

      // 3. Soft-archive workspace: preserve all historical billing, usage, and service records
      workspace.status = "archived";
      workspace.archivedAt = new Date();
      await workspace.save();

      // 4. Update session and issue fresh scoped JWT if currently scoped to the archived workspace
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      let activeTenant = fallbackTenant;
      let activeRole = fallbackMembership.role;
      let switched = false;
      let token = null;

      if (user.tenantId && user.tenantId.toString() === workspaceId.toString()) {
        user.tenantId = fallbackTenant._id;
        await user.save();
        switched = true;

        token = jwt.sign(
          {
            userId: user._id.toString(),
            tenantId: fallbackTenant._id.toString()
          },
          process.env.JWT_SECRET,
          {
            expiresIn: "1d"
          }
        );
      } else {
        const currentTenant = await Tenant.findById(user.tenantId);
        const currentMembership = await Membership.findOne({
          userId,
          tenantId: user.tenantId,
          status: "active"
        });

        if (currentTenant && currentTenant.status !== "archived" && currentMembership) {
          activeTenant = currentTenant;
          activeRole = currentMembership.role;
        } else {
          user.tenantId = fallbackTenant._id;
          await user.save();
          switched = true;

          token = jwt.sign(
            {
              userId: user._id.toString(),
              tenantId: fallbackTenant._id.toString()
            },
            process.env.JWT_SECRET,
            {
              expiresIn: "1d"
            }
          );
        }
      }

      return res.status(200).json({
        success: true,
        message: "Workspace archived successfully",
        data: {
          archivedWorkspaceId: workspaceId,
          token,
          switched,
          activeWorkspace: {
            id: activeTenant._id,
            name: activeTenant.name,
            type: activeTenant.type || "organization",
            role: activeRole
          }
        }
      });
    });
  } catch (error) {
    console.error("Archive workspace error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to archive workspace"
    });
  }
}
