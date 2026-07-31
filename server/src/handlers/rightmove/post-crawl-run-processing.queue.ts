import { $bull } from "../../services/bull";
import { $slack } from "../../services/slack";
import { StopWatch } from "../../utils/stop-watch";
import { $session } from "../../app/session.service";
import { loadActiveRmListingstoCH } from "../../clickhouse/ch-load-active-listings.cli";
import { processActiveListings } from "./process-active-listings.cli";

export const PostRmCrawlRunQueue = $bull.Queue(
    "rm_post_crawl_run",
    async () => {
        $session.run({ process: "rm_post_crawl_run" }, async () => {
            let timer = StopWatch({
                units: "minutes",
            });

            await processActiveListings();
            timer.lap("process_active_listings");

            // await loadActiveRmListingstoCH();
            // timer.lap("ch_load_active_listings");

            await $slack.sendMessage({
                channel: $slack.NOTIFICATIONS,
                text: `Post RM crawl processing complete`,
                context: {
                    times: timer.getResults(),
                },
            });
        });
    },
);
