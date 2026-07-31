import { isNumber } from "lodash";

/**
 * @description Transforms a value to a number, returns NaN if the value can't be converted
 */
export function Decimal(value: any, decimals: number = 2): typeof NaN | number {
    let num = Number(value);

    return isNaN(num) ? NaN : Number(num.toFixed(decimals));
}

/**
 * @example num 230, nearest 100 will return 200
 * @example num 1357 nearest 100 will return 1400
 * @example num 6832 nearest 500 will return 7000
 */
export function roundNearest(num: string | number, nearest: number = 100) {
    return Math.round(Number(num) / nearest) * nearest;
}

/**
 * @example num 235, will return 230
 * @example num 1357 will return 1300
 * @example num 26832 will return 26000
 */
export function roundSignificant(num: string | number, precision: number = 2) {
    return Number(Number(num).toPrecision(precision));
}

export function percentageDiff(val: number, change: number) {
    if (!val || !change) return null;

    return val === change ? 0 : Decimal((change / (val - change)) * 100);
}
