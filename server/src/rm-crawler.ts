import { crawlRmApi } from "./handlers/rightmove/crawl-api";
import {
    RmCrawlerBus,
    RmCrawlerBusEvents,
    RmCrawlerEventTracker,
    RmCrawlRunListings,
} from "./handlers/rightmove/crawler-bus.util";
import { $slack } from "./services/slack";
import cron from "node-cron";
import { $logger } from "./utils/logger";
import { initProcess } from "./utils/init-process";
import { crawlRmLocations } from "./handlers/rightmove/crawl-locations.cli";
import { PostRmCrawlRunQueue } from "./handlers/rightmove/post-crawl-run-processing.queue";
import { StopWatch } from "./utils/stop-watch";
import { $session } from "./app/session.service";
import { crawlRmV2 } from "./handlers/rightmove/crawler-v2/crawl-rm-v2";

initProcess();

// crawl rm locations once a month
cron.schedule("0 0 1 * *", () => {
    $session.run({ process: "crawl-rm-locations" }, crawlRmLocations);
});

let _tracker = RmCrawlerEventTracker();
let _callClicker = 0;
let _apiAverages: number[] = [];

/** @description notifies progress to discord every 6 hours */
cron.schedule("0 0 */6 * * *", slackNotificationHandler);
async function slackNotificationHandler() {
    let sumPartials = _apiAverages.reduce((partial, lap) => partial + lap, 0);

    let average = Number(sumPartials / _apiAverages.length);

    _apiAverages = [];

    await $slack.sendMessage({
        channel: $slack.NOTIFICATIONS,
        text: "",
        context: {
            api_calls_average: `${average.toFixed(2)} calls/min`,
            listings_processed: _tracker.listing_processed.toLocaleString(),
            unique_listings_found: RmCrawlRunListings.size.toLocaleString(),
        },
    });
}

setInterval(async () => {
    _apiAverages.push(_callClicker);
    _callClicker = 0;
}, 60 * 1000);

let callEvents = [
    RmCrawlerBusEvents.SEARCH_CALL,
    RmCrawlerBusEvents.DETAILS_FETCHED,
];

RmCrawlerBus.onEvent((topic, payload) => {
    if (callEvents.includes(topic as any)) {
        _callClicker += 1;
    }

    _tracker[topic] = (_tracker[topic] || 0) + 1;
});

$session.run({ process: `rm-crawler` }, async () => {
    $logger.info(_tracker, `rm crawler started`);

    while (true) {
        let timer = StopWatch({ units: "hours" });

        await crawlRmV2();

        timer.lap("crawl_run");

        await PostRmCrawlRunQueue.add({});

        await $slack
            .sendMessage({
                channel: $slack.NOTIFICATIONS,
                text: `RM CRAWLER CYCLE COMPLETED`,
                context: {
                    time: timer.getResults(),
                    ...Object.fromEntries(
                        Object.entries(_tracker).map(([key, value]) => [
                            key,
                            value?.toLocaleString(),
                        ])
                    ),
                    unique_listings_found:
                        RmCrawlRunListings.size.toLocaleString(),
                },
            })
            .catch($logger.error);

        _tracker = RmCrawlerEventTracker();
    }
});
