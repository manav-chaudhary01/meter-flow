import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  generateEvaluationDataset,
  getTrainTestSplit,
  validateDatasetChronology
} from "../../src/services/forecasting/dataset.js";

import {
  calculateMAPE,
  calculateMAE,
  calculateRMSE,
  calculateCumulativeSpendError
} from "../../src/services/forecasting/metrics.js";

import {
  LinearRunRateEvaluator,
  evaluateLinearRunRate
} from "../../src/services/forecasting/linearEvaluator.js";

import {
  ARIMAEvaluator,
  evaluateARIMA
} from "../../src/services/forecasting/arimaEvaluator.js";

import {
  runForecastingComparison
} from "../../src/services/forecasting/comparator.js";

describe("Forecasting Evaluation Module (Model A vs. Model B)", () => {
  // ==========================================
  // 1. DATASET TESTS
  // ==========================================
  describe("Evaluation Dataset Generation & Properties", () => {
    it("generates deterministic dataset with identical values across identical seeds", () => {
      const dataA = generateEvaluationDataset({ days: 30, seed: 42 });
      const dataB = generateEvaluationDataset({ days: 30, seed: 42 });

      assert.equal(dataA.length, 30);
      assert.equal(dataB.length, 30);
      assert.deepEqual(dataA, dataB);

      // Different seed produces different series
      const dataC = generateEvaluationDataset({ days: 30, seed: 99 });
      assert.notDeepEqual(dataA, dataC);
    });

    it("enforces strict chronological ordering and non-negative spend values", () => {
      const dataset = generateEvaluationDataset({ days: 90, startDate: "2026-08-01" });
      assert.equal(dataset.length, 90);
      assert.equal(validateDatasetChronology(dataset), true);

      // Verify date continuity (daily steps of 86400000 ms)
      for (let i = 1; i < dataset.length; i++) {
        const prev = new Date(dataset[i - 1].date);
        const curr = new Date(dataset[i].date);
        const diffMs = curr.getTime() - prev.getTime();
        assert.equal(diffMs, 86400000, `Day ${i} should be exactly 24 hours after day ${i - 1}`);
        assert.ok(dataset[i].spend > 0, "Spend must be positive");
      }
    });

    it("splits dataset into training and held-out test periods with complete separation", () => {
      const dataset = generateEvaluationDataset({ days: 90 });
      const split = getTrainTestSplit(dataset, 60, 30);

      assert.equal(split.train.length, 60);
      assert.equal(split.test.length, 30);
      assert.equal(split.trainSpend.length, 60);
      assert.equal(split.testSpend.length, 30);

      // Ensure no overlap
      const trainDates = new Set(split.train.map((d) => d.date));
      for (const testRecord of split.test) {
        assert.equal(trainDates.has(testRecord.date), false, "Test dates must not overlap training period");
      }

      assert.equal(split.summary.forecastHorizonDays, 30);
      assert.equal(split.summary.trainObservations, 60);
      assert.equal(split.summary.testObservations, 30);
    });

    it("rejects invalid datasets (out-of-order dates, negative spend, insufficient size)", () => {
      assert.throws(() => {
        validateDatasetChronology([
          { date: "2026-08-02", spend: 10 },
          { date: "2026-08-01", spend: 12 }
        ]);
      }, /chronological/i);

      assert.throws(() => {
        validateDatasetChronology([
          { date: "2026-08-01", spend: -5 }
        ]);
      }, /invalid spend/i);

      assert.throws(() => {
        getTrainTestSplit([{ date: "2026-08-01", spend: 10 }], 10, 5);
      }, /observations/i);
    });
  });

  // ==========================================
  // 2. STATISTICAL METRICS (MAPE) TESTS
  // ==========================================
  describe("Statistical Metrics & Zero-Actual Handling", () => {
    it("computes known simple MAPE correctly", () => {
      // Actual = [100, 200], Forecast = [90, 220]
      // Day 1: |100 - 90| / 100 = 10%
      // Day 2: |200 - 220| / 200 = 10%
      // Average MAPE = 10.00%
      const actuals = [100, 200];
      const forecasts = [90, 220];
      const result = calculateMAPE(actuals, forecasts);

      assert.equal(result.mape, 10.00);
      assert.equal(result.formattedMape, "10.00%");
      assert.equal(result.observationCount, 2);
      assert.equal(result.zeroActualCount, 0);
    });

    it("computes MAPE across multiple non-trivial observations accurately", () => {
      // Actual = [50, 80, 100, 40]
      // Forecast = [55, 76, 110, 38]
      // Errors: |5/50|=0.10, |4/80|=0.05, |10/100|=0.10, |2/40|=0.05
      // Mean = 0.30 / 4 = 0.075 -> 7.50%
      const actuals = [50, 80, 100, 40];
      const forecasts = [55, 76, 110, 38];
      const result = calculateMAPE(actuals, forecasts);

      assert.equal(result.mape, 7.50);
      assert.equal(result.formattedMape, "7.50%");
    });

    it("handles zero actual values explicitly without NaN or division by zero", () => {
      // Both actual and forecast are zero
      const resZeroBoth = calculateMAPE([0], [0]);
      assert.equal(resZeroBoth.mape, 0);
      assert.equal(resZeroBoth.zeroActualCount, 1);

      // Actual is zero, forecast is non-zero (clamped to epsilon = 0.01)
      const resZeroActual = calculateMAPE([0], [1.00], { epsilon: 0.01 });
      assert.ok(Number.isFinite(resZeroActual.mape));
      assert.equal(resZeroActual.zeroActualCount, 1);
      assert.equal(resZeroActual.mape > 0, true);
    });

    it("computes MAE, RMSE, and cumulative spend error correctly", () => {
      const actuals = [100, 200, 300];
      const forecasts = [110, 190, 320];

      // Abs diffs: 10, 10, 20 -> MAE = 40 / 3 = 13.33
      assert.equal(calculateMAE(actuals, forecasts), 13.33);

      // Squared diffs: 100, 100, 400 = 600 / 3 = 200 -> sqrt(200) = 14.14
      assert.equal(calculateRMSE(actuals, forecasts), 14.14);

      // Cumulative: 600 actual vs 620 forecast -> variance +20 (+3.33%)
      const cumul = calculateCumulativeSpendError(actuals, forecasts);
      assert.equal(cumul.totalActual, 600);
      assert.equal(cumul.totalForecast, 620);
      assert.equal(cumul.variance, 20);
      assert.equal(cumul.variancePercentage, 3.33);
    });
  });

  // ==========================================
  // 3. MODEL A: LINEAR RUN-RATE EVALUATOR
  // ==========================================
  describe("Model A: Linear Run-Rate Evaluator", () => {
    it("trains on historical spend and produces constant daily burn-rate forecasts", () => {
      const trainSpend = [20, 30, 40, 50, 60]; // Mean = 40.00
      const horizon = 7;
      const { predictions, metadata } = evaluateLinearRunRate(trainSpend, horizon);

      assert.equal(predictions.length, horizon);
      for (const p of predictions) {
        assert.equal(p, 40.00);
      }
      assert.equal(metadata.modelType, "linear_run_rate");
      assert.equal(metadata.trainObservations, 5);
      assert.equal(metadata.totalHistoricalSpend, "200.00");
    });

    it("produces valid MAPE against held-out test data", () => {
      const trainSpend = [40, 42, 44, 46, 48]; // Mean = 44.00
      const testSpend = [45, 47, 49]; // Forecast = [44, 44, 44]
      const { predictions } = evaluateLinearRunRate(trainSpend, testSpend.length);
      const mape = calculateMAPE(testSpend, predictions);

      assert.ok(mape.mape > 0 && mape.mape < 20);
      assert.match(mape.formattedMape, /%/);
    });

    it("rejects training on empty series or negative horizons", () => {
      assert.throws(() => new LinearRunRateEvaluator().train([]), /non-empty/i);
      const model = new LinearRunRateEvaluator().train([10, 20]);
      assert.throws(() => model.predict(0), /positive integer/i);
      assert.throws(() => model.predict(-5), /positive integer/i);
    });
  });

  // ==========================================
  // 4. MODEL B: ARIMA EVALUATOR
  // ==========================================
  describe("Model B: ARIMA Evaluator", () => {
    it("fits ARIMA model on chronological training data and predicts future horizon", () => {
      // 20 points of upward trending data
      const trainSpend = [
        10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
        20, 21, 22, 23, 24, 25, 26, 27, 28, 29
      ];
      const horizon = 5;
      const { predictions, metadata } = evaluateARIMA(trainSpend, horizon, {
        p: 1, d: 1, q: 1, verbose: false
      });

      assert.equal(predictions.length, horizon);
      assert.equal(metadata.modelType, "arima");
      assert.equal(metadata.trainObservations, 20);

      // Predictions should be positive numbers
      for (const val of predictions) {
        assert.ok(typeof val === "number" && !Number.isNaN(val));
        assert.ok(val >= 0, "Forecast spend must be non-negative");
      }
    });

    it("produces valid MAPE against held-out observations", () => {
      const dataset = generateEvaluationDataset({ days: 90, seed: 42 });
      const split = getTrainTestSplit(dataset, 60, 30);
      const { predictions } = evaluateARIMA(split.trainSpend, 30, { p: 1, d: 1, q: 1 });
      const mape = calculateMAPE(split.testSpend, predictions);

      assert.ok(mape.mape > 0, "MAPE must be a positive number");
      assert.ok(mape.mape < 100, "MAPE should be reasonable for a trending series");
    });

    it("rejects insufficient historical observations for ARIMA fitting", () => {
      assert.throws(() => {
        new ARIMAEvaluator({ p: 1, d: 1, q: 1 }).train([1, 2, 3]);
      }, /insufficient/i);
    });
  });

  // ==========================================
  // 5. FORECASTING COMPARISON & EVALUATION
  // ==========================================
  describe("Forecasting Comparison Pipeline", () => {
    it("evaluates both models across identical evaluation periods with matching horizons", () => {
      const results = runForecastingComparison({ trainDays: 60, testDays: 30 });

      assert.ok(results.experimentMetadata);
      assert.equal(results.experimentMetadata.forecastHorizonDays, 30);
      assert.equal(results.experimentMetadata.trainObservations, 60);
      assert.equal(results.experimentMetadata.testObservations, 30);

      const linear = results.models.linearRunRate;
      const arima = results.models.arima;

      assert.ok(linear);
      assert.ok(arima);

      // Both models have valid metrics
      assert.ok(typeof linear.mape === "number" && linear.mape > 0);
      assert.ok(typeof arima.mape === "number" && arima.mape > 0);
      assert.ok(typeof linear.mae === "number" && linear.mae > 0);
      assert.ok(typeof arima.mae === "number" && arima.mae > 0);
      assert.ok(typeof linear.rmse === "number" && linear.rmse > 0);
      assert.ok(typeof arima.rmse === "number" && arima.rmse > 0);

      // Summary table contains both models
      assert.equal(results.summaryTable.length, 2);
      assert.equal(results.summaryTable[0].Model, "Linear Run-Rate");
      assert.equal(results.summaryTable[1].Model, "ARIMA");

      // Daily comparisons match horizon
      assert.equal(results.dailyComparisons.length, 30);
    });

    it("correctly identifies the lower-error model and reports absolute delta", () => {
      const results = runForecastingComparison({ trainDays: 60, testDays: 30 });
      const { outcome, models } = results;

      if (models.arima.mape < models.linearRunRate.mape) {
        assert.equal(outcome.winner, "ARIMA");
      } else {
        assert.equal(outcome.winner, "Linear Run-Rate");
      }

      assert.equal(
        outcome.absoluteDeltaMape,
        Math.round(Math.abs(models.linearRunRate.mape - models.arima.mape) * 100) / 100
      );
      assert.ok(outcome.recommendation.length > 20);
    });
  });
});
