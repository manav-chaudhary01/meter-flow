import mongoose from "mongoose";
import Invitation from "../models/Invitation.js";
import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import Membership from "../models/Membership.js";
import { generateToken, hashToken, isValidTokenFormat } from "../utils/invitationToken.js";
import { withWorkspaceLock } from "./workspaceController.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITATION_EXPIRY_DAYS = 7;

/**
 * Creates a new invitation for a workspace.
 * POST /api/workspaces/:id/invitations
 * Caller must be owner or admin.
 */
export async function createWorkspaceInvitation(req, res) {
  try {
    const { id: workspaceId } = req.params;
    const { email, role } = req.body;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid workspace ID format"
      });
    }

    // Caller must be owner or admin of this workspace
    const callerMembership = await Membership.findOne({
      userId: req.user.userId,
      tenantId: workspaceId,
      status: "active"
    });

    if (!callerMembership || !["owner", "admin"].includes(callerMembership.role)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: only workspace owners and admins can send invitations"
      });
    }

    // Verify workspace exists and is active
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
        message: "Cannot create invitations for an archived workspace"
      });
    }

    if (workspace.type === "personal") {
      return res.status(400).json({
        success: false,
        message: "Personal workspaces cannot invite team members"
      });
    }

    // Validate email
    if (!email || typeof email !== "string") {
      return res.status(400).json({
        success: false,
        message: "A valid email address is required"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "A valid email address is required"
      });
    }

    // Validate role (defaults to member)
    const chosenRole = (role || "member").trim().toLowerCase();
    if (!["admin", "member"].includes(chosenRole)) {
      return res.status(400).json({
        success: false,
        message: "Role must be either 'admin' or 'member'"
      });
    }

    // Check if target user is already an active member of this workspace
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      const existingMembership = await Membership.findOne({
        userId: existingUser._id,
        tenantId: workspaceId,
        status: "active"
      });

      if (existingMembership) {
        return res.status(409).json({
          success: false,
          message: "User is already an active member of this workspace"
        });
      }
    }

    // Check for existing pending invitation for this workspace and email
    const existingPendingInvite = await Invitation.findOne({
      tenantId: workspaceId,
      email: normalizedEmail,
      status: "pending"
    });

    if (existingPendingInvite) {
      if (existingPendingInvite.expiresAt < new Date()) {
        existingPendingInvite.status = "expired";
        await existingPendingInvite.save();
      } else {
        return res.status(409).json({
          success: false,
          message: "A pending invitation already exists for this email address"
        });
      }
    }

    // Generate cryptographically secure token and its SHA-256 hash
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const invitation = await Invitation.create({
      tenantId: workspaceId,
      invitedBy: req.user.userId,
      email: normalizedEmail,
      role: chosenRole,
      status: "pending",
      tokenHash,
      expiresAt
    });

    return res.status(201).json({
      success: true,
      message: "Invitation sent successfully",
      data: {
        invitation: {
          id: invitation._id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt
        },
        invitationToken: rawToken,
        invitationUrl: `/accept-invite.html?token=${rawToken}`
      }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A pending invitation already exists for this email address"
      });
    }
    console.error("Create workspace invitation error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create invitation"
    });
  }
}

/**
 * Lists all invitations for a workspace.
 * GET /api/workspaces/:id/invitations
 * Caller must be owner or admin.
 */
export async function listWorkspaceInvitations(req, res) {
  try {
    const { id: workspaceId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid workspace ID format"
      });
    }

    // Caller must be owner or admin of this workspace
    const callerMembership = await Membership.findOne({
      userId: req.user.userId,
      tenantId: workspaceId,
      status: "active"
    });

    if (!callerMembership || !["owner", "admin"].includes(callerMembership.role)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: only workspace owners and admins can view invitations"
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
        message: "Cannot view invitations for an archived workspace"
      });
    }

    // Lazily mark expired pending invitations
    await Invitation.updateMany(
      {
        tenantId: workspaceId,
        status: "pending",
        expiresAt: { $lt: new Date() }
      },
      { $set: { status: "expired" } }
    );

    const query = { tenantId: workspaceId };
    if (req.query.status) {
      query.status = req.query.status.trim().toLowerCase();
    }

    const invitations = await Invitation.find(query)
      .populate("invitedBy", "name email")
      .sort({ createdAt: -1 });

    const sanitized = invitations.map((inv) => ({
      id: inv._id,
      email: inv.email,
      role: inv.role,
      status: inv.status,
      expiresAt: inv.expiresAt,
      createdAt: inv.createdAt,
      invitedBy: inv.invitedBy
        ? {
            id: inv.invitedBy._id,
            name: inv.invitedBy.name,
            email: inv.invitedBy.email
          }
        : null,
      acceptedAt: inv.acceptedAt,
      declinedAt: inv.declinedAt,
      cancelledAt: inv.cancelledAt
    }));

    return res.status(200).json({
      success: true,
      count: sanitized.length,
      data: {
        invitations: sanitized
      }
    });
  } catch (error) {
    console.error("List workspace invitations error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to list invitations"
    });
  }
}

