import mongoose from "mongoose";
import Decimal from "decimal.js";
import UsageRecord from "../models/UsageRecord.js";
import TrackedService from "../models/TrackedService.js";

function parseQuantity(value) {
  if (value === undefined || value === null || value === "") {
    return { error: "Quantity is required" };
  }
  try {
    const d = new Decimal(value);
    if (!d.isFinite() || d.isNaN()) {
      return { error: "Quantity must be a valid finite number" };
    }
    if (d.isNegative()) {
      return { error: "Quantity must be a non-negative number (>= 0)" };
    }
    return { value: d.toString() };
  } catch {
    return { error: "Quantity must be a valid numeric decimal" };
  }
}

function formatUsage(rec) {
  if (!rec) return null;
  const doc = rec.toObject ? rec.toObject({ flattenMaps: true }) : rec;
  let metadata = doc.metadata || {};
  if (metadata instanceof Map) {
    metadata = Object.fromEntries(metadata);
  }
  return {
    id: doc._id,
    tenantId: doc.tenantId,
    serviceId: doc.serviceId?._id || doc.serviceId,
    serviceName: doc.serviceId?.name || doc.serviceName || undefined,
    quantity: doc.quantity ? (doc.quantity.$numberDecimal || doc.quantity.toString()) : "0",
    unit: doc.unit,
    occurredAt: doc.occurredAt,
    source: doc.source || "api",
    idempotencyKey: doc.idempotencyKey || null,
    externalEventId: doc.externalEventId || null,
    metadata,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

function payloadsMatch(existing, incoming) {
  // Service ID match
  const existingServiceId = (existing.serviceId?._id || existing.serviceId).toString();
  if (existingServiceId !== incoming.serviceId.toString()) {
    return false;
  }

  // Unit match (normalized trim & lowercase)
  if (existing.unit.trim().toLowerCase() !== incoming.unit.trim().toLowerCase()) {
    return false;
  }

  // Quantity match using Decimal.js equality
  const existingQty = new Decimal(
    existing.quantity.$numberDecimal || existing.quantity.toString()
  );
  const incomingQty = new Decimal(incoming.quantity);
  if (!existingQty.equals(incomingQty)) {
    return false;
  }

  // OccurredAt match if explicitly supplied
  if (incoming.hasExplicitOccurredAt) {
    const existingTime = new Date(existing.occurredAt).getTime();
    const incomingTime = new Date(incoming.occurredAt).getTime();
    if (existingTime !== incomingTime) {
      return false;
    }
  }

  return true;
}

export async function ingestUsage(req, res) {
  try {
    const {
      serviceId,
      quantity,
      unit,
      occurredAt,
      source,
      idempotencyKey,
      externalEventId,
      metadata
    } = req.body;

    // 1. Validate serviceId
    if (!serviceId || !mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({
        success: false,
        message: "A valid serviceId is required"
      });
    }

    // 2. Verify service exists and belongs to active workspace
    const service = await TrackedService.findOne({
      _id: serviceId,
      tenantId: req.user.tenantId
    });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Tracked service not found in active workspace"
      });
    }

    if (service.status === "archived") {
      return res.status(400).json({
        success: false,
        message: "Cannot ingest usage for an archived service"
      });
    }

    if (service.trackingType === "subscription") {
      return res.status(400).json({
        success: false,
        message: "Usage ingestion is not supported for subscription-only services"
      });
    }

    // 3. Validate quantity
    const parsedQty = parseQuantity(quantity);
    if (parsedQty.error) {
      return res.status(400).json({
        success: false,
        message: parsedQty.error
      });
    }

    // 4. Validate unit
    if (!unit || typeof unit !== "string" || !unit.trim()) {
      return res.status(400).json({
        success: false,
        message: "Unit is required"
      });
    }

    const normalizedUnit = unit.trim();
    if (
      service.unit &&
      service.unit.trim().toLowerCase() !== normalizedUnit.toLowerCase()
    ) {
      return res.status(400).json({
        success: false,
        message: `Unit mismatch: service expects '${service.unit}', received '${normalizedUnit}'`
      });
    }

    // 5. Validate occurredAt
    let eventDate = new Date();
    let hasExplicitOccurredAt = false;
    if (occurredAt !== undefined && occurredAt !== null) {
      const parsedDate = new Date(occurredAt);
      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid occurredAt timestamp format"
        });
      }
      eventDate = parsedDate;
      hasExplicitOccurredAt = true;
    }

    // 6. Validate metadata if provided
    if (
      metadata !== undefined &&
      (typeof metadata !== "object" || metadata === null || Array.isArray(metadata))
    ) {
      return res.status(400).json({
        success: false,
        message: "Metadata must be a key-value object"
      });
    }

    const trimmedIdempotencyKey = idempotencyKey ? String(idempotencyKey).trim() : null;
    const trimmedExternalEventId = externalEventId ? String(externalEventId).trim() : null;

    const incomingPayload = {
      serviceId,
      quantity: parsedQty.value,
      unit: normalizedUnit,
      occurredAt: eventDate,
      hasExplicitOccurredAt
    };

    // 7. Check for existing record before insert if idempotency keys are supplied
    let existingRecord = null;
    if (trimmedIdempotencyKey) {
      existingRecord = await UsageRecord.findOne({
        tenantId: req.user.tenantId,
        idempotencyKey: trimmedIdempotencyKey
      });
    } else if (trimmedExternalEventId) {
      existingRecord = await UsageRecord.findOne({
        tenantId: req.user.tenantId,
        serviceId,
        externalEventId: trimmedExternalEventId
      });
    }

    if (existingRecord) {
      if (payloadsMatch(existingRecord, incomingPayload)) {
        return res.status(200).json({
          success: true,
          message: "Idempotent replay: usage record already recorded",
          data: {
            record: formatUsage(existingRecord),
            idempotentReplay: true
          }
        });
      }
      return res.status(409).json({
        success: false,
        message:
          "Idempotency conflict: An event with this key already exists with a different payload"
      });
    }

    // 8. Attempt database creation
    try {
      const record = await UsageRecord.create({
        tenantId: req.user.tenantId,
        serviceId,
        quantity: parsedQty.value,
        unit: normalizedUnit,
        occurredAt: eventDate,
        source: source ? String(source).trim() : "api",
        idempotencyKey: trimmedIdempotencyKey,
        externalEventId: trimmedExternalEventId,
        metadata: metadata || {}
      });

      return res.status(201).json({
        success: true,
        message: "Usage recorded successfully",
        data: {
          record: formatUsage(record),
          idempotentReplay: false
        }
      });
    } catch (createError) {
      // Handle race condition with duplicate key error (code 11000)
      if (createError.code === 11000) {
        let conflictRecord = null;
        if (trimmedIdempotencyKey) {
          conflictRecord = await UsageRecord.findOne({
            tenantId: req.user.tenantId,
            idempotencyKey: trimmedIdempotencyKey
          });
        } else if (trimmedExternalEventId) {
          conflictRecord = await UsageRecord.findOne({
            tenantId: req.user.tenantId,
            serviceId,
            externalEventId: trimmedExternalEventId
          });
        }

        if (conflictRecord) {
          if (payloadsMatch(conflictRecord, incomingPayload)) {
            return res.status(200).json({
              success: true,
              message: "Idempotent replay: usage record already recorded",
              data: {
                record: formatUsage(conflictRecord),
                idempotentReplay: true
              }
            });
          }
          return res.status(409).json({
            success: false,
            message:
              "Idempotency conflict: An event with this key already exists with a different payload"
          });
        }
      }

      throw createError;
    }
  } catch (error) {
    console.error("Usage ingestion error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to ingest usage record"
    });
  }
}

