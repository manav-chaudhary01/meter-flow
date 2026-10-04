import mongoose from "mongoose";
import Resource from "../models/Resource.js";

export async function createResource(req, res) {
  try {
    const { name, unit, price } = req.body;

    if (!name || !unit || price === undefined) {
      return res.status(400).json({
        success: false,
        message: "Name, unit and price are required"
      });
    }

    const normalizedName = name.trim();
    const normalizedUnit = unit.trim();
    const priceNumber = Number(price);

    if (!normalizedName || !normalizedUnit) {
      return res.status(400).json({
        success: false,
        message: "Name and unit cannot be empty"
      });
    }

    if (!Number.isFinite(priceNumber) || priceNumber < 0) {
      return res.status(400).json({
        success: false,
        message: "Price must be a valid non-negative number"
      });
    }

    const resource = await Resource.create({
      tenantId: req.user.tenantId,
      name: normalizedName,
      unit: normalizedUnit,
      price
    });

    return res.status(201).json({
      success: true,
      message: "Resource created successfully",
      data: {
        resource
      }
    });
  } catch (error) {
    console.error("Create resource error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create resource"
    });
  }
}

export async function getResources(req, res) {
  try {
    const resources = await Resource.find({
      tenantId: req.user.tenantId
    }).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: {
        resources
      }
    });
  } catch (error) {
    console.error("Get resources error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch resources"
    });
  }
}

export async function getResourceById(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid resource ID"
      });
    }

    const resource = await Resource.findOne({
      _id: id,
      tenantId: req.user.tenantId
    });

    if (!resource) {
      return res.status(404).json({
        success: false,
        message: "Resource not found"
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        resource
      }
    });
  } catch (error) {
    console.error("Get resource by ID error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch resource"
    });
  }
}

export async function updateResource(req, res) {
  try {
    const { id } = req.params;
    const { name, unit, price } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid resource ID"
      });
    }

    if (!name || !unit || price === undefined) {
      return res.status(400).json({
        success: false,
        message: "Name, unit and price are required"
      });
    }

    const normalizedName = name.trim();
    const normalizedUnit = unit.trim();
    const priceNumber = Number(price);

    if (!normalizedName || !normalizedUnit) {
      return res.status(400).json({
        success: false,
        message: "Name and unit cannot be empty"
      });
    }

    if (!Number.isFinite(priceNumber) || priceNumber < 0) {
      return res.status(400).json({
        success: false,
        message: "Price must be a valid non-negative number"
      });
    }

    const resource = await Resource.findOneAndUpdate(
      {
        _id: id,
        tenantId: req.user.tenantId
      },
      {
        name: normalizedName,
        unit: normalizedUnit,
        price
      },
      {
        new: true,
        runValidators: true
      }
    );

    if (!resource) {
      return res.status(404).json({
        success: false,
        message: "Resource not found"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Resource updated successfully",
      data: {
        resource
      }
    });
  } catch (error) {
    console.error("Update resource error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update resource"
    });
  }
}

export async function deleteResource(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid resource ID"
      });
    }

    const resource = await Resource.findOneAndDelete({
      _id: id,
      tenantId: req.user.tenantId
    });

    if (!resource) {
      return res.status(404).json({
        success: false,
        message: "Resource not found"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Resource deleted successfully"
    });
  } catch (error) {
    console.error("Delete resource error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete resource"
    });
  }
}