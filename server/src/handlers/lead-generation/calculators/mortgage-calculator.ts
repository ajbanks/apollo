import { Decimal } from "../../../utils/number-helpers";

export function mortgageCalculator({
    amount,
    duration,
    interest,
    interestOnly = false,
}: {
    amount: number;
    duration: number;
    interest: number;
    interestOnly?: boolean;
}) {
    let annualInterest = interest / 12;

    let pow = Math.pow(1 + annualInterest, duration);

    let annualInterestAmount = amount * annualInterest;

    let result = interestOnly
        ? annualInterestAmount
        : (annualInterestAmount * pow) / (pow - 1);

    return Decimal(result);
}
