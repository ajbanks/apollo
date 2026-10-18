import moment from "moment";
import { $rmCodes } from "../../models/db/rm-code-map";
import { $logger } from "../../utils/logger";
import { CliCommand } from "../../app/cli-command";
import { StopWatch } from "../../utils/stop-watch";
import { parallelize, sleep } from "@bahatron/utils/lib/helpers";
import { generateCrawlV2Urls } from "./crawler-v2/generate-crawl-url";
import { fetchSearchResults } from "./crawler-v2/crawl-rm-v2";
import { retrieveLocationMappingBulk } from "./retrieve-location-mapping";

export const CrawlRmLocationsCmd = CliCommand({
    name: "rm-crawl-locations",
    options: {
        outcodes: {
            type: "string",
            description:
                "comma-separated outcodes to refresh via house-prices mapping (mappa-scrapers approach) instead of brute-forcing OUTCODE^1..3200",
        },
    },
    handler: async (args: any) => {
        const outcodes = String(args?.outcodes ?? "")
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean);
        return outcodes.length
            ? crawlRmLocationsFromOutcodes(outcodes)
            : crawlRmLocations();
    },
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

/**
 * Targeted refresh — resolve plain outcodes ("LU1") to their
 * locationIdentifier via the house-prices page (the mappa-scrapers
 * approach: ~1 request per outcode vs brute-forcing the OUTCODE id space),
 * then upsert into rm_code_map.
 */
export async function crawlRmLocationsFromOutcodes(
    outcodes: string[],
): Promise<void> {
    const timer = StopWatch({ units: "milliseconds" });
    const start = Date.now();

    const mappings = await retrieveLocationMappingBulk(outcodes);

    timer.lap("Mapped outcodes");

    let upserted = 0;
    for (const [outcode, identifier] of Object.entries(mappings)) {
        if (!identifier) {
            $logger.warn({ outcode }, `no identifier found for ${outcode}`);
            continue;
        }
        await $rmCodes.knex().insert({ code: identifier }).onConflict("code").ignore();
        upserted++;
        $logger.info({ outcode, identifier }, `mapped ${outcode} → ${identifier}`);
    }

    $logger.info(
        { upserted, total: outcodes.length, time: `${Date.now() - start}ms` },
        `rm outcode location refresh complete`,
    );
}
