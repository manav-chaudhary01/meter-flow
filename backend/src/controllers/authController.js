import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Tenant from "../models/Tenant.js";
import User from "../models/User.js";

export async function register(req, res) {
  try {
    const { name, email, password, organizationName } = req.body;

    if (!name || !email || !password || !organizationName) {
      return res.status(400).json({
        success: false,
        message:
          "Name, email, password and organization name are required"
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

    const tenant = await Tenant.create({
      name: organizationName.trim()
    });

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await User.create({
      tenantId: tenant._id,
      name: name.trim(),
      email: normalizedEmail,
      passwordHash
    });

    const token = jwt.sign(
      {
        userId: user._id.toString(),
        tenantId: tenant._id.toString()
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
          id: tenant._id,
          name: tenant.name
        }
      }
    });
  } catch (error) {
    console.error("Registration error:", error);

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
          name: tenant.name
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