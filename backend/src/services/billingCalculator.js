import Decimal from "decimal.js";

/**
 * Calculates billing line items, subtotal, and total for a workspace and billing period.
 * Uses Decimal.js for precise financial arithmetic with explicit ROUND_HALF_UP rounding to 2 decimal places.
 *
 * @param {Object} params
 * @param {Array} params.services - TrackedService documents matching workspace and currency
 * @param {Array} params.usageRecords - Eligible unbilled UsageRecord documents for the period
 * @param {Date} params.billingPeriodStart - Inclusive period start (UTC)
 * @param {Date} params.billingPeriodEnd - Exclusive period end (UTC)
 * @param {String} params.currency - 3-letter currency code (e.g. "USD")
 * @returns {Object} { lineItems, subtotal, total, reconciledUsageIds }
 */
export function calculateBill({
  services,
  usageRecords,
  billingPeriodStart,
  billingPeriodEnd,
  currency = "USD"
}) {
  const lineItems = [];
  const reconciledUsageIds = [];
  let runningSubtotal = new Decimal(0);

  // Index usage records by serviceId
  const usageByService = new Map();
  for (const record of usageRecords) {
    const sId = record.serviceId.toString();
    if (!usageByService.has(sId)) {
      usageByService.set(sId, []);
    }
    usageByService.get(sId).push(record);
  }

  // Calculate milliseconds and days in period
  const periodDurationMs = billingPeriodEnd.getTime() - billingPeriodStart.getTime();
  const periodDays = Math.max(1, Math.round(periodDurationMs / (1000 * 60 * 60 * 24)));

  for (const service of services) {
    const serviceCurrency = (service.currency || "USD").toUpperCase();
    if (serviceCurrency !== currency.toUpperCase()) {
      continue;
    }

    const { trackingType, status } = service;

    // 1. Subscription Charge (for 'subscription' and 'hybrid' services)
    if (trackingType === "subscription" || trackingType === "hybrid") {
      // Archived services do not incur ongoing subscription fees if archived prior to the billing period
      const isArchivedBeforePeriod =
        status === "archived" &&
        service.updatedAt &&
        new Date(service.updatedAt).getTime() <= billingPeriodStart.getTime();

      if (!isArchivedBeforePeriod && service.subscriptionAmount) {
        const rawSubAmount = new Decimal(
          service.subscriptionAmount.$numberDecimal || service.subscriptionAmount.toString()
        );

        let fee = rawSubAmount;
        const interval = (service.billingInterval || "monthly").toLowerCase();

        if (interval === "daily") {
          fee = rawSubAmount.times(periodDays);
        } else if (interval === "monthly") {
          // Standard monthly billing cycle: 1 period charge
          fee = rawSubAmount;
        } else if (interval === "yearly") {
          fee = rawSubAmount;
        } else if (interval === "quarterly") {
          fee = rawSubAmount;
        }

        const roundedFee = fee.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

        if (!roundedFee.isZero() || rawSubAmount.isZero()) {
          lineItems.push({
            serviceId: service._id,
            serviceName: service.name,
            chargeType: "subscription",
            quantity: null,
            unit: null,
            unitPrice: null,
            amount: roundedFee.toFixed(2),
            usageRecordCount: 0,
            usageRecordIds: [],
            description: `${interval.charAt(0).toUpperCase() + interval.slice(1)} subscription fee for ${service.name}`
          });

          runningSubtotal = runningSubtotal.plus(roundedFee);
        }
      }
    }

    // 2. Metered Usage Charge (for 'metered' and 'hybrid' services)
    if (trackingType === "metered" || trackingType === "hybrid") {
      const recordsForService = usageByService.get(service._id.toString()) || [];

      if (recordsForService.length > 0 && service.unitPrice) {
        let totalQty = new Decimal(0);
        const recordIds = [];

        for (const rec of recordsForService) {
          const qty = new Decimal(
            rec.quantity.$numberDecimal || rec.quantity.toString()
          );
          totalQty = totalQty.plus(qty);
          recordIds.push(rec._id);
          reconciledUsageIds.push(rec._id);
        }

        const unitPrice = new Decimal(
          service.unitPrice.$numberDecimal || service.unitPrice.toString()
        );

        const charge = totalQty.times(unitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

        lineItems.push({
          serviceId: service._id,
          serviceName: service.name,
          chargeType: "usage",
          quantity: totalQty.toString(),
          unit: service.unit,
          unitPrice: unitPrice.toString(),
          amount: charge.toFixed(2),
          usageRecordCount: recordsForService.length,
          usageRecordIds: recordIds,
          description: `Usage charge for ${totalQty.toString()} ${service.unit} at ${currency} ${unitPrice.toString()}/${service.unit}`
        });

        runningSubtotal = runningSubtotal.plus(charge);
      }
    }
  }

  const subtotal = runningSubtotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const total = subtotal; // No taxes or discounts in this milestone

  return {
    lineItems,
    subtotal: subtotal.toFixed(2),
    total: total.toFixed(2),
    reconciledUsageIds
  };
}
