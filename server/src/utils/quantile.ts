export function quantile(set: number[], percentile: number) {
    let sorted = set.slice().sort((a, b) => a - b);
    let index = Math.floor((set.length - 1) * (percentile / 100));

    if (Number.isInteger(index)) {
        return sorted[index];
    } else {
        const lowerIndex = Math.floor(index);
        const upperIndex = Math.ceil(index);
        const lowerValue = sorted[lowerIndex];
        const upperValue = sorted[upperIndex];
        const interpolationFactor = index - lowerIndex;

        return lowerValue + (upperValue - lowerValue) * interpolationFactor;
    }
}
