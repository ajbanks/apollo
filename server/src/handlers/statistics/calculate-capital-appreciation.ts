import { Decimal } from "../../utils/number-helpers";

/**
 * @description expects an array of numbers sorted chronologically
 * @example [95, 110, 80] where 95 is year 1, 110 year 2, 80 year 3
 * */
export function calculateCAGR(data: number[]): number | null {
    if (data.length < 2) return null;

    let initialPrice = data[0];
    let finalPrice = data[data.length - 1];
    let years = data.length - 1;

    if (years <= 0) throw new Error("Invalid time period");

    const CAGR = ((finalPrice / initialPrice) ** (1 / years) - 1) * 100;

    return Decimal(CAGR, 2);
}
