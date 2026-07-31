import { parallelize } from "@bahatron/utils/lib/helpers";
import { chunk } from "lodash";
import { $propertyListings } from "../../models/db/property-listings";
import { $rmApiCrawlResults } from "../../models/db/rm-api-crawl-results";
import { RmListingId } from "./rm-listing-id.util";
import { $logger } from "../../utils/logger";
import { CliCommand } from "../../app/cli-command";
import { $slack } from "../../services/slack";
import { $pg } from "../../services/postgres";

export const ManuallyProcessActiveListings = CliCommand({
    name: "manually-process-active-listings",
    handler: processActiveListings,
});

export async function processActiveListings() {
    try {
        let latestCrawl = await $rmApiCrawlResults.latest();
        let previousCrawl = await $rmApiCrawlResults.fetch(latestCrawl.id - 1);

        let currentlyActiveIds = await $propertyListings
            .knex()
            .select("id")
            .where("active", true)
            .pluck("id");

        let currentlyActive = new Set(currentlyActiveIds);

        let latestMap = latestCrawl.result.reduce((fold, item) => {
            fold[RmListingId(item)] = true;
            return fold;
        }, {} as Record<string, boolean>);

        let previousMap =
            previousCrawl?.result.reduce((fold, item) => {
                fold[RmListingId(item)] = true;
                return fold;
            }, {} as Record<string, boolean>) ?? {};

        let toDisable = Object.keys(previousMap).filter(
            (key) => !latestMap[key]
        );

        let toEnable = Object.keys(latestMap).filter(
            (key) => !previousMap[key] || !currentlyActive.has(key)
        );

        $logger.info(
            {
                latestCrawl: latestCrawl.result.length,
                previousCrawl: previousCrawl?.result.length,
                currentlyActive: currentlyActive.size,
                toDisable: toDisable.length,
                toEnable: toEnable.length,
            },
            "preparing to update"
        );

        await parallelize({
            queue: chunk(toDisable, 5000),
            workers: 2,
            handler: async (listingIds) => {
                await $propertyListings
                    .knex()
                    .whereIn("id", listingIds)
                    .update({
                        active: false,
                        exit_at: $pg.raw(
                            "CASE WHEN exit_at IS NULL THEN ? ELSE exit_at END",
                            [new Date(latestCrawl.timestamp)]
                        ),
                    });
            },
        });

        await parallelize({
            queue: chunk(toEnable, 5000),
            workers: 2,
            handler: async (listingIds) => {
                await $propertyListings
                    .knex()
                    .whereIn("id", listingIds)
                    .update({ active: true });
            },
        });

        await $slack.sendMessage({
            text: `Processed active/inactive listings`,
            context: {
                toDisable: toDisable.length,
                toEnable: toEnable.length,
                latestCrawl: latestCrawl.result.length,
            },
        });
    } catch (err: any) {
        await $slack.sendMessage({
            text: `Error processing active/inactive listings`,
            context: {
                error: `${err.message}`,
            },
        });

        throw err;
    }
}
