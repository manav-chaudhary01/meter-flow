import mongoose from "mongoose";
import Decimal from "decimal.js";
import Budget from "../models/Budget.js";
import BudgetAlert from "../models/BudgetAlert.js";
import { calculateActualSpend } from "../services/spendCalculator.js";
import { generateSpendForecast } from "../services/spendForecaster.js";
import { evaluateBudgetAlerts } from "../services/alertEvaluator.js";

function formatBudget(budget, actualSpend = null, forecast = null) {
  if (!budget) return null;
  const doc = budget.toObject ? budget.toObject() : budget;
  const amountStr = doc.amount ? (doc.amount.$numberDecimal || doc.amount.toString()) : "0.00";

  let percentageUsed;
  if (actualSpend !== null) {
    const amountDec = new Decimal(amountStr);
    percentageUsed = !amountDec.isZero()
      ? Math.round(new Decimal(actualSpend).dividedBy(amountDec).times(100).toNumber() * 100) / 100
      : 0;
  }

  return {
    id: doc._id,
    tenantId: doc.tenantId,
    name: doc.name,
    amount: amountStr,
    currency: doc.currency,
    periodType: doc.periodType,
    startDate: doc.startDate,
    endDate: doc.endDate,
    thresholds: doc.thresholds,
    status: doc.status,
    actualSpend: actualSpend !== null ? actualSpend : undefined,
    percentageUsed,
    forecast: forecast !== null ? forecast : undefined,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

function formatAlert(alert) {
  if (!alert) return null;
  const doc = alert.toObject ? alert.toObject() : alert;
  return {
    id: doc._id,
    tenantId: doc.tenantId,
    budgetId: doc.budgetId,
    budgetName: doc.budgetName,
    periodStart: doc.periodStart,
    periodEnd: doc.periodEnd,
    threshold: doc.threshold,
    actualSpend: doc.actualSpend ? (doc.actualSpend.$numberDecimal || doc.actualSpend.toString()) : "0.00",
    budgetAmount: doc.budgetAmount ? (doc.budgetAmount.$numberDecimal || doc.budgetAmount.toString()) : "0.00",
    currency: doc.currency,
    percentageUsed: doc.percentageUsed,
    alertType: doc.alertType,
    status: doc.status,
    triggeredAt: doc.triggeredAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

export async function createBudget(req, res) {
  try {
    const {
      name,
      amount,
      currency = "USD",
      periodType = "monthly",
      startDate,
      endDate,
      thresholds = [50, 80, 90, 100]
    } = req.body;

    // 1. Validate name
    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Budget name is required (minimum 2 characters)"
      });
    }

    // 2. Validate amount
    if (amount === undefined || amount === null || amount === "") {
      return res.status(400).json({
        success: false,
        message: "Budget amount is required"
      });
    }

    let parsedAmount;
    try {
      const d = new Decimal(amount);
      if (!d.isFinite() || d.isNaN()) {
        return res.status(400).json({ success: false, message: "Amount must be a valid finite number" });
      }
      if (d.isNegative() || d.isZero()) {
        return res.status(400).json({ success: false, message: "Budget amount must be a positive number (> 0)" });
      }
      parsedAmount = d.toFixed(2);
    } catch {
      return res.status(400).json({ success: false, message: "Invalid budget amount format" });
    }

    // 3. Validate currency
    const normalizedCurrency = String(currency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
      return res.status(400).json({
        success: false,
        message: "Currency must be a valid 3-letter ISO code"
      });
    }

    // 4. Validate dates
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate and endDate are required"
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format for budget period"
      });
    }

    if (start >= end) {
      return res.status(400).json({
        success: false,
        message: "startDate must be strictly before endDate"
      });
    }

    // 5. Validate thresholds
    if (!Array.isArray(thresholds) || thresholds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Thresholds must be a non-empty array of numbers"
      });
    }

    const cleanedThresholds = [];
    for (const t of thresholds) {
      const num = Number(t);
      if (isNaN(num) || num <= 0 || num > 200) {
        return res.status(400).json({
          success: false,
          message: "Each threshold must be a number between 1 and 200"
        });
      }
      cleanedThresholds.push(num);
    }
    const uniqueSortedThresholds = [...new Set(cleanedThresholds)].sort((a, b) => a - b);

    // 6. Persist budget
    const budget = await Budget.create({
      tenantId: req.user.tenantId,
      name: name.trim(),
      amount: parsedAmount,
      currency: normalizedCurrency,
      periodType,
      startDate: start,
      endDate: end,
      thresholds: uniqueSortedThresholds,
      status: "active",
      createdBy: req.user.userId
    });

    // 7. Calculate initial spend and forecast
    const { actualSpend } = await calculateActualSpend({
      tenantId: req.user.tenantId,
      currency: normalizedCurrency,
      startDate: start,
      endDate: end
    });

    const forecast = generateSpendForecast({
      budget,
      actualSpend
    });

    // 8. Evaluate initial alerts
    await evaluateBudgetAlerts({ budget, actualSpend });

    return res.status(201).json({
      success: true,
      message: "Budget created successfully",
      data: {
        budget: formatBudget(budget, actualSpend, forecast)
      }
    });
  } catch (error) {
    console.error("Create budget error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create budget"
    });
  }
}

