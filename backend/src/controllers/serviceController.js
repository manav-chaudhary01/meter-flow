import mongoose from "mongoose";
import Decimal from "decimal.js";
import TrackedService from "../models/TrackedService.js";

function parseDecimal(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return { error: `${fieldName} is required` };
  }
  try {
    const d = new Decimal(value);
    if (!d.isFinite() || d.isNaN()) {
      return { error: `${fieldName} must be a valid finite number` };
    }
    if (d.isNegative()) {
      return { error: `${fieldName} must be a non-negative amount` };
    }
    return { value: d.toString() };
  } catch {
    return { error: `${fieldName} must be a valid numeric decimal` };
  }
}

function formatService(svc) {
  if (!svc) return null;
  const doc = svc.toObject ? svc.toObject() : svc;
  return {
    id: doc._id,
    tenantId: doc.tenantId,
    name: doc.name,
    provider: doc.provider || "",
    category: doc.category || "general",
    trackingType: doc.trackingType,
    currency: doc.currency,
    unit: doc.unit || null,
    unitPrice: doc.unitPrice ? (doc.unitPrice.$numberDecimal || doc.unitPrice.toString()) : null,
    subscriptionAmount: doc.subscriptionAmount
      ? (doc.subscriptionAmount.$numberDecimal || doc.subscriptionAmount.toString())
      : null,
    billingInterval: doc.billingInterval || null,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

export async function createService(req, res) {
  try {
    const {
      name,
      provider,
      category,
      trackingType,
      currency,
      unit,
      unitPrice,
      subscriptionAmount,
      billingInterval
    } = req.body;

    if (!name || typeof name !== "string") {
      return res.status(400).json({
        success: false,
        message: "Service name is required"
      });
    }

    const normalizedName = name.trim();
    if (normalizedName.length < 2 || normalizedName.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Service name must be between 2 and 100 characters"
      });
    }

    if (!["metered", "subscription", "hybrid"].includes(trackingType)) {
      return res.status(400).json({
        success: false,
        message: "Tracking type must be 'metered', 'subscription', or 'hybrid'"
      });
    }

    const normalizedCurrency = (currency || "USD").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
      return res.status(400).json({
        success: false,
        message: "Currency must be a valid 3-letter ISO code"
      });
    }

    const serviceData = {
      tenantId: req.user.tenantId,
      name: normalizedName,
      provider: provider ? provider.trim() : "",
      category: category ? category.trim() : "general",
      trackingType,
      currency: normalizedCurrency,
      status: "active"
    };

    if (trackingType === "metered" || trackingType === "hybrid") {
      if (!unit || typeof unit !== "string" || !unit.trim()) {
        return res.status(400).json({
          success: false,
          message: `Unit is required for ${trackingType} services`
        });
      }
      serviceData.unit = unit.trim();

      const parsedUnitPrice = parseDecimal(unitPrice, "Unit price");
      if (parsedUnitPrice.error) {
        return res.status(400).json({
          success: false,
          message: parsedUnitPrice.error
        });
      }
      serviceData.unitPrice = parsedUnitPrice.value;
    }

    if (trackingType === "subscription" || trackingType === "hybrid") {
      const parsedSub = parseDecimal(subscriptionAmount, "Subscription amount");
      if (parsedSub.error) {
        return res.status(400).json({
          success: false,
          message: parsedSub.error
        });
      }
      serviceData.subscriptionAmount = parsedSub.value;

      const chosenInterval = (billingInterval || "monthly").trim().toLowerCase();
      if (!["daily", "monthly", "quarterly", "yearly"].includes(chosenInterval)) {
        return res.status(400).json({
          success: false,
          message: "Billing interval must be 'daily', 'monthly', 'quarterly', or 'yearly'"
        });
      }
      serviceData.billingInterval = chosenInterval;
    }

    const service = await TrackedService.create(serviceData);

    return res.status(201).json({
      success: true,
      message: "Tracked service created successfully",
      data: {
        service: formatService(service)
      }
    });
  } catch (error) {
    console.error("Create service error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create tracked service"
    });
  }
}

