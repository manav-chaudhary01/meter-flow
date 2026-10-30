import Decimal from "decimal.js";
import BillingRecord from "../models/BillingRecord.js";

export const ELIGIBLE_BILLING_STATUSES = ["issued", "finalized"];

/**
 * Calculates actual spending for a workspace within a defined date range and currency.
 * Sums the monetary total amounts from eligible BillingRecord documents using exact Decimal.js arithmetic.
 * Does NOT sum raw usage quantities or mix different currencies.
 *
 * Spending measurement policy:
 * Measured by invoice billing period: records where billingPeriodStart >= startDate and billingPeriodStart < endDate.
 * Only records with eligible statuses ('issued', 'finalized') are counted. 'draft' or 'void' bills are excluded.
 *
 * @param {Object} params
 * @param {string|Object} params.tenantId - The workspace/tenant ID
 * @param {string} params.currency - 3-letter ISO currency code (e.g. "USD")
 * @param {Date} params.startDate - Inclusive period start (UTC)
 * @param {Date} params.endDate - Exclusive period end (UTC)
 * @param {Array<string>} [params.eligibleStatuses] - Included billing statuses (default: ['issued', 'finalized'])
 * @param {string} [params.measurementRule] - 'period_start' | 'strict_enclosed' | 'generation_time'
 * @returns {Promise<{ actualSpend: string, billCount: number, eligibleBills: Array }>}
 */
export async function calculateActualSpend({
  tenantId,
  currency = "USD",
  startDate,
  endDate,
  eligibleStatuses = ELIGIBLE_BILLING_STATUSES,
  measurementRule = "period_start"
}) {
  const normalizedCurrency = String(currency).trim().toUpperCase();

  const query = {
    tenantId,
    currency: normalizedCurrency,
    status: { $in: eligibleStatuses }
  };

  if (measurementRule === "strict_enclosed") {
    query.billingPeriodStart = { $gte: startDate };
    query.billingPeriodEnd = { $lte: endDate };
  } else if (measurementRule === "generation_time") {
    query.generatedAt = { $gte: startDate, $lt: endDate };
  } else {
    // Default: 'period_start'
    query.billingPeriodStart = { $gte: startDate, $lt: endDate };
  }

  const bills = await BillingRecord.find(query).sort({ billingPeriodStart: 1 });

  let totalSpend = new Decimal(0);

  for (const bill of bills) {
    const rawTotal = bill.total?.$numberDecimal || bill.total?.toString() || "0";
    const billDec = new Decimal(rawTotal);
    totalSpend = totalSpend.plus(billDec);
  }

  const roundedActualSpend = totalSpend.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

  return {
    actualSpend: roundedActualSpend,
    billCount: bills.length,
    eligibleBills: bills
  };
}
