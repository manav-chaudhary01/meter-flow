import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import Membership from "../models/Membership.js";

export async function register(req, res) {
  let createdTenant = null;
  let createdMembership = null;

  try {
    const { name, email, password, organizationName, workspaceName, workspaceType } = req.body;

    const chosenWorkspaceName = (organizationName || workspaceName || "").trim();
    const chosenType = (workspaceType || (organizationName ? "organization" : "personal")).trim().toLowerCase();

    if (!name || !email || !password || !chosenWorkspaceName) {
      return res.status(400).json({
        success: false,
        message:
          "Name, email, password and organization/workspace name are required"
      });
    }

    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long"
      });
    }

    if (!["personal", "organization"].includes(chosenType)) {
      return res.status(400).json({
        success: false,
        message: "Workspace type must be either 'personal' or 'organization'"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await User.findOne({
      email: normalizedEmail
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "A user with this email already exists"
      });
    }

    // 1. Create workspace / tenant
    createdTenant = await Tenant.create({
      name: chosenWorkspaceName,
      type: chosenType
    });

    const passwordHash = await bcrypt.hash(password, 12);

    // 2. Create user with reference to initial active workspace
    const user = await User.create({
      tenantId: createdTenant._id,
      name: name.trim(),
      email: normalizedEmail,
      passwordHash
    });

    // Link workspace createdBy to user
    createdTenant.createdBy = user._id;
    await createdTenant.save();

    // 3. Create initial membership as owner
    createdMembership = await Membership.create({
      userId: user._id,
      tenantId: createdTenant._id,
      role: "owner",
      status: "active"
    });

    const token = jwt.sign(
      {
        userId: user._id.toString(),
        tenantId: createdTenant._id.toString()
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1d"
      }
    );

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          tenantId: user.tenantId
        },
        tenant: {
          id: createdTenant._id,
          name: createdTenant.name,
          type: createdTenant.type
        }
      }
    });
  } catch (error) {
    console.error("Registration error:", error);

    // Rollback orphaned documents if partial failure occurs
    if (createdMembership?._id) {
      await Membership.findByIdAndDelete(createdMembership._id).catch(() => {});
    }
    if (createdTenant?._id) {
      await Tenant.findByIdAndDelete(createdTenant._id).catch(() => {});
    }

    return res.status(500).json({
      success: false,
      message: "Registration failed"
    });
  }
}

export async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({
      email: normalizedEmail
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const tenant = await Tenant.findById(user.tenantId);

    if (!tenant) {
      return res.status(500).json({
        success: false,
        message: "Associated organization not found"
      });
    }

    // Ensure membership exists for active workspace
    let membership = await Membership.findOne({
      userId: user._id,
      tenantId: user.tenantId,
      status: "active"
    });

    if (!membership) {
      membership = await Membership.create({
        userId: user._id,
        tenantId: user.tenantId,
        role: "owner",
        status: "active"
      }).catch(() => null);
    }

    const token = jwt.sign(
      {
        userId: user._id.toString(),
        tenantId: user.tenantId.toString()
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1d"
      }
    );

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          tenantId: user.tenantId
        },
        tenant: {
          id: tenant._id,
          name: tenant.name,
          type: tenant.type || "organization"
        }
      }
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      success: false,
      message: "Login failed"
    });
  }
}
