import moment from "moment";
import { $rmCodes } from "../../models/db/rm-code-map";
import { $logger } from "../../utils/logger";
import { CliCommand } from "../../app/cli-command";
import { StopWatch } from "../../utils/stop-watch";
import { parallelize, sleep } from "@bahatron/utils/lib/helpers";
import { generateCrawlV2Urls } from "./crawler-v2/generate-crawl-url";
import { fetchSearchResults } from "./crawler-v2/crawl-rm-v2";

export const CrawlRmLocationsCmd = CliCommand({
    name: "rm-crawl-locations",
    handler: crawlRmLocations,
});

/**
 * Rebuild rm_code_map by probing Rightmove's OUTCODE id space.
 *
 * OUTCODE^N ids are alphabetical and dense — verified Oct 2026:
 * OUTCODE^1 = AB10 … OUTCODE^2900 = YO23, nothing beyond ~3000. The previous
 * implementation brute-forced 250k REGION/OUTCODE/STATION ids through the
 * paid proxy; this scans ~3k codes direct via the cheap _next/data JSON
 * route instead. Outcodes alone give complete national coverage — the
 * crawler fans each outcode out per-bedroom anyway, so REGION/STATION codes
 * would only add overlapping requests.
 */
export async function crawlRmLocations(): Promise<void> {
    let timer = StopWatch({ units: "milliseconds" });

    let codes = Array.from(
        { length: 3200 },
        (_, i) => `OUTCODE^${i + 1}`,
    );

    timer.lap("Generated codes");

    let found = 0;

    await parallelize({
        workers: 5,
        queue: codes,
        handler: async (code) => {
            try {
                let start = moment();

                // res-let URL — any channel works, we only need searchResults
                let testUrl = generateCrawlV2Urls({ locationCode: code })[1];

                let { searchResults } = await fetchSearchResults(
                    new URL(testUrl),
                );

                await sleep(150 + Math.floor(Math.random() * 300));

                if (!searchResults) {
                    await $rmCodes.knex().where({ code }).delete();
                } else {
                    await $rmCodes
                        .knex()
                        .insert({ code })
                        .onConflict("code")
                        .ignore();
                    found++;
                }

                $logger.info(
                    {
                        code,
                        found: !!searchResults,
                        time: `${moment().diff(start, "milliseconds")}ms`,
                    },
                    `checked location code ${code}`,
                );
            } catch (err: any) {
                $logger.warn(
                    { code, error: err?.message },
                    `Error getting location code response`,
                );
            }
        },
    });

    $logger.info({ found, total: codes.length }, `rm location crawl complete`);
}
