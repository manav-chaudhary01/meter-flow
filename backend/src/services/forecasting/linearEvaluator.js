import Decimal from "decimal.js";

/**
 * Model A: Linear Run-Rate Forecasting Evaluator.
 *
 * Implements the linear run-rate methodology currently deployed in MeterFlow
 * (see backend/src/services/spendForecaster.js).
 *
 * Method:
 * 1. Computes total historical spend over the training window: S = SUM(trainSpend)
 * 2. Computes the historical daily burn rate: r = S / N_train
 * 3. Projects this constant daily burn rate across each day in the forecast horizon:
 *    forecast_i = r for i = 1 .. horizon
 */
export class LinearRunRateEvaluator {
  constructor(options = {}) {
    this.name = "Linear Run-Rate";
    this.modelType = "linear_run_rate";
    this.description = "MeterFlow production linear run-rate extrapolation";
  }

  /**
   * Fits the model to historical training observations.
   *
   * @param {Array<number>} trainSpend - Array of daily spending amounts in training window
   * @returns {LinearRunRateEvaluator} this
   */
  train(trainSpend) {
    if (!Array.isArray(trainSpend) || trainSpend.length === 0) {
      throw new Error("Training spend must be a non-empty array of numbers");
    }

    this.trainSpend = trainSpend;
    this.trainDays = trainSpend.length;

    let totalDec = new Decimal(0);
    for (const val of trainSpend) {
      totalDec = totalDec.plus(new Decimal(val || 0));
    }
    this.totalHistoricalSpend = totalDec.toFixed(2);

    // Compute daily average spend using Decimal.js for financial precision
    this.dailyBurnRateDec = totalDec.dividedBy(this.trainDays).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    this.dailyBurnRate = Number(this.dailyBurnRateDec.toFixed(2));

    return this;
  }

  /**
   * Generates point-in-time daily forecasts for the requested horizon.
   *
   * @param {number} horizonDays - Number of days to forecast into the future
   * @returns {Array<number>} Forecasted spend values for each day in the horizon
   */
  predict(horizonDays) {
    if (!this.trainSpend) {
      throw new Error("Model must be trained before predicting");
    }
    if (typeof horizonDays !== "number" || horizonDays <= 0) {
      throw new Error("Horizon days must be a positive integer");
    }

    const burnRate = Number(this.dailyBurnRateDec.toFixed(2));
    const predictions = new Array(horizonDays).fill(burnRate);

    return predictions;
  }

  /**
   * Returns metadata about the trained model.
   */
  getMetadata() {
    return {
      modelName: this.name,
      modelType: this.modelType,
      trainObservations: this.trainDays,
      totalHistoricalSpend: this.totalHistoricalSpend,
      dailyBurnRate: this.dailyBurnRateDec?.toFixed(4),
      assumptions: "Assumes future expenditure rate continues at historical constant daily average.",
      limitations: "Does not model trend shifts, weekend variations, or serial autocorrelation."
    };
  }
}

/**
 * Convenience evaluation function for Model A.
 *
 * @param {Array<number>} trainSpend
 * @param {number} horizonDays
 * @returns {Object} { predictions, model, metadata }
 */
export function evaluateLinearRunRate(trainSpend, horizonDays) {
  const model = new LinearRunRateEvaluator().train(trainSpend);
  const predictions = model.predict(horizonDays);
  return {
    predictions,
    model,
    metadata: model.getMetadata()
  };
}
