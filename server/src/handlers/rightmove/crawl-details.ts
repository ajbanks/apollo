import { $logger } from "../../utils/logger";
import { foldStream, RIGHTMOVE_KEYS } from "./fold-rm-stream";
import { getDiff } from "recursive-diff";
import { parse, sleep } from "@bahatron/utils/lib/helpers";
import { publishRmEvent } from "./publish-event.handler";
import { RmCrawlerBus, RmCrawlerBusEvents } from "./crawler-bus.util";
import { getTransactionHistoryByDeliveryPoint } from "./get-transaction-history-by-delivery-point";
import { sortBy } from "lodash";
import { ExpectationFailed } from "@bahatron/utils/lib/error";
import { fetchRmPage } from "./crawler-v2/crawl-rm-v2";

export async function crawlPropertyDetails(
    id: string | number,
    retry = true
): Promise<void> {
    try {
        $logger.debug({ id }, `crawling rm web details for listing`);

        // Direct fetch — the proxy is refused on detail pages (403) while
        // the search crawler's plain-axios path still works.
        let response = await fetchRmPage(
            `https://www.rightmove.co.uk/properties/${id}`,
        );

        if (response.status === 410) {
            $logger.warn({ id }, "listing gone (410)");
            return;
        }
        if (response.status === 404) return;
        if (response.status !== 200) {
            throw ExpectationFailed({ status: response.status }, `detail page fetch failed`);
        }

        RmCrawlerBus.emit(RmCrawlerBusEvents.DETAILS_FETCHED);

        let details = parsePageModel(response.data);

        if (!details) {
            $logger.warn(`page model not found for listing: ${id}`);

            if (retry) {
                await sleep(5000);
                return crawlPropertyDetails(id, false);
            }

            $logger.warn({ id }, `page model not found`);

            return;
        }

        $logger.info(`got details for listing: ${id}`);

        await processDetails({ details, id });
    } catch (err: any) {
        RmCrawlerBus.emit(RmCrawlerBusEvents.DETAILS_ERROR);

        let status = err?.response?.status;

        $logger.warn(
            {
                message: err.message,
                status,
            },
            "error crawling property details"
        );

        if (
            status == 410 ||
            err?.message === "Request failed with status code 410"
        ) {
            return err.response.data;
        } else if (status == 404) {
            return;
        } else if (status == 400) {
            return crawlPropertyDetails(id);
        }

        throw err;
    }
}

/**
 * Rightmove switched the detail page payload (Oct 2026): pages now embed
 * `window.__PAGE_MODEL = {"data":"<devalue-encoded JSON>"}` — a string of
 * index-linked values where every object/array slot holds an array index
 * rather than the value itself. Decode by resolving indices recursively.
 */
function undeval(arr: any[]): any {
    const cache = new Map<number, any>();
    const decode = (idx: number): any => {
        if (cache.has(idx)) return cache.get(idx);
        const v = arr[idx];
        if (Array.isArray(v)) {
            const out: any[] = [];
            cache.set(idx, out);
            for (const x of v) out.push(decode(x));
            return out;
        }
        if (v && typeof v === "object") {
            const out: Record<string, any> = {};
            cache.set(idx, out);
            for (const [k, i] of Object.entries(v)) out[k] = decode(i as number);
            return out;
        }
        return v;
    };
    return decode(0);
}

export function parsePageModel(html: string) {
    const next = html.match(
        /window\.__PAGE_MODEL\s*=\s*(\{.*?\})[;\n]/s,
    );
    if (next) {
        try {
            const payload = JSON.parse(next[1]);
            const decoded = undeval(JSON.parse(payload.data));
            if (decoded?.propertyData) return decoded.propertyData;
        } catch {
            /* fall through to the legacy format */
        }
    }

    if (!html.includes("window.PAGE_MODEL = ")) return null;

    let substring = html
        .split("window.PAGE_MODEL = ")[1]
        .split("</script>")[0]
        .split(`\n\t`)[0]
        .trim()
        .split("window.adInfo")
        .shift();

    let result = parse(substring)?.propertyData;

    // $logger.debug({ substring, parsed: result });

    return result;
}

async function processDetails({ details, id }: any) {
    try {
        if (!details) {
            return;
        }

        /** Remove unwanted attributes */
        delete details.distance;

        /** consistent order of sizings */
        if (details.sizings && Array.isArray(details.sizings)) {
            details = {
                ...details,
                sizings: sortBy(details.sizings, "unit"),
            };
        }

        let transactionHistory = await getTransactionHistoryByDeliveryPoint(
            details.address?.deliveryPointId,
            details.encId
        );

        if (transactionHistory) {
            details.transactionHistory = transactionHistory;
        }

        let fold = await foldStream(id);

        if (!fold.data[RIGHTMOVE_KEYS.DETAILS]) {
            await publishRmEvent({
                id,
                data: details,
                expectedSeq: fold.lastSeq + 1,
                key: RIGHTMOVE_KEYS.DETAILS,
            });

            return $logger.info({ id }, `new property details found`);
        }

        let delta = getDiff(fold.data[RIGHTMOVE_KEYS.DETAILS], details);

        if (delta.length) {
            await publishRmEvent({
                id,
                data: delta,
                expectedSeq: fold.lastSeq + 1,
                key: RIGHTMOVE_KEYS.DETAILS,
            });

            $logger.info({ id }, `property details updated`);
        }

        RmCrawlerBus.emit(RmCrawlerBusEvents.LISTING_UPDATED);
    } catch (err: any) {
        if (err.code === 417) {
            return processDetails({ details, id });
        }

        throw err;
    }
}