export async function getUsageHistory(req, res) {
  try {
    const { serviceId, startDate, endDate, page = 1, limit = 20 } = req.query;

    const query = {
      tenantId: req.user.tenantId
    };

    if (serviceId) {
      if (!mongoose.Types.ObjectId.isValid(serviceId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid serviceId parameter"
        });
      }
      query.serviceId = serviceId;
    }

    if (startDate || endDate) {
      query.occurredAt = {};
      if (startDate) {
        const start = new Date(startDate);
        if (isNaN(start.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid startDate format"
          });
        }
        query.occurredAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        if (isNaN(end.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid endDate format"
          });
        }
        query.occurredAt.$lt = end;
      }
      if (startDate && endDate) {
        if (new Date(startDate) > new Date(endDate)) {
          return res.status(400).json({
            success: false,
            message: "startDate cannot be after endDate"
          });
        }
      }
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [total, records] = await Promise.all([
      UsageRecord.countDocuments(query),
      UsageRecord.find(query)
        .sort({ occurredAt: -1, _id: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate("serviceId", "name unit trackingType currency")
    ]);

    return res.status(200).json({
      success: true,
      data: {
        records: records.map(formatUsage),
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum) || 1
        }
      }
    });
  } catch (error) {
    console.error("Get usage history error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch usage history"
    });
  }
}

