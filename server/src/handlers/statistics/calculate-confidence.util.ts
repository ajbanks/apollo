
export type Confidence = ReturnType<typeof calculateConfidence>;
export function calculateConfidence(num: number) {
    if (num >= 30) {
        return "high";
    } else if (num >= 15) {
        return "medium";
    } else {
        return "low";
    }
}
