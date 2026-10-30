import Decimal from "decimal.js";

/**
 * Generates an explainable, deterministic spending forecast for a budget.
 * Uses linear run-rate extrapolation from historical daily spending across elapsed days in the period.
 *
 * Requirements met:
 * 1. Clearly separates actual spend from forecast spend.
 * 2. Returns forecast method and exact data window.
 * 3. Handles insufficient historical data explicitly (< 1 day elapsed or unstarted period).
 * 4. Avoids returning misleading forecasts on inadequate data.
 * 5. Uses consistent UTC date and currency policy.
 * 6. Documents assumptions and limitations.
 *
 * @param {Object} params
 * @param {Object} params.budget - The Budget document (contains startDate, endDate, amount, currency)
 * @param {string|number|Decimal} params.actualSpend - The current actual spend amount
 * @param {Date} [params.evaluationDate] - Date of evaluation (defaults to now)
 * @returns {Object} Forecast result object
 */
export function generateSpendForecast({
  budget,
  actualSpend = "0.00",
  evaluationDate = new Date()
}) {
  const startDate = new Date(budget.startDate);
  const endDate = new Date(budget.endDate);
  const evalDate = new Date(evaluationDate);
  const currency = (budget.currency || "USD").toUpperCase();

  const budgetAmountStr = budget.amount?.$numberDecimal || budget.amount?.toString() || "0.00";
  const budgetAmountDec = new Decimal(budgetAmountStr);
  const actualSpendDec = new Decimal(actualSpend || 0);

  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  const totalDurationMs = endDate.getTime() - startDate.getTime();
  const daysTotal = Math.max(1, Math.round(totalDurationMs / MS_PER_DAY));

  // Case 1: Budget period has not started yet
  if (evalDate.getTime() < startDate.getTime()) {
    return {
      hasSufficientData: false,
      reason: "Budget period has not started yet. Forecasting cannot begin before the period start date.",
      actualSpend: actualSpendDec.toFixed(2),
      forecastSpend: null,
      budgetAmount: budgetAmountDec.toFixed(2),
      currency,
      method: "linear_run_rate",
      dataWindow: {
        daysTotal,
        daysElapsed: 0,
        daysRemaining: daysTotal,
        windowStart: startDate.toISOString(),
        windowEnd: evalDate.toISOString()
      },
      assumptions: "Linear extrapolation requires at least 1 day of elapsed data within the active period.",
      limitations: "Forecast cannot be computed prior to period onset."
    };
  }

  // Case 2: Budget period has already ended
  if (evalDate.getTime() >= endDate.getTime()) {
    const variance = actualSpendDec.minus(budgetAmountDec).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    return {
      hasSufficientData: true,
      isPeriodCompleted: true,
      actualSpend: actualSpendDec.toFixed(2),
      forecastSpend: actualSpendDec.toFixed(2),
      budgetAmount: budgetAmountDec.toFixed(2),
      projectedVariance: variance.toFixed(2),
      isProjectedToExceed: actualSpendDec.greaterThan(budgetAmountDec),
      currency,
      method: "linear_run_rate",
      dailyAverageSpend: daysTotal > 0
        ? actualSpendDec.dividedBy(daysTotal).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4)
        : "0.0000",
      dataWindow: {
        daysTotal,
        daysElapsed: daysTotal,
        daysRemaining: 0,
        windowStart: startDate.toISOString(),
        windowEnd: endDate.toISOString()
      },
      assumptions: "Budget period has completed. Final actual expenditure is the realized total.",
      limitations: "Period is closed; no further variance is expected."
    };
  }

  // Case 3: Active budget period
  const elapsedMs = evalDate.getTime() - startDate.getTime();
  const daysElapsed = Math.floor(elapsedMs / MS_PER_DAY);
  const daysRemaining = Math.max(0, daysTotal - daysElapsed);

  // Require at least 1 full elapsed day (>= 24h) to avoid misleading micro-interval extrapolation
  if (daysElapsed < 1) {
    return {
      hasSufficientData: false,
      reason: "Insufficient historical data: at least 1 full day (24 hours) must elapse in the budget period to extrapolate spending.",
      actualSpend: actualSpendDec.toFixed(2),
      forecastSpend: null,
      budgetAmount: budgetAmountDec.toFixed(2),
      currency,
      method: "linear_run_rate",
      dataWindow: {
        daysTotal,
        daysElapsed,
        daysRemaining,
        windowStart: startDate.toISOString(),
        windowEnd: evalDate.toISOString()
      },
      assumptions: "Requires at least 24 hours of elapsed spending data to compute a representative daily burn rate.",
      limitations: "Extrapolating a fraction of a day would produce erratic and ungrounded forecasts."
    };
  }

  // Calculate daily burn rate and project across remaining days
  const dailyAverageSpend = actualSpendDec.dividedBy(daysElapsed);
  const remainingSpendForecast = dailyAverageSpend.times(daysRemaining);
  const forecastSpendDec = actualSpendDec.plus(remainingSpendForecast).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  const projectedVarianceDec = forecastSpendDec.minus(budgetAmountDec).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const isProjectedToExceed = forecastSpendDec.greaterThan(budgetAmountDec);

  return {
    hasSufficientData: true,
    isPeriodCompleted: false,
    actualSpend: actualSpendDec.toFixed(2),
    forecastSpend: forecastSpendDec.toFixed(2),
    budgetAmount: budgetAmountDec.toFixed(2),
    projectedVariance: projectedVarianceDec.toFixed(2),
    isProjectedToExceed,
    currency,
    method: "linear_run_rate",
    dailyAverageSpend: dailyAverageSpend.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
    dataWindow: {
      daysTotal,
      daysElapsed,
      daysRemaining,
      windowStart: startDate.toISOString(),
      windowEnd: evalDate.toISOString()
    },
    assumptions: "Assumes current daily expenditure rate will continue at a constant linear rate through the end of the budget period.",
    limitations: "Does not account for non-linear usage spikes, weekend/weekday cycles, one-off subscription renewals, or seasonality."
  };
}