/**
 * Cancels a pending invitation.
 * PATCH /api/workspaces/:id/invitations/:invitationId/cancel
 * Caller must be owner or admin.
 */
export async function cancelWorkspaceInvitation(req, res) {
  try {
    const { id: workspaceId, invitationId } = req.params;

    if (
      !mongoose.Types.ObjectId.isValid(workspaceId) ||
      !mongoose.Types.ObjectId.isValid(invitationId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid workspace or invitation ID format"
      });
    }

    // Caller must be owner or admin of this workspace
    const callerMembership = await Membership.findOne({
      userId: req.user.userId,
      tenantId: workspaceId,
      status: "active"
    });

    if (!callerMembership || !["owner", "admin"].includes(callerMembership.role)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: only workspace owners and admins can cancel invitations"
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
        message: "Cannot modify invitations for an archived workspace"
      });
    }

    const invitation = await Invitation.findOne({
      _id: invitationId,
      tenantId: workspaceId
    });

    if (!invitation) {
      return res.status(404).json({
        success: false,
        message: "Invitation not found"
      });
    }

    if (invitation.status === "accepted") {
      return res.status(400).json({
        success: false,
        message: "Cannot cancel an invitation that has already been accepted"
      });
    }

    if (invitation.status === "declined") {
      return res.status(400).json({
        success: false,
        message: "Cannot cancel an invitation that has already been declined"
      });
    }

    if (invitation.status === "cancelled") {
      return res.status(400).json({
        success: false,
        message: "Invitation has already been cancelled"
      });
    }

    if (invitation.status === "expired" || invitation.expiresAt < new Date()) {
      invitation.status = "expired";
      await invitation.save();
      return res.status(400).json({
        success: false,
        message: "Invitation has expired and cannot be cancelled"
      });
    }

    invitation.status = "cancelled";
    invitation.cancelledAt = new Date();
    invitation.cancelledBy = req.user.userId;
    await invitation.save();

    return res.status(200).json({
      success: true,
      message: "Invitation cancelled successfully",
      data: {
        invitation: {
          id: invitation._id,
          email: invitation.email,
          status: invitation.status,
          cancelledAt: invitation.cancelledAt
        }
      }
    });
  } catch (error) {
    console.error("Cancel workspace invitation error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to cancel invitation"
    });
  }
}

/**
 * Inspects invitation details by token.
 * GET /api/invitations/:token
 * Public/authenticated endpoint for recipient inspection.
 */
export async function getInvitationByToken(req, res) {
  try {
    const { token } = req.params;

    if (!isValidTokenFormat(token)) {
      return res.status(400).json({
        success: false,
        message: "Invalid invitation token format"
      });
    }

    const tokenHash = hashToken(token);
    const invitation = await Invitation.findOne({ tokenHash })
      .populate("tenantId", "name type status")
      .populate("invitedBy", "name email");

    if (!invitation) {
      return res.status(404).json({
        success: false,
        message: "Invitation not found"
      });
    }

    if (!invitation.tenantId || invitation.tenantId.status === "archived") {
      return res.status(403).json({
        success: false,
        message: "The workspace for this invitation has been archived or is inactive"
      });
    }

    // Auto-update expired status if past expiration date
    if (invitation.status === "pending" && invitation.expiresAt < new Date()) {
      invitation.status = "expired";
      await invitation.save();
    }

    return res.status(200).json({
      success: true,
      data: {
        invitation: {
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          workspace: {
            id: invitation.tenantId._id,
            name: invitation.tenantId.name,
            type: invitation.tenantId.type
          },
          invitedBy: invitation.invitedBy
            ? {
                name: invitation.invitedBy.name,
                email: invitation.invitedBy.email
              }
            : null
        }
      }
    });
  } catch (error) {
    console.error("Get invitation by token error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve invitation"
    });
  }
}

/**
 * Accepts a pending invitation.
 * POST /api/invitations/:token/accept
 * Requires authenticated user whose email matches the invitation.
 */
