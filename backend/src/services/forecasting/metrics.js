/**
 * Statistical Error Metrics for Time-Series Forecasting Evaluation.
 *
 * Implements Mean Absolute Percentage Error (MAPE), Mean Absolute Error (MAE),
 * and Root Mean Squared Error (RMSE) with explicit handling for zero-actual observations.
 */

/**
 * Calculates the Mean Absolute Percentage Error (MAPE) between actual and forecasted series.
 *
 * Formula:
 *   MAPE = (100 / n) * SUM( |Actual_i - Forecast_i| / Denominator_i )
 *
 * Zero-Actual Handling Policy:
 * - If Actual == 0 and Forecast == 0, the error is 0.0 (perfect prediction of zero spend).
 * - If Actual == 0 and Forecast != 0, division-by-zero is avoided by clamping the denominator
 *   to `epsilon` (default 0.01 USD / 1 cent). This ensures non-zero predictions for zero-spend days
 *   are penalized appropriately without corrupting the metric with NaN or Infinity.
 *
 * @param {Array<number>} actuals - Observed ground-truth series
 * @param {Array<number>} forecasts - Predicted series
 * @param {Object} [options]
 * @param {number} [options.epsilon=0.01] - Minimum denominator for zero-actual handling
 * @returns {Object} Metric result with numeric mape and metadata
 */
export function calculateMAPE(actuals, forecasts, options = {}) {
  if (!Array.isArray(actuals) || !Array.isArray(forecasts)) {
    throw new Error("Both actuals and forecasts must be arrays");
  }

  if (actuals.length === 0 || forecasts.length === 0) {
    throw new Error("Arrays must contain at least one observation");
  }

  if (actuals.length !== forecasts.length) {
    throw new Error(
      `Array length mismatch: actuals has ${actuals.length} elements, forecasts has ${forecasts.length}`
    );
  }

  const epsilon = options.epsilon ?? 0.01;
  const n = actuals.length;
  let sumPercentageError = 0;
  let zeroActualCount = 0;

  for (let i = 0; i < n; i++) {
    const act = actuals[i];
    const fct = forecasts[i];

    if (typeof act !== "number" || typeof fct !== "number" || Number.isNaN(act) || Number.isNaN(fct)) {
      throw new Error(`Invalid numeric observation at index ${i}: actual=${act}, forecast=${fct}`);
    }

    if (act === 0) {
      zeroActualCount++;
      if (fct === 0) {
        sumPercentageError += 0;
      } else {
        sumPercentageError += Math.abs(act - fct) / epsilon;
      }
    } else {
      sumPercentageError += Math.abs(act - fct) / Math.abs(act);
    }
  }

  const rawMape = (100 / n) * sumPercentageError;
  const mape = Math.round(rawMape * 100) / 100; // rounded to 2 decimal places

  return {
    mape,
    rawMape,
    formattedMape: `${mape.toFixed(2)}%`,
    observationCount: n,
    zeroActualCount,
    formula: "MAPE = (100 / n) * SUM( |Actual - Forecast| / Actual )",
    zeroHandlingRule: `Zero actuals clamped to epsilon = ${epsilon}`
  };
}

/**
 * Calculates the Mean Absolute Error (MAE) in currency units ($).
 *
 * Formula:
 *   MAE = (1 / n) * SUM( |Actual_i - Forecast_i| )
 *
 * @param {Array<number>} actuals
 * @param {Array<number>} forecasts
 * @returns {number} MAE rounded to 2 decimal places
 */
export function calculateMAE(actuals, forecasts) {
  if (actuals.length !== forecasts.length || actuals.length === 0) {
    throw new Error("Arrays must be non-empty and of equal length");
  }

  const n = actuals.length;
  let sumAbsDiff = 0;
  for (let i = 0; i < n; i++) {
    sumAbsDiff += Math.abs(actuals[i] - forecasts[i]);
  }

  return Math.round((sumAbsDiff / n) * 100) / 100;
}

/**
 * Calculates the Root Mean Squared Error (RMSE) in currency units ($).
 *
 * Formula:
 *   RMSE = SQRT( (1 / n) * SUM( (Actual_i - Forecast_i)^2 ) )
 *
 * @param {Array<number>} actuals
 * @param {Array<number>} forecasts
 * @returns {number} RMSE rounded to 2 decimal places
 */
export function calculateRMSE(actuals, forecasts) {
  if (actuals.length !== forecasts.length || actuals.length === 0) {
    throw new Error("Arrays must be non-empty and of equal length");
  }

  const n = actuals.length;
  let sumSquaredDiff = 0;
  for (let i = 0; i < n; i++) {
    const diff = actuals[i] - forecasts[i];
    sumSquaredDiff += diff * diff;
  }

  return Math.round(Math.sqrt(sumSquaredDiff / n) * 100) / 100;
}

/**
 * Calculates the cumulative total spend variance over the forecast horizon.
 *
 * @param {Array<number>} actuals
 * @param {Array<number>} forecasts
 * @returns {Object} { totalActual, totalForecast, variance, variancePercentage }
 */
export function calculateCumulativeSpendError(actuals, forecasts) {
  const totalActual = actuals.reduce((a, b) => a + b, 0);
  const totalForecast = forecasts.reduce((a, b) => a + b, 0);
  const variance = totalForecast - totalActual;
  const variancePercentage = totalActual > 0
    ? Math.round(((variance / totalActual) * 100) * 100) / 100
    : 0;

  return {
    totalActual: Math.round(totalActual * 100) / 100,
    totalForecast: Math.round(totalForecast * 100) / 100,
    variance: Math.round(variance * 100) / 100,
    variancePercentage
  };
}
