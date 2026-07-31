export function calculateYield(monthlyRent: number, buyPrice: number) {
    return Number(((monthlyRent * 12 * 100) / buyPrice).toFixed(1));
}
