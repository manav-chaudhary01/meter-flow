/**
 * Deterministic Synthetic Time-Series Dataset Generator for Forecasting Evaluation.
 *
 * Designed specifically to evaluate forecasting models (Linear Run-Rate vs. ARIMA)
 * on realistic chronological spending/usage data reflecting MeterFlow digital service consumption.
 *
 * NOTE: This is synthetic/simulated evaluation data generated using a fixed PRNG seed (42).
 * It represents daily cloud API consumption (e.g., token usage, storage, compute) with:
 * - Upward growth trend
 * - Day-of-week weekly seasonality (Monday-Friday business vs weekend lull)
 * - Deterministic pseudo-random variation
 * - Periodic bi-weekly batch processing spikes
 */

/**
 * Seeded pseudo-random number generator (Mulberry32).
 * Produces deterministic numbers in [0, 1) from an integer seed.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates a deterministic chronological time series of daily spending observations.
 *
 * @param {Object} options
 * @param {number} [options.days=90] - Total observations to generate (default: 90 days)
 * @param {string} [options.startDate="2026-08-01"] - Starting calendar date (YYYY-MM-DD)
 * @param {number} [options.seed=42] - Fixed PRNG seed for perfect reproducibility
 * @param {number} [options.baseSpend=42.0] - Base daily expenditure in USD
 * @param {number} [options.dailyTrend=0.25] - Daily linear growth in USD
 * @returns {Array<Object>} Chronological daily observation records
 */
export function generateEvaluationDataset(options = {}) {
  const {
    days = 90,
    startDate = "2026-08-01",
    seed = 42,
    baseSpend = 42.0,
    dailyTrend = 0.25
  } = options;

  const prng = mulberry32(seed);
  const observations = [];
  const start = new Date(startDate + "T00:00:00.000Z");

  for (let i = 0; i < days; i++) {
    const current = new Date(start.getTime() + i * 86400000);
    const dateStr = current.toISOString().slice(0, 10);
    const dayOfWeek = current.getUTCDay(); // 0 = Sunday, 6 = Saturday

    // 1. Baseline + Linear Trend (growing SaaS usage)
    const trendComponent = baseSpend + i * dailyTrend;

    // 2. Day-of-Week Seasonality (high weekday API calls, lower weekend activity)
    // Mon-Fri (1-5): ~1.15x; Sat (6): ~0.75x; Sun (0): ~0.70x
    let seasonalFactor;
    if (dayOfWeek === 0) {
      seasonalFactor = 0.70;
    } else if (dayOfWeek === 6) {
      seasonalFactor = 0.75;
    } else {
      seasonalFactor = 1.15;
    }

    // 3. Deterministic noise: uniform variation in [-3.5, +3.5]
    const noise = (prng() * 7.0) - 3.5;

    // 4. Periodic batch job spikes (e.g. bi-weekly on every 14th day)
    const batchSpike = (i > 0 && i % 14 === 0) ? 18.50 : 0.0;

    // Calculate daily spend (clamped to positive decimal values)
    const rawSpend = (trendComponent * seasonalFactor) + noise + batchSpike;
    const spend = Math.max(0.50, Math.round(rawSpend * 100) / 100);

    // Derived synthetic token volume (e.g. at ~$0.00003 per token)
    const usageTokens = Math.round(spend / 0.00003);

    observations.push({
      index: i,
      date: dateStr,
      timestamp: current.toISOString(),
      dayOfWeek,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      spend,
      usageTokens,
      isBatchSpikeDay: batchSpike > 0
    });
  }

  return observations;
}

/**
 * Splits a chronological dataset into training history and held-out test periods.
 *
 * @param {Array<Object>} dataset - Full dataset
 * @param {number} [trainCount=60] - Number of observations for training
 * @param {number} [testCount=30] - Number of observations for testing
 * @returns {Object} { train, test, trainSpend, testSpend, summary }
 */
export function getTrainTestSplit(dataset, trainCount = 60, testCount = 30) {
  if (!Array.isArray(dataset) || dataset.length < (trainCount + testCount)) {
    throw new Error(
      `Dataset has ${dataset?.length || 0} observations, but ${trainCount + testCount} are required for split.`
    );
  }

  // Ensure chronological order
  validateDatasetChronology(dataset);

  const train = dataset.slice(0, trainCount);
  const test = dataset.slice(trainCount, trainCount + testCount);

  return {
    train,
    test,
    trainSpend: train.map((d) => d.spend),
    testSpend: test.map((d) => d.spend),
    summary: {
      totalObservations: dataset.length,
      trainObservations: train.length,
      testObservations: test.length,
      trainStartDate: train[0].date,
      trainEndDate: train[train.length - 1].date,
      testStartDate: test[0].date,
      testEndDate: test[test.length - 1].date,
      forecastHorizonDays: test.length
    }
  };
}

/**
 * Validates that dataset observations are strictly chronological and structurally valid.
 *
 * @param {Array<Object>} dataset
 * @throws {Error} if dates are out of order or fields invalid
 */
export function validateDatasetChronology(dataset) {
  if (!Array.isArray(dataset) || dataset.length === 0) {
    throw new Error("Dataset must be a non-empty array");
  }

  for (let i = 0; i < dataset.length; i++) {
    const item = dataset[i];
    if (typeof item.spend !== "number" || Number.isNaN(item.spend) || item.spend < 0) {
      throw new Error(`Observation at index ${i} has invalid spend: ${item.spend}`);
    }
    if (!item.date || typeof item.date !== "string") {
      throw new Error(`Observation at index ${i} has invalid date`);
    }

    if (i > 0) {
      const prev = new Date(dataset[i - 1].date);
      const curr = new Date(item.date);
      if (curr.getTime() <= prev.getTime()) {
        throw new Error(
          `Dataset is not strictly chronological: ${dataset[i - 1].date} >= ${item.date} at index ${i}`
        );
      }
    }
  }

  return true;
}