export async function listBudgets(req, res) {
  try {
    const { status, currency, page = 1, limit = 20 } = req.query;

    const query = {
      tenantId: req.user.tenantId
    };

    if (status) {
      query.status = status.trim();
    }
    if (currency) {
      query.currency = currency.trim().toUpperCase();
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [total, budgets] = await Promise.all([
      Budget.countDocuments(query),
      Budget.find(query).sort({ startDate: -1, createdAt: -1 }).skip(skip).limit(limitNum)
    ]);

    // Calculate spend and forecast for each budget
    const enrichedBudgets = await Promise.all(
      budgets.map(async (b) => {
        const { actualSpend } = await calculateActualSpend({
          tenantId: req.user.tenantId,
          currency: b.currency,
          startDate: b.startDate,
          endDate: b.endDate
        });
        const forecast = generateSpendForecast({ budget: b, actualSpend });
        return formatBudget(b, actualSpend, forecast);
      })
    );

    return res.status(200).json({
      success: true,
      data: {
        budgets: enrichedBudgets,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum) || 1
        }
      }
    });
  } catch (error) {
    console.error("List budgets error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch budgets"
    });
  }
}

export async function getBudgetById(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid budget ID"
      });
    }

    const budget = await Budget.findOne({
      _id: id,
      tenantId: req.user.tenantId
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: "Budget not found"
      });
    }

    // Calculate actual spend
    const { actualSpend } = await calculateActualSpend({
      tenantId: req.user.tenantId,
      currency: budget.currency,
      startDate: budget.startDate,
      endDate: budget.endDate
    });

    // Evaluate alerts and fetch alerts
    await evaluateBudgetAlerts({ budget, actualSpend });

    const alerts = await BudgetAlert.find({
      budgetId: budget._id,
      tenantId: req.user.tenantId
    }).sort({ triggeredAt: -1 });

    const forecast = generateSpendForecast({ budget, actualSpend });

    return res.status(200).json({
      success: true,
      data: {
        budget: formatBudget(budget, actualSpend, forecast),
        alerts: alerts.map(formatAlert)
      }
    });
  } catch (error) {
    console.error("Get budget by ID error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch budget"
    });
  }
}

