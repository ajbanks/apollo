import { buildGenerators, RmUrlGenerator } from "./request-generator";
import { $logger } from "../../utils/logger";
import { $proxyV2 } from "../../services/proxy";
import { getDiff } from "recursive-diff";
import { foldStream, RIGHTMOVE_KEYS } from "./fold-rm-stream";
import { parallelize, sleep } from "@bahatron/utils/lib/helpers";
import { stringify } from "@bahatron/utils/lib/helpers";
import { $rmApiCrawlResults } from "../../models/db/rm-api-crawl-results";
import { URL } from "url";
import { $rmCodes } from "../../models/db/rm-code-map";
import { $env } from "../../utils/env";
import { publishRmEvent } from "./publish-event.handler";
import {
    RmCrawlerBus,
    RmCrawlerBusEvents,
    RmCrawlRunListings,
} from "./crawler-bus.util";

const MIN_BEDROOMS = 0;
const MAX_BEDROOMS = 5;

export async function crawlRmApi() {
    RmCrawlRunListings.clear();

    let codes = (await $rmCodes.knex().select("code")) ?? [];

    await parallelize({
        queue: codes,
        workers: $env.RM_API_WORKERS,
        handler: async ({ code }) => {
            let generators = buildGenerators({
                minBedrooms: MIN_BEDROOMS,
                maxBedrooms: MAX_BEDROOMS,
                locationCode: code,
            });

            for (let generator of generators) {
                await rightmoveSpider({
                    generator,
                });
            }
        },
    });

    await $rmApiCrawlResults.add({
        timestamp: new Date().toISOString(),
        result: stringify(Array.from(RmCrawlRunListings)),
    });
}

const MUTED_ERRORS = ["getaddrinfo EAI_AGAIN", "connect ECONNREFUSED"];
/**
 * @todo refactor tries for a generic retryer helper
 */
async function rightmoveSpider({
    generator,
    index = 0,
    tries = 0,
}: {
    generator: RmUrlGenerator;
    index?: number;
    tries?: number;
}): Promise<void> {
    let { url, locationCode } = generator(index);

    let query: Record<string, any> = {};
    new URL(url).searchParams.forEach((value, name) => {
        query[name] = value;
    });

    if (tries > 5) {
        return;
    }

    try {
        $logger.debug(
            {
                query,
                try_number: tries,
            },
            `crawling rm url..`
        );

        let response = await $proxyV2({ method: "get", url });

        RmCrawlerBus.emit(RmCrawlerBusEvents.SEARCH_CALL);

        for (let property of response.data.properties) {
            await processApiResult({
                property,
                locationCode,
            });
        }

        if (response.data?.pagination?.next) {
            return rightmoveSpider({
                generator,
                index: response.data.pagination.next,
            });
        }

        return;
    } catch (err: any) {
        RmCrawlerBus.emit(RmCrawlerBusEvents.ERROR);

        if (err?.response?.status == 400) {
            await sleep(1000 + Math.floor(Math.random() * 1500));

            return rightmoveSpider({
                generator,
                index,
                tries: tries + 1,
            });
        }

        if (MUTED_ERRORS.some((msg) => err?.message?.includes(msg))) {
            return;
        }

        $logger.error(err, "error in spider");
    }
}

export async function processApiResult({
    property,
    locationCode,
}: {
    property: any;
    locationCode: string;
}): Promise<void> {
    if (!property || !property.id) {
        return $logger.warn(
            {
                property,
                locationCode,
            },
            `rm listing id not found`
        );
    }

    let id = property.id;

    $logger.debug(`processing rm listing: ${id}`);

    RmCrawlRunListings.add(id);

    RmCrawlerBus.emit(RmCrawlerBusEvents.LISTING_PROCESSED);

    // remove undesired attributes
    delete property.featuredProperty;
    delete property.saved;
    delete property.hidden;
    delete property.heading;
    delete property.showOnMap;
    delete property.contactUrl;
    delete property.formattedDistance;
    delete property.distance;
    delete property.premiumListing;
    delete property.staticMapUrl;
    delete property.enhancedListing;
    delete property.hasBrandPlus;

    try {
        let fold = await foldStream(id).catch((err) => null);

        if (!fold) {
            $logger.info({ id, locationCode }, `new listing found`);

            await publishRmEvent({
                id,
                data: {
                    locationCodes: [locationCode],
                    ...property,
                },
                expectedSeq: 1,
                key: "api",
            });

            return RmCrawlerBus.emit(RmCrawlerBusEvents.NEW_LISTING);
        }

        property.locationCodes = Array.from(
            new Set([
                ...(fold.data[RIGHTMOVE_KEYS.API]?.locationCodes ?? []),
                locationCode,
            ])
        );

        let delta = getDiff(fold.data[RIGHTMOVE_KEYS.API], property);

        if (!delta.length) {
            return;
        }

        $logger.info(
            { id, locationCode, lastSeq: fold.lastSeq },
            `updating listing...`
        );

        await publishRmEvent({
            id,
            data: delta,
            expectedSeq: fold.lastSeq + 1,
            key: RIGHTMOVE_KEYS.API,
        });

        return RmCrawlerBus.emit(RmCrawlerBusEvents.LISTING_UPDATED);
    } catch (err: any) {
        if (err.code == 417) {
            /** Topic already exists — read the fold and update with correct seq */
            try {
                let fold = await foldStream(id).catch(() => null);

                if (fold) {
                    property.locationCodes = Array.from(
                        new Set([
                            ...(fold.data[RIGHTMOVE_KEYS.API]?.locationCodes ?? []),
                            locationCode,
                        ]),
                    );

                    let delta = getDiff(fold.data[RIGHTMOVE_KEYS.API], property);

                    if (!delta.length) {
                        return;
                    }

                    $logger.info(
                        { id, locationCode, lastSeq: fold.lastSeq },
                        `updating listing after 417...`,
                    );

                    await publishRmEvent({
                        id,
                        data: delta,
                        expectedSeq: fold.lastSeq + 1,
                        key: RIGHTMOVE_KEYS.API,
                    });

                    return RmCrawlerBus.emit(RmCrawlerBusEvents.LISTING_UPDATED);
                }
            } catch (retryErr: any) {
                $logger.error(
                    { id, error: retryErr?.message },
                    `failed to recover from 417 for listing`,
                );
            }
            return;
        }

        RmCrawlerBus.emit(RmCrawlerBusEvents.ERROR);
        $logger.error(err, `error processing rm api listing`);
    }
}