export async function getServices(req, res) {
  try {
    const { status, trackingType, category } = req.query;

    const filter = {
      tenantId: req.user.tenantId
    };

    if (status && status !== "all") {
      if (!["active", "archived"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Status filter must be 'active', 'archived', or 'all'"
        });
      }
      filter.status = status;
    } else if (!status) {
      filter.status = "active";
    }

    if (trackingType) {
      if (!["metered", "subscription", "hybrid"].includes(trackingType)) {
        return res.status(400).json({
          success: false,
          message: "Invalid trackingType filter"
        });
      }
      filter.trackingType = trackingType;
    }

    if (category) {
      filter.category = category.trim();
    }

    const services = await TrackedService.find(filter).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: {
        services: services.map(formatService)
      }
    });
  } catch (error) {
    console.error("Get services error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch services"
    });
  }
}

export async function getServiceById(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid service ID"
      });
    }

    const service = await TrackedService.findOne({
      _id: id,
      tenantId: req.user.tenantId
    });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found"
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        service: formatService(service)
      }
    });
  } catch (error) {
    console.error("Get service by ID error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch service"
    });
  }
}

export async function updateService(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid service ID"
      });
    }

    const existingService = await TrackedService.findOne({
      _id: id,
      tenantId: req.user.tenantId
    });

    if (!existingService) {
      return res.status(404).json({
        success: false,
        message: "Service not found"
      });
    }

    const {
      name,
      provider,
      category,
      currency,
      unit,
      unitPrice,
      subscriptionAmount,
      billingInterval,
      status
    } = req.body;

    const updates = {};

    if (name !== undefined) {
      const normalizedName = name.trim();
      if (normalizedName.length < 2 || normalizedName.length > 100) {
        return res.status(400).json({
          success: false,
          message: "Service name must be between 2 and 100 characters"
        });
      }
      updates.name = normalizedName;
    }

    if (provider !== undefined) updates.provider = provider.trim();
    if (category !== undefined) updates.category = category.trim();

    if (currency !== undefined) {
      const normalizedCurrency = currency.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
        return res.status(400).json({
          success: false,
          message: "Currency must be a valid 3-letter ISO code"
        });
      }
      updates.currency = normalizedCurrency;
    }

    if (status !== undefined) {
      if (!["active", "archived"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Status must be 'active' or 'archived'"
        });
      }
      updates.status = status;
    }

    const effectiveType = existingService.trackingType;

    if (effectiveType === "metered" || effectiveType === "hybrid") {
      if (unit !== undefined) {
        if (!unit.trim()) {
          return res.status(400).json({
            success: false,
            message: "Unit cannot be empty for metered/hybrid service"
          });
        }
        updates.unit = unit.trim();
      }

      if (unitPrice !== undefined) {
        const parsed = parseDecimal(unitPrice, "Unit price");
        if (parsed.error) {
          return res.status(400).json({
            success: false,
            message: parsed.error
          });
        }
        updates.unitPrice = parsed.value;
      }
    }

    if (effectiveType === "subscription" || effectiveType === "hybrid") {
      if (subscriptionAmount !== undefined) {
        const parsed = parseDecimal(subscriptionAmount, "Subscription amount");
        if (parsed.error) {
          return res.status(400).json({
            success: false,
            message: parsed.error
          });
        }
        updates.subscriptionAmount = parsed.value;
      }

      if (billingInterval !== undefined) {
        const chosenInterval = billingInterval.trim().toLowerCase();
        if (!["daily", "monthly", "quarterly", "yearly"].includes(chosenInterval)) {
          return res.status(400).json({
            success: false,
            message: "Billing interval must be 'daily', 'monthly', 'quarterly', or 'yearly'"
          });
        }
        updates.billingInterval = chosenInterval;
      }
    }

    const updated = await TrackedService.findOneAndUpdate(
      {
        _id: id,
        tenantId: req.user.tenantId
      },
      updates,
      {
        returnDocument: "after",
        runValidators: true
      }
    );

    return res.status(200).json({
      success: true,
      message: "Tracked service updated successfully",
      data: {
        service: formatService(updated)
      }
    });
  } catch (error) {
    console.error("Update service error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update service"
    });
  }
}

export async function archiveService(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid service ID"
      });
    }

    const service = await TrackedService.findOneAndUpdate(
      {
        _id: id,
        tenantId: req.user.tenantId
      },
      {
        status: "archived"
      },
      {
        returnDocument: "after"
      }
    );

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Tracked service archived successfully",
      data: {
        service: formatService(service)
      }
    });
  } catch (error) {
    console.error("Archive service error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to archive service"
    });
  }
}
