import Decimal from "decimal.js";
import BudgetAlert from "../models/BudgetAlert.js";
import { calculateActualSpend } from "./spendCalculator.js";

/**
 * Evaluates budget alert thresholds for a given budget document.
 * Deterministically triggers alerts when spending reaches or crosses thresholds.
 * When spend jumps across multiple thresholds (e.g. 0% to 85%), all crossed thresholds (50%, 80%) are created.
 * Database uniqueness prevents any duplicate alerts on repeated evaluation.
 *
 * @param {Object} params
 * @param {Object} params.budget - The Budget Mongoose document
 * @param {string} [params.actualSpend] - Optional pre-computed actual spend string
 * @returns {Promise<Object>} { actualSpend, percentageUsed, newAlerts, existingAlerts }
 */
export async function evaluateBudgetAlerts({ budget, actualSpend: precomputedSpend }) {
  let spendStr = precomputedSpend;

  if (spendStr === undefined || spendStr === null) {
    const spendRes = await calculateActualSpend({
      tenantId: budget.tenantId,
      currency: budget.currency,
      startDate: budget.startDate,
      endDate: budget.endDate
    });
    spendStr = spendRes.actualSpend;
  }

  const spendDec = new Decimal(spendStr || 0);
  const budgetAmountStr = budget.amount?.$numberDecimal || budget.amount?.toString() || "0";
  const budgetAmountDec = new Decimal(budgetAmountStr);

  let percentageUsed = 0;
  if (!budgetAmountDec.isZero()) {
    percentageUsed = spendDec.dividedBy(budgetAmountDec).times(100).toNumber();
  }

  const sortedThresholds = [...(budget.thresholds || [50, 80, 90, 100])].sort((a, b) => a - b);
  const newAlerts = [];
  const existingAlerts = [];

  for (const threshold of sortedThresholds) {
    if (percentageUsed >= threshold) {
      // Check if alert already exists for this budget, period, and threshold
      const existing = await BudgetAlert.findOne({
        budgetId: budget._id,
        periodStart: budget.startDate,
        periodEnd: budget.endDate,
        threshold
      });

      if (existing) {
        existingAlerts.push(existing);
      } else {
        try {
          const alert = await BudgetAlert.create({
            tenantId: budget.tenantId,
            budgetId: budget._id,
            budgetName: budget.name,
            periodStart: budget.startDate,
            periodEnd: budget.endDate,
            threshold,
            actualSpend: spendDec.toFixed(2),
            budgetAmount: budgetAmountDec.toFixed(2),
            currency: budget.currency,
            percentageUsed: Math.round(percentageUsed * 100) / 100,
            alertType: percentageUsed >= 100 ? "threshold_exceeded" : "threshold_reached",
            status: "active",
            triggeredAt: new Date()
          });
          newAlerts.push(alert);
        } catch (err) {
          // Handle code 11000 gracefully if race condition occurs
          if (err.code === 11000) {
            const raceWinner = await BudgetAlert.findOne({
              budgetId: budget._id,
              periodStart: budget.startDate,
              periodEnd: budget.endDate,
              threshold
            });
            if (raceWinner) existingAlerts.push(raceWinner);
          } else {
            throw err;
          }
        }
      }
    }
  }

  return {
    actualSpend: spendDec.toFixed(2),
    budgetAmount: budgetAmountDec.toFixed(2),
    percentageUsed: Math.round(percentageUsed * 100) / 100,
    newAlerts,
    existingAlerts,
    totalAlertsCount: newAlerts.length + existingAlerts.length
  };
}
