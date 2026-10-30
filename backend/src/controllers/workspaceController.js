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
      .filter((m) => m.tenantId)
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

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Workspace name is required"
      });
    }

    const normalizedName = name.trim();
    const chosenType = (type || "organization").trim().toLowerCase();

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
      status: "active"
    }).populate("userId", "name email");

    const members = memberships
      .filter((m) => m.userId)
      .map((m) => ({
        userId: m.userId._id,
        name: m.userId.name,
        email: m.userId.email,
        role: m.role,
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

export async function addWorkspaceMember(req, res) {
  try {
    const { id: workspaceId } = req.params;
    const { email, role } = req.body;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid workspace ID"
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Member email is required"
      });
    }

    const chosenRole = (role || "member").trim().toLowerCase();
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
