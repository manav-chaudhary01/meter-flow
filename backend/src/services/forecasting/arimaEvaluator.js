import ARIMA from "arima";

/**
 * Model B: ARIMA Time-Series Forecasting Evaluator.
 *
 * Implements an Auto-Regressive Integrated Moving Average (ARIMA / SARIMA)
 * model for chronological time-series evaluation.
 *
 * Supports:
 * - Non-seasonal order (p, d, q) for trend and autoregressive dynamics
 * - Seasonal order (P, D, Q, s) for weekly recurring cycles (e.g. s = 7 days)
 * - Safe non-negative clamping for financial spend predictions
 */
export class ARIMAEvaluator {
  constructor(options = {}) {
    this.name = "ARIMA";
    this.modelType = "arima";
    this.p = options.p ?? 1;
    this.d = options.d ?? 1;
    this.q = options.q ?? 1;
    this.P = options.P ?? 0;
    this.D = options.D ?? 0;
    this.Q = options.Q ?? 0;
    this.s = options.s ?? 0; // seasonal period (e.g. 7 for weekly)
    this.verbose = options.verbose ?? false;
  }

  /**
   * Trains the ARIMA model on historical chronological observations.
   *
   * @param {Array<number>} trainSpend - Chronological sequence of training values
   * @returns {ARIMAEvaluator} this
   */
  train(trainSpend) {
    if (!Array.isArray(trainSpend) || trainSpend.length === 0) {
      throw new Error("Training spend must be a non-empty array of numbers");
    }

    // Minimum observations check for ARIMA stability
    const minRequired = Math.max(12, (this.p + this.d + this.q + 1) * 2);
    if (trainSpend.length < minRequired) {
      throw new Error(
        `Insufficient training observations for ARIMA(${this.p},${this.d},${this.q}): received ${trainSpend.length}, minimum required is ${minRequired}.`
      );
    }

    this.trainSpend = trainSpend;
    this.trainDays = trainSpend.length;

    const config = {
      p: this.p,
      d: this.d,
      q: this.q,
      verbose: this.verbose
    };

    if (this.s > 1) {
      config.P = this.P;
      config.D = this.D;
      config.Q = this.Q;
      config.s = this.s;
    }

    this.arimaInstance = new ARIMA(config);
    this.arimaInstance.train(trainSpend);

    return this;
  }

  /**
   * Predicts future values for the defined horizon.
   *
   * @param {number} horizonDays - Forecast horizon
   * @returns {Array<number>} Clamped non-negative forecast values
   */
  predict(horizonDays) {
    if (!this.arimaInstance) {
      throw new Error("Model must be trained before predicting");
    }
    if (typeof horizonDays !== "number" || horizonDays <= 0) {
      throw new Error("Horizon days must be a positive integer");
    }

    const [rawPredictions, errors] = this.arimaInstance.predict(horizonDays);

    // Clamp forecasts to non-negative and round to 2 decimal places
    const predictions = rawPredictions.map((val) => {
      const num = typeof val === "number" && !Number.isNaN(val) ? val : 0;
      return Math.max(0, Math.round(num * 100) / 100);
    });

    this.lastErrors = errors;
    return predictions;
  }

  /**
   * Returns metadata about the model configuration.
   */
  getMetadata() {
    return {
      modelName: this.s > 1 ? `SARIMA(${this.p},${this.d},${this.q})(${this.P},${this.D},${this.Q})[${this.s}]` : `ARIMA(${this.p},${this.d},${this.q})`,
      modelType: this.modelType,
      order: { p: this.p, d: this.d, q: this.q },
      seasonalOrder: this.s > 1 ? { P: this.P, D: this.D, Q: this.Q, s: this.s } : null,
      trainObservations: this.trainDays,
      assumptions: "Assumes stationary differenced series with autoregressive and moving average error dynamics.",
      limitations: "Requires parameter tuning, longer training histories, and higher computational complexity than linear models."
    };
  }
}

/**
 * Convenience evaluation function for Model B.
 *
 * @param {Array<number>} trainSpend
 * @param {number} horizonDays
 * @param {Object} [options]
 * @returns {Object} { predictions, model, metadata }
 */
export function evaluateARIMA(trainSpend, horizonDays, options = {}) {
  const model = new ARIMAEvaluator(options).train(trainSpend);
  const predictions = model.predict(horizonDays);
  return {
    predictions,
    model,
    metadata: model.getMetadata()
  };
}