export async function getUsageSummary(req, res) {
  try {
    const { serviceId, startDate, endDate, groupBy = "service" } = req.query;

    const tenantObjectId = new mongoose.Types.ObjectId(req.user.tenantId);
    const matchQuery = {
      tenantId: tenantObjectId
    };

    if (serviceId) {
      if (!mongoose.Types.ObjectId.isValid(serviceId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid serviceId parameter"
        });
      }
      matchQuery.serviceId = new mongoose.Types.ObjectId(serviceId);
    }

    if (startDate || endDate) {
      matchQuery.occurredAt = {};
      if (startDate) {
        const start = new Date(startDate);
        if (isNaN(start.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid startDate format"
          });
        }
        matchQuery.occurredAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        if (isNaN(end.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid endDate format"
          });
        }
        matchQuery.occurredAt.$lt = end;
      }
      if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
        return res.status(400).json({
          success: false,
          message: "startDate cannot be after endDate"
        });
      }
    }

    const allowedGroupBy = ["service", "day", "month"];
    if (!allowedGroupBy.includes(groupBy)) {
      return res.status(400).json({
        success: false,
        message: "groupBy must be 'service', 'day', or 'month'"
      });
    }

    let pipeline = [];

    if (groupBy === "service") {
      pipeline = [
        { $match: matchQuery },
        {
          $group: {
            _id: "$serviceId",
            totalQuantity: { $sum: "$quantity" },
            eventCount: { $sum: 1 },
            minQuantity: { $min: "$quantity" },
            maxQuantity: { $max: "$quantity" },
            firstEventAt: { $min: "$occurredAt" },
            lastEventAt: { $max: "$occurredAt" }
          }
        },
        {
          $lookup: {
            from: "trackedservices",
            localField: "_id",
            foreignField: "_id",
            as: "service"
          }
        },
        { $unwind: "$service" },
        {
          $project: {
            serviceId: "$_id",
            serviceName: "$service.name",
            unit: "$service.unit",
            trackingType: "$service.trackingType",
            currency: "$service.currency",
            totalQuantity: 1,
            eventCount: 1,
            minQuantity: 1,
            maxQuantity: 1,
            firstEventAt: 1,
            lastEventAt: 1
          }
        },
        { $sort: { totalQuantity: -1 } }
      ];
    } else {
      const dateFormat = groupBy === "month" ? "%Y-%m" : "%Y-%m-%d";
      pipeline = [
        { $match: matchQuery },
        {
          $group: {
            _id: {
              serviceId: "$serviceId",
              period: {
                $dateToString: { format: dateFormat, date: "$occurredAt" }
              }
            },
            totalQuantity: { $sum: "$quantity" },
            eventCount: { $sum: 1 },
            firstEventAt: { $min: "$occurredAt" },
            lastEventAt: { $max: "$occurredAt" }
          }
        },
        {
          $lookup: {
            from: "trackedservices",
            localField: "_id.serviceId",
            foreignField: "_id",
            as: "service"
          }
        },
        { $unwind: "$service" },
        {
          $project: {
            serviceId: "$_id.serviceId",
            period: "$_id.period",
            serviceName: "$service.name",
            unit: "$service.unit",
            trackingType: "$service.trackingType",
            totalQuantity: 1,
            eventCount: 1,
            firstEventAt: 1,
            lastEventAt: 1
          }
        },
        { $sort: { period: -1, totalQuantity: -1 } }
      ];
    }

    const rawSummary = await UsageRecord.aggregate(pipeline);

    const summary = rawSummary.map((item) => ({
      serviceId: item.serviceId,
      serviceName: item.serviceName,
      unit: item.unit,
      trackingType: item.trackingType,
      currency: item.currency || undefined,
      period: item.period || undefined,
      totalQuantity: item.totalQuantity
        ? (item.totalQuantity.$numberDecimal || item.totalQuantity.toString())
        : "0",
      eventCount: item.eventCount,
      minQuantity: item.minQuantity
        ? (item.minQuantity.$numberDecimal || item.minQuantity.toString())
        : undefined,
      maxQuantity: item.maxQuantity
        ? (item.maxQuantity.$numberDecimal || item.maxQuantity.toString())
        : undefined,
      firstEventAt: item.firstEventAt,
      lastEventAt: item.lastEventAt
    }));

    return res.status(200).json({
      success: true,
      data: {
        summary,
        count: summary.length
      }
    });
  } catch (error) {
    console.error("Get usage summary error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate usage summary"
    });
  }
}

export async function getUsageById(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid usage record ID"
      });
    }

    const record = await UsageRecord.findOne({
      _id: id,
      tenantId: req.user.tenantId
    }).populate("serviceId", "name unit trackingType currency");

    if (!record) {
      return res.status(404).json({
        success: false,
        message: "Usage record not found"
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        record: formatUsage(record)
      }
    });
  } catch (error) {
    console.error("Get usage record by ID error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch usage record"
    });
  }
}