export async function acceptInvitation(req, res) {
  try {
    const { token } = req.params;

    if (!isValidTokenFormat(token)) {
      return res.status(400).json({
        success: false,
        message: "Invalid invitation token format"
      });
    }

    const tokenHash = hashToken(token);
    const invitation = await Invitation.findOne({ tokenHash });

    if (!invitation) {
      return res.status(404).json({
        success: false,
        message: "Invitation not found"
      });
    }

    if (invitation.status === "accepted") {
      return res.status(400).json({
        success: false,
        message: "Invitation has already been accepted"
      });
    }

    if (invitation.status === "declined") {
      return res.status(400).json({
        success: false,
        message: "Invitation has been declined"
      });
    }

    if (invitation.status === "cancelled") {
      return res.status(400).json({
        success: false,
        message: "Invitation has been cancelled"
      });
    }

    if (invitation.status === "expired" || invitation.expiresAt < new Date()) {
      invitation.status = "expired";
      await invitation.save();
      return res.status(400).json({
        success: false,
        message: "Invitation has expired"
      });
    }

    // Verify workspace is still active
    const workspace = await Tenant.findById(invitation.tenantId);
    if (!workspace || workspace.status === "archived") {
      return res.status(403).json({
        success: false,
        message: "Workspace is archived and cannot accept new members"
      });
    }

    // Verify authenticated user identity & email match
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User account not found"
      });
    }

    if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      return res.status(403).json({
        success: false,
        message: "Access denied: this invitation was sent to a different email address"
      });
    }

    // Check if user is already an active member of this workspace
    const existingMembership = await Membership.findOne({
      userId: user._id,
      tenantId: invitation.tenantId
    });

    if (existingMembership && existingMembership.status === "active") {
      return res.status(409).json({
        success: false,
        message: "You are already a member of this workspace"
      });
    }

    // Wrap atomic state transition in workspace mutex to serialize concurrent acceptance
    return await withWorkspaceLock(invitation.tenantId.toString(), async () => {
      // Re-verify invitation status atomically
      const updatedInvite = await Invitation.findOneAndUpdate(
        { _id: invitation._id, status: "pending" },
        {
          $set: {
            status: "accepted",
            acceptedAt: new Date(),
            acceptedBy: user._id
          }
        },
        { returnDocument: "after" }
      );

      if (!updatedInvite) {
        return res.status(400).json({
          success: false,
          message: "Invitation has already been accepted"
        });
      }

      // Upsert/activate membership atomically
      let membership;
      if (existingMembership) {
        existingMembership.role = invitation.role;
        existingMembership.status = "active";
        membership = await existingMembership.save();
      } else {
        membership = await Membership.create({
          userId: user._id,
          tenantId: invitation.tenantId,
          role: invitation.role,
          status: "active"
        });
      }

      return res.status(200).json({
        success: true,
        message: "Invitation accepted successfully",
        data: {
          workspace: {
            id: workspace._id,
            name: workspace.name,
            type: workspace.type
          },
          membership: {
            userId: user._id,
            role: membership.role,
            status: membership.status
          }
        }
      });
    });
  } catch (error) {
    console.error("Accept invitation error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to accept invitation"
    });
  }
}

/**
 * Declines a pending invitation.
 * POST /api/invitations/:token/decline
 */
export async function declineInvitation(req, res) {
  try {
    const { token } = req.params;

    if (!isValidTokenFormat(token)) {
      return res.status(400).json({
        success: false,
        message: "Invalid invitation token format"
      });
    }

    const tokenHash = hashToken(token);
    const invitation = await Invitation.findOne({ tokenHash });

    if (!invitation) {
      return res.status(404).json({
        success: false,
        message: "Invitation not found"
      });
    }

    if (invitation.status === "accepted") {
      return res.status(400).json({
        success: false,
        message: "Cannot decline an invitation that has already been accepted"
      });
    }

    if (invitation.status === "declined") {
      return res.status(400).json({
        success: false,
        message: "Invitation has already been declined"
      });
    }

    if (invitation.status === "cancelled") {
      return res.status(400).json({
        success: false,
        message: "Invitation has been cancelled"
      });
    }

    if (invitation.status === "expired" || invitation.expiresAt < new Date()) {
      invitation.status = "expired";
      await invitation.save();
      return res.status(400).json({
        success: false,
        message: "Invitation has expired"
      });
    }

    // If caller is authenticated, verify email match
    if (req.user && req.user.userId) {
      const user = await User.findById(req.user.userId);
      if (user && user.email.toLowerCase() !== invitation.email.toLowerCase()) {
        return res.status(403).json({
          success: false,
          message: "Access denied: you cannot decline an invitation sent to another email"
        });
      }
    }

    invitation.status = "declined";
    invitation.declinedAt = new Date();
    await invitation.save();

    return res.status(200).json({
      success: true,
      message: "Invitation declined successfully",
      data: {
        invitation: {
          status: "declined",
          declinedAt: invitation.declinedAt
        }
      }
    });
  } catch (error) {
    console.error("Decline invitation error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to decline invitation"
    });
  }
}
