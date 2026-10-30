import mongoose from "mongoose";
import BillingRecord from "../models/BillingRecord.js";
import TrackedService from "../models/TrackedService.js";
import UsageRecord from "../models/UsageRecord.js";
import { calculateBill } from "../services/billingCalculator.js";

function formatBillingRecord(record) {
  if (!record) return null;
  const doc = record.toObject ? record.toObject() : record;
  return {
    id: doc._id,
    tenantId: doc.tenantId,
    invoiceNumber: doc.invoiceNumber,
    billingPeriodStart: doc.billingPeriodStart,
    billingPeriodEnd: doc.billingPeriodEnd,
    currency: doc.currency,
    lineItems: (doc.lineItems || []).map((item) => ({
      id: item._id,
      serviceId: item.serviceId,
      serviceName: item.serviceName,
      chargeType: item.chargeType,
      quantity: item.quantity ? (item.quantity.$numberDecimal || item.quantity.toString()) : null,
      unit: item.unit || null,
      unitPrice: item.unitPrice ? (item.unitPrice.$numberDecimal || item.unitPrice.toString()) : null,
      amount: item.amount ? (item.amount.$numberDecimal || item.amount.toString()) : "0.00",
      usageRecordCount: item.usageRecordCount || 0,
      description: item.description
    })),
    subtotal: doc.subtotal ? (doc.subtotal.$numberDecimal || doc.subtotal.toString()) : "0.00",
    total: doc.total ? (doc.total.$numberDecimal || doc.total.toString()) : "0.00",
    status: doc.status,
    generatedAt: doc.generatedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

export async function generateBill(req, res) {
  try {
    const { billingPeriodStart, billingPeriodEnd, currency = "USD" } = req.body;

    // 1. Validate billing dates
    if (!billingPeriodStart || !billingPeriodEnd) {
      return res.status(400).json({
        success: false,
        message: "billingPeriodStart and billingPeriodEnd are required"
      });
    }

    const startDate = new Date(billingPeriodStart);
    const endDate = new Date(billingPeriodEnd);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format for billing period"
      });
    }

    if (startDate >= endDate) {
      return res.status(400).json({
        success: false,
        message: "billingPeriodStart must be before billingPeriodEnd"
      });
    }

    const normalizedCurrency = String(currency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
      return res.status(400).json({
        success: false,
        message: "Currency must be a valid 3-letter ISO code"
      });
    }

    // 2. Pre-check: Check if a billing record already exists for this exact period and currency
    const existingBill = await BillingRecord.findOne({
      tenantId: req.user.tenantId,
      billingPeriodStart: startDate,
      billingPeriodEnd: endDate,
      currency: normalizedCurrency
    });

    if (existingBill) {
      return res.status(200).json({
        success: true,
        message: "Billing record already exists for this period",
        data: {
          billingRecord: formatBillingRecord(existingBill),
          isExisting: true
        }
      });
    }

    // 3. Query all workspace services matching the currency
    const services = await TrackedService.find({
      tenantId: req.user.tenantId,
      currency: normalizedCurrency
    });

    // 4. Query all unbilled usage events in the period
    const usageRecords = await UsageRecord.find({
      tenantId: req.user.tenantId,
      billingRecordId: null,
      occurredAt: {
        $gte: startDate,
        $lt: endDate
      }
    });

    // 5. Calculate charges via dedicated billing calculation engine
    const { lineItems, subtotal, total, reconciledUsageIds } = calculateBill({
      services,
      usageRecords,
      billingPeriodStart: startDate,
      billingPeriodEnd: endDate,
      currency: normalizedCurrency
    });

    // Generate stable human-readable invoice number
    const dateSegment = startDate.toISOString().slice(0, 10).replace(/-/g, "");
    const randomHex = Math.random().toString(36).substring(2, 8).toUpperCase();
    const invoiceNumber = `INV-${dateSegment}-${randomHex}`;

    // 6. Persist BillingRecord with concurrency duplicate protection
    let billingRecord;
    try {
      billingRecord = await BillingRecord.create({
        tenantId: req.user.tenantId,
        invoiceNumber,
        billingPeriodStart: startDate,
        billingPeriodEnd: endDate,
        currency: normalizedCurrency,
        lineItems,
        subtotal,
        total,
        status: "issued",
        generatedAt: new Date(),
        generatedBy: req.user.userId
      });
    } catch (createErr) {
      // Handle race condition if concurrent request already inserted the bill
      if (createErr.code === 11000) {
        const raceWinner = await BillingRecord.findOne({
          tenantId: req.user.tenantId,
          billingPeriodStart: startDate,
          billingPeriodEnd: endDate,
          currency: normalizedCurrency
        });
        if (raceWinner) {
          return res.status(200).json({
            success: true,
            message: "Billing record already exists for this period",
            data: {
              billingRecord: formatBillingRecord(raceWinner),
              isExisting: true
            }
          });
        }
      }
      throw createErr;
    }

    // 7. Reconcile usage records to the generated bill
    if (reconciledUsageIds.length > 0) {
      await UsageRecord.updateMany(
        {
          _id: { $in: reconciledUsageIds },
          billingRecordId: null
        },
        {
          $set: {
            billingRecordId: billingRecord._id,
            billedAt: billingRecord.generatedAt
          }
        }
      );
    }

    return res.status(201).json({
      success: true,
      message: "Billing record generated successfully",
      data: {
        billingRecord: formatBillingRecord(billingRecord),
        isExisting: false
      }
    });
  } catch (error) {
    console.error("Generate bill error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate billing record"
    });
  }
}

