import moment from "moment";
import { $rmCodes } from "../../models/db/rm-code-map";
import { $proxyV2 } from "../../services/proxy";
import { $logger } from "../../utils/logger";
import { CliCommand } from "../../app/cli-command";
import { StopWatch } from "../../utils/stop-watch";
import { parallelize, retry } from "@bahatron/utils/lib/helpers";
import { generateCrawlV2Urls } from "./crawler-v2/generate-crawl-url";
import { extractSearchPageModel } from "./crawler-v2/crawl-rm-v2";

export const CrawlRmLocationsCmd = CliCommand({
    name: "rm-crawl-locations",
    handler: crawlRmLocations,
});

export async function crawlRmLocations(): Promise<void> {
    let timer = StopWatch({ units: "milliseconds" });

    let codes = [
        generateCodes("REGION", 150000),
        generateCodes("OUTCODE", 50000),
        generateCodes("STATION", 50000),
    ].flat();

    timer.lap("Generated codes");

    await parallelize({
        workers: 5,
        queue: codes,
        handler: async (code) => {
            try {
                let start = moment();

                let testUrl = generateCrawlV2Urls({ locationCode: code })[0];

                let { data, status } = await retry(() => {
                    return $proxyV2({
                        method: "GET",
                        url: testUrl,
                    });
                });

                let pageModel = extractSearchPageModel(data);
                let searchResults = pageModel?.props?.pageProps?.searchResults;

                if (!searchResults) {
                    await $rmCodes.knex().where({ code }).delete();
                } else {
                    await $rmCodes
                        .knex()
                        .insert({ code })
                        .onConflict("code")
                        .ignore();
                }

                $logger.info(
                    {
                        status,
                        time: `${moment().diff(start, "milliseconds")}ms`,
                    },
                    `checked for location code ${code}`,
                );
            } catch (err: any) {
                $logger.warn(err, `Error getting location code response`);
            }
        },
    });
}

function generateCodes(prefix: string, quantity: number) {
    return Array(quantity)
        .fill(null)
        .map((val, i) => `${prefix}^${i + 1}`);
}
