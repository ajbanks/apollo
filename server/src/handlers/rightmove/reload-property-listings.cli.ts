import { parallelize } from "@bahatron/utils/lib/helpers";
import { CliCommand } from "../../app/cli-command";
import { $mercurios } from "../../services/mercurios";
import { rmTopic } from "./fold-rm-stream";
import { UpdateListingViewQueue } from "./update-listing-view.queue";
import { $logger } from "../../utils/logger";

export const ReloadRMPropertyListingsCmd = CliCommand({
    name: "rm-reload-property-listings",
    handler: async () => {
        let topics = await $mercurios.topics({
            like: `rm_listing%`,
        });

        await parallelize({
            workers: 10,
            queue: topics,
            handler: async (topic) => {
                let id = topic.replace(`rm_listing.`, "");

                await UpdateListingViewQueue.add(
                    {
                        id,
                    },
                    {
                        jobId: rmTopic(id),
                    }
                );

                $logger.info(`queued update listing: ${id}`);
            },
        });
    },
});