export async function listBillingRecords(req, res) {
  try {
    const { status, startDate, endDate, page = 1, limit = 20 } = req.query;

    const query = {
      tenantId: req.user.tenantId
    };

    if (status) {
      query.status = status.trim();
    }

    if (startDate || endDate) {
      if (startDate) {
        const start = new Date(startDate);
        if (isNaN(start.getTime())) {
          return res.status(400).json({ success: false, message: "Invalid startDate" });
        }
        query.billingPeriodStart = { $gte: start };
      }
      if (endDate) {
        const end = new Date(endDate);
        if (isNaN(end.getTime())) {
          return res.status(400).json({ success: false, message: "Invalid endDate" });
        }
        query.billingPeriodEnd = { $lte: end };
      }
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [total, records] = await Promise.all([
      BillingRecord.countDocuments(query),
      BillingRecord.find(query)
        .sort({ billingPeriodEnd: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
    ]);

    return res.status(200).json({
      success: true,
      data: {
        billingRecords: records.map(formatBillingRecord),
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum) || 1
        }
      }
    });
  } catch (error) {
    console.error("List billing records error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch billing records"
    });
  }
}

export async function getBillingRecordById(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid billing record ID"
      });
    }

    const record = await BillingRecord.findOne({
      _id: id,
      tenantId: req.user.tenantId
    });

    if (!record) {
      return res.status(404).json({
        success: false,
        message: "Billing record not found"
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        billingRecord: formatBillingRecord(record)
      }
    });
  } catch (error) {
    console.error("Get billing record by ID error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch billing record"
    });
  }
}

export async function getBillingUsage(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid billing record ID"
      });
    }

    // Verify bill exists in active workspace
    const record = await BillingRecord.findOne({
      _id: id,
      tenantId: req.user.tenantId
    });

    if (!record) {
      return res.status(404).json({
        success: false,
        message: "Billing record not found"
      });
    }

    const usageRecords = await UsageRecord.find({
      tenantId: req.user.tenantId,
      billingRecordId: id
    })
      .sort({ occurredAt: 1 })
      .populate("serviceId", "name unit trackingType currency");

    return res.status(200).json({
      success: true,
      data: {
        billingRecordId: id,
        invoiceNumber: record.invoiceNumber,
        count: usageRecords.length,
        usageRecords: usageRecords.map((r) => {
          const doc = r.toObject ? r.toObject() : r;
          return {
            id: doc._id,
            serviceId: doc.serviceId?._id || doc.serviceId,
            serviceName: doc.serviceId?.name || "Unknown Service",
            quantity: doc.quantity ? (doc.quantity.$numberDecimal || doc.quantity.toString()) : "0",
            unit: doc.unit,
            occurredAt: doc.occurredAt,
            billedAt: doc.billedAt
          };
        })
      }
    });
  } catch (error) {
    console.error("Get billing usage error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch usage for billing record"
    });
  }
}
