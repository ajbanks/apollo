import { chunk, times } from "lodash";
import { $rmApiCrawlResults } from "../../models/db/rm-api-crawl-results";
import { $propertyListings } from "../../models/db/property-listings";
import { parallelize } from "@bahatron/utils/lib/helpers";
import { $logger } from "../../utils/logger";
import { CliCommand } from "../../app/cli-command";
import moment from "moment";
import { StopWatch } from "../../utils/stop-watch";

export const ReloadActiveListingsCommand = CliCommand({
    name: "reload-rm-active-listings",
    handler: reloadActiveListings,
});

export async function reloadActiveListings() {
    let timer = StopWatch({ units: "seconds" });

    let lastCrawl = await $rmApiCrawlResults.latest();

    timer.lap("fetch_crawl_results");

    let chunks = chunk(
        (lastCrawl?.result ?? []).map((listingId) => `rm.${listingId}`),
        5000
    );

    let disableResult = await $propertyListings
        .knex()
        .update({ active: false })
        .where({ active: true });

    $logger.info(`disabled ${disableResult} listings`);

    timer.lap("disable_all_listings");

    await parallelize({
        queue: chunks,
        workers: 2,
        handler: async (listingIds) => {
            let start = moment();

            let updateResult = await $propertyListings
                .knex()
                .update({ active: true })
                .whereIn("id", listingIds);

            let diff = moment().diff(start, "seconds", true).toFixed(2);

            $logger.info({ update: updateResult }, `updated batch in ${diff}s`);
        },
    });

    timer.lap("enable_active_listings");

    $logger.info(
        {
            active_count: lastCrawl?.result?.length,
            time: timer.getResults(),
        },
        `reset active/inactive rm listings`
    );
}
