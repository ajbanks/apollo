import { Decimal } from "../../../utils/number-helpers";

export function stampDutyCalculator(
    price: number,
    country: "england" | "wales",
    firstProperty = false
): number {
    switch (country) {
        case "england": {
            return englandStampDuty(price, firstProperty);
        }
        case "wales": {
            return walesStampDuty(price, firstProperty);
        }
        default: {
            throw new Error("INVALID_COUNTRY");
        }
    }
}

const WALES_LTT_THRESHOLDS = {
    lowRates: {
        225_000: 0.06,
        400_000: 0.075,
        750_000: 0.1,
        1_500_00: 0.12,
    },
    highRates: {
        0: 0.04,
        180_000: 0.075,
        250_000: 0.09,
        400_000: 0.115,
        750_000: 0.14,
        1_500_000: 0.16,
    },
} as const;
function walesStampDuty(price: number, firstProperty = false): number {
    let tax = 0;
    let remaining = price;

    let thresholds = firstProperty
        ? WALES_LTT_THRESHOLDS.lowRates
        : WALES_LTT_THRESHOLDS.highRates;

    console.log({ thresholds });

    let breakpoints = Object.keys(thresholds).map(Number);

    for (let i = breakpoints.length - 1; i >= 0; i--) {
        if (remaining > breakpoints[i]) {
            let val = remaining - breakpoints[i];
            let bracketTax = val * thresholds[breakpoints[i]];
            tax += bracketTax;
            remaining -= val;
        }
    }

    return Decimal(tax);
}

const STAMP_DUTY_THRESHOLDS = {
    250_000: 0.05,
    925_000: 0.1,
    1_500_000: 0.12,
} as const;
function englandStampDuty(price: number, firstProperty = false) {
    let tax = !firstProperty && price >= 40_000 ? price * 0.03 : 0;

    let remaining = price;

    let breakpoints = Object.keys(STAMP_DUTY_THRESHOLDS).map(Number);

    for (let i = breakpoints.length - 1; i >= 0; i--) {
        if (remaining > breakpoints[i]) {
            let val = remaining - breakpoints[i];
            let bracketTax = val * STAMP_DUTY_THRESHOLDS[breakpoints[i]];
            tax += bracketTax;
            remaining -= val;
        }
    }

    return Decimal(tax);
}
