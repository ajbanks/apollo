import { ExpectationFailed } from "@bahatron/utils/lib/error";

export function parseCrawledPrice(model: { api?: any; details: any }) {
    if (!model.details) {
        throw ExpectationFailed("DETAILS_MISSING");
    }

    let sanitised = model.details.prices?.primaryPrice
        .replace(`£`, ``)
        .replace(`pcm`, ``)
        .replace(/,/g, ``)
        .trim();

    return parseInt(sanitised) || null;
}
