import { $proxyV2 } from "../../services/proxy";
import { $logger } from "../../utils/logger";
import { foldStream, RIGHTMOVE_KEYS } from "./fold-rm-stream";
import { getDiff } from "recursive-diff";
import { parse, sleep } from "@bahatron/utils/lib/helpers";
import { publishRmEvent } from "./publish-event.handler";
import { RmCrawlerBus, RmCrawlerBusEvents } from "./crawler-bus.util";
import { getTransactionHistoryByDeliveryPoint } from "./get-transaction-history-by-delivery-point";
import { sortBy } from "lodash";
import { ExpectationFailed } from "@bahatron/utils/lib/error";

export async function crawlPropertyDetails(
    id: string | number,
    retry = true
): Promise<void> {
    try {
        $logger.debug({ id }, `crawling rm web details for listing`);

        let response = await $proxyV2({
            method: "get",
            url: `https://www.rightmove.co.uk/properties/${id}`,
        });

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

export function parsePageModel(html: string) {
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
