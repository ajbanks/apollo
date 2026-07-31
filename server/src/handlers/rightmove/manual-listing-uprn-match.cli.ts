import { parallelize } from "@bahatron/utils/lib/helpers";
import { CliCommand } from "../../app/cli-command";
import { $propertyListings } from "../../models/db/property-listings";
import { foldStream } from "./fold-rm-stream";
import { parseUPRN } from "./upsert-rm-listing.handler";
import { $logger } from "../../utils/logger";
import { logProcess } from "../../utils/log-progress";

export const ManualListingUprnMatchCommand = CliCommand({
    name: "rm-manual-listing-uprn-match",
    handler: async () => {
        let listings = await $propertyListings
            .knex()
            .select("id")
            .whereNull("uprn")
            .pluck("id");

        await logProcess(async (clicker) => {
            await parallelize({
                queue: listings,
                workers: 20,
                handler: async (listingId) => {
                    clicker();

                    try {
                        let foldId = listingId.split("rm.").pop()!;

                        let fold = await foldStream(foldId);

                        let uprn = await parseUPRN(
                            listingId,
                            fold.data.details
                        );

                        if (uprn) {
                            $logger.info(
                                `matched listing ${listingId} with UPRN ${uprn}`
                            );

                            await $propertyListings
                                .knex()
                                .where({ id: listingId })
                                .update({ uprn });
                        }
                    } catch (err) {
                        $logger.warn(err);
                    }
                },
            });
        });
    },
});
