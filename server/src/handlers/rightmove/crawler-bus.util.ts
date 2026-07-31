import { Observable } from "@bahatron/utils/lib/observable";

export enum RmCrawlerBusEvents {
    SEARCH_CALL = "search_call",
    ERROR = "error",
    LISTING_PROCESSED = "listing_processed",
    NEW_LISTING = "new_listing",
    LISTING_UPDATED = "listing_updated",
    DETAILS_FETCHED = "detail_call",
    DETAILS_ERROR = "rm_details_error",
}

export const RmCrawlerBus = Observable<RmCrawlerBusEvents>();

export const RmCrawlRunListings: Set<string> = new Set();

export function RmCrawlerEventTracker() {
    let tracker = {
        [RmCrawlerBusEvents.SEARCH_CALL]: 0,
        [RmCrawlerBusEvents.DETAILS_FETCHED]: 0,
        [RmCrawlerBusEvents.LISTING_PROCESSED]: 0,
        [RmCrawlerBusEvents.LISTING_UPDATED]: 0,
        [RmCrawlerBusEvents.NEW_LISTING]: 0,
        [RmCrawlerBusEvents.ERROR]: 0,
        [RmCrawlerBusEvents.DETAILS_ERROR]: 0,
    } as Record<Partial<RmCrawlerBusEvents>, number>;

    return tracker;
}
