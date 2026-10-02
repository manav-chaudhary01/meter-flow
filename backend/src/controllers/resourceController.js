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

    if (Number(price) < 0) {
      return res.status(400).json({
        success: false,
        message: "Price cannot be negative"
      });
    }

    const resource = await Resource.create({
      tenantId: req.user.tenantId,
      name: name.trim(),
      unit: unit.trim(),
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