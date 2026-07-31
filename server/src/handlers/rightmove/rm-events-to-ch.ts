import moment from "moment";
import { $mercurios } from "../../services/mercurios";
import { retry } from "@bahatron/utils/lib/helpers";
import { $logger } from "../../utils/logger";
import { $clickhouse } from "../../services/clickhouse";
import { parseRmSimplifiedEvents } from "./parse-rm-simplified-events";
import { $slack } from "../../services/slack";
import { logProcess } from "../../utils/log-progress";
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { cpus } from "node:os";
import { chCreateRmListingEventsTable } from "../../clickhouse/ch-rm-listing-events";

if (!isMainThread) {
    parentPort?.on("message", async ({ topic }) => {
        let id = topic.split(".").pop()!;

        let events = await parseRmSimplifiedEvents(id);

        return parentPort?.postMessage(events);
    });
}

export async function loadRmEventsToCH() {
    await chCreateRmListingEventsTable();

    let now = new Date().toISOString();
    let topics = await $mercurios.topics({
        like: "rm_listing%",
    });

    $logger.info(`upserting events for ${topics.length} listings`);

    let buffer: any[] = [];
    async function flushCache() {
        let data = [...buffer];
        buffer = [];

        let start = moment();

        await retry(
            () => {
                return $clickhouse.client.insert({
                    table: $clickhouse.RM_LISTING_EVENTS,
                    values: data,
                    format: "JSONEachRow",
                });
            },
            {
                tries: 5,
            }
        );

        $logger.info(
            {
                time: `${moment()
                    .diff(start, "seconds", true)
                    .toPrecision(3)}s`,
            },
            `flushed ch rm listing events cache`
        );
    }

    await logProcess(async (clicker) => {
        await Promise.all(
            Array.from({ length: cpus().length }).map(async () => {
                let worker = new Worker(__filename);

                while (true) {
                    clicker();

                    let topic = topics.pop();

                    if (!topic) break;

                    let events = await new Promise<any[]>((resolve) => {
                        worker.once("message", resolve);
                        worker.postMessage({ topic });
                    });

                    buffer = buffer.concat(events);
                    if (buffer.length >= 50_000) {
                        await flushCache();
                    }
                }

                await worker.terminate();
            })
        );
    });

    await flushCache();

    await $slack.sendMessage({
        channel: $slack.NOTIFICATIONS,
        text: "Updated Clickhouse RM Listing Events",
        context: {
            time: `${moment()
                .diff(moment(now), "minutes", true)
                .toFixed(2)} minutes`,
        },
    });
}
