#!/usr/bin/env node

/**
 * CLI Runner for MeterFlow Forecasting Evaluation Experiment.
 *
 * Compares Model A (Linear Run-Rate) against Model B (ARIMA)
 * on a reproducible, deterministic chronological time-series dataset.
 */

import { runForecastingComparison } from "../src/services/forecasting/comparator.js";

function formatPad(str, len, align = "left") {
  const s = String(str);
  if (s.length >= len) return s;
  const pad = " ".repeat(len - s.length);
  return align === "right" ? pad + s : s + pad;
}

async function main() {
  console.log("================================================================================");
  console.log("         MeterFlow Forecasting Evaluation: Linear Run-Rate vs. ARIMA            ");
  console.log("================================================================================\n");

  const results = runForecastingComparison({
    trainDays: 60,
    testDays: 30,
    arimaConfig: { p: 1, d: 1, q: 1, verbose: false }
  });

  const { experimentMetadata, models, outcome, dailyComparisons } = results;

  console.log("1. EXPERIMENT & DATASET METADATA");
  console.log("--------------------------------------------------------------------------------");
  console.log(`Dataset Source:       ${experimentMetadata.datasetSource}`);
  console.log(`Total Observations:   ${experimentMetadata.totalObservations} days`);
  console.log(`Training Period:      ${experimentMetadata.trainPeriod} (${experimentMetadata.trainObservations} days)`);
  console.log(`Test / Eval Period:   ${experimentMetadata.testPeriod} (${experimentMetadata.testObservations} days)`);
  console.log(`Forecast Horizon:     ${experimentMetadata.forecastHorizonDays} days`);
  console.log(`Evaluation Metric:    MAPE (Mean Absolute Percentage Error)\n`);

  console.log("2. EVALUATION RESULTS SUMMARY");
  console.log("--------------------------------------------------------------------------------");
  console.log(
    formatPad("Model", 22) +
    formatPad("MAPE", 12, "right") +
    formatPad("MAE ($)", 12, "right") +
    formatPad("RMSE ($)", 12, "right") +
    formatPad("Cumul. Forecast", 18, "right") +
    formatPad("Actual Spend", 16, "right")
  );
  console.log("-".repeat(92));

  for (const row of results.summaryTable) {
    console.log(
      formatPad(row.Model, 22) +
      formatPad(row.MAPE, 12, "right") +
      formatPad(row.MAE, 12, "right") +
      formatPad(row.RMSE, 12, "right") +
      formatPad(row["Cumulative Forecast"], 18, "right") +
      formatPad(row["Actual Spend"], 16, "right")
    );
  }
  console.log("-".repeat(92));
  console.log();

  console.log("3. COMPARISON & WINNER ANALYSIS");
  console.log("--------------------------------------------------------------------------------");
  console.log(`Lower Error Model:     ${outcome.winner}`);
  console.log(`Linear Run-Rate MAPE:  ${models.linearRunRate.formattedMape}`);
  console.log(`ARIMA MAPE:            ${models.arima.formattedMape}`);
  console.log(`Absolute MAPE Delta:   ${outcome.absoluteDeltaMape.toFixed(2)}%`);
  console.log(`Relative Improvement:  ${outcome.relativeMapeImprovementPercentage.toFixed(2)}%`);
  console.log(`Recommendation:        ${outcome.recommendation}\n`);

  console.log("4. SAMPLE DAILY COMPARISON (First 7 Days of Test Horizon)");
  console.log("--------------------------------------------------------------------------------");
  console.log(
    formatPad("Date", 14) +
    formatPad("Actual ($)", 14, "right") +
    formatPad("Linear ($)", 14, "right") +
    formatPad("ARIMA ($)", 14, "right") +
    formatPad("Linear Error", 16, "right") +
    formatPad("ARIMA Error", 16, "right")
  );
  console.log("-".repeat(88));

  for (let i = 0; i < Math.min(7, dailyComparisons.length); i++) {
    const d = dailyComparisons[i];
    console.log(
      formatPad(d.date, 14) +
      formatPad(`$${d.actual.toFixed(2)}`, 14, "right") +
      formatPad(`$${d.linearForecast.toFixed(2)}`, 14, "right") +
      formatPad(`$${d.arimaForecast.toFixed(2)}`, 14, "right") +
      formatPad(`$${d.linearAbsError.toFixed(2)}`, 16, "right") +
      formatPad(`$${d.arimaAbsError.toFixed(2)}`, 16, "right")
    );
  }
  console.log("-".repeat(88));
  console.log("\n[FORECASTING-EVALUATION-SUCCESS] Experiment executed and validated successfully.\n");
}

main().catch((err) => {
  console.error("Evaluation script encountered an error:", err);
  process.exit(1);
});