export async function updateBudget(req, res) {
  try {
    const { id } = req.params;
    const { name, amount, thresholds, status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid budget ID"
      });
    }

    const budget = await Budget.findOne({
      _id: id,
      tenantId: req.user.tenantId
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: "Budget not found"
      });
    }

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "Budget name must be at least 2 characters"
        });
      }
      budget.name = name.trim();
    }

    if (amount !== undefined) {
      try {
        const d = new Decimal(amount);
        if (!d.isFinite() || d.isNaN() || d.isNegative() || d.isZero()) {
          return res.status(400).json({ success: false, message: "Budget amount must be a positive number (> 0)" });
        }
        budget.amount = d.toFixed(2);
      } catch {
        return res.status(400).json({ success: false, message: "Invalid budget amount format" });
      }
    }

    if (thresholds !== undefined) {
      if (!Array.isArray(thresholds) || thresholds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Thresholds must be a non-empty array of numbers"
        });
      }
      const cleaned = [];
      for (const t of thresholds) {
        const num = Number(t);
        if (isNaN(num) || num <= 0 || num > 200) {
          return res.status(400).json({
            success: false,
            message: "Each threshold must be a number between 1 and 200"
          });
        }
        cleaned.push(num);
      }
      budget.thresholds = [...new Set(cleaned)].sort((a, b) => a - b);
    }

    if (status !== undefined) {
      if (!["active", "inactive", "archived"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Status must be 'active', 'inactive', or 'archived'"
        });
      }
      budget.status = status;
    }

    await budget.save();

    const { actualSpend } = await calculateActualSpend({
      tenantId: req.user.tenantId,
      currency: budget.currency,
      startDate: budget.startDate,
      endDate: budget.endDate
    });

    await evaluateBudgetAlerts({ budget, actualSpend });
    const forecast = generateSpendForecast({ budget, actualSpend });

    return res.status(200).json({
      success: true,
      message: "Budget updated successfully",
      data: {
        budget: formatBudget(budget, actualSpend, forecast)
      }
    });
  } catch (error) {
    console.error("Update budget error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update budget"
    });
  }
}

export async function deleteBudget(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid budget ID"
      });
    }

    const budget = await Budget.findOne({
      _id: id,
      tenantId: req.user.tenantId
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: "Budget not found"
      });
    }

    // Soft deactivation: set status to 'archived' so historical alert records are preserved
    budget.status = "archived";
    await budget.save();

    return res.status(200).json({
      success: true,
      message: "Budget deactivated successfully (archived)"
    });
  } catch (error) {
    console.error("Delete budget error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to deactivate budget"
    });
  }
}

export async function evaluateBudget(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid budget ID"
      });
    }

    const budget = await Budget.findOne({
      _id: id,
      tenantId: req.user.tenantId
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: "Budget not found"
      });
    }

    const evaluation = await evaluateBudgetAlerts({ budget });

    return res.status(200).json({
      success: true,
      message: "Budget evaluated successfully",
      data: {
        budgetId: budget._id,
        budgetName: budget.name,
        actualSpend: evaluation.actualSpend,
        budgetAmount: evaluation.budgetAmount,
        percentageUsed: evaluation.percentageUsed,
        newAlerts: evaluation.newAlerts.map(formatAlert),
        existingAlerts: evaluation.existingAlerts.map(formatAlert)
      }
    });
  } catch (error) {
    console.error("Evaluate budget error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to evaluate budget alerts"
    });
  }
}

export async function listAlerts(req, res) {
  try {
    const { status, budgetId, page = 1, limit = 50 } = req.query;

    const query = {
      tenantId: req.user.tenantId
    };

    if (status) query.status = status.trim();
    if (budgetId && mongoose.Types.ObjectId.isValid(budgetId)) {
      query.budgetId = budgetId;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [total, alerts] = await Promise.all([
      BudgetAlert.countDocuments(query),
      BudgetAlert.find(query).sort({ triggeredAt: -1 }).skip(skip).limit(limitNum)
    ]);

    return res.status(200).json({
      success: true,
      data: {
        alerts: alerts.map(formatAlert),
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum) || 1
        }
      }
    });
  } catch (error) {
    console.error("List alerts error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch budget alerts"
    });
  }
}

export async function acknowledgeAlert(req, res) {
  try {
    const { alertId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(alertId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid alert ID"
      });
    }

    const alert = await BudgetAlert.findOne({
      _id: alertId,
      tenantId: req.user.tenantId
    });

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: "Alert not found"
      });
    }

    alert.status = "acknowledged";
    await alert.save();

    return res.status(200).json({
      success: true,
      message: "Alert acknowledged successfully",
      data: {
        alert: formatAlert(alert)
      }
    });
  } catch (error) {
    console.error("Acknowledge alert error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to acknowledge alert"
    });
  }
}
