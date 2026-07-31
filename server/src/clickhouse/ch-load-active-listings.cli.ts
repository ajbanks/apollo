import { parallelize, retry } from "@bahatron/utils/lib/helpers";
import {
    parseRmSimplifiedEvents,
    RmSimplifiedModel,
} from "../handlers/rightmove/parse-rm-simplified-events";
import { $clickhouse } from "../services/clickhouse";
import { $propertyListings } from "../models/db/property-listings";
import { $logger } from "../utils/logger";
import { CliCommand } from "../app/cli-command";
import { isMainThread, parentPort, Worker } from "worker_threads";
import { cpus } from "os";
import { chunk } from "lodash";
import { StopWatch } from "../utils/stop-watch";
import { chCreateRmListingEventsTable } from "./ch-rm-listing-events";

const CH_TABLE_NAME = "rm_active_listings";

export const ChLoadActiveListingsCmd = CliCommand({
    name: "ch-load-active-listings",
    handler: loadActiveRmListingstoCH,
});

export async function loadActiveRmListingstoCH() {
    await chCreateRmListingEventsTable(`${CH_TABLE_NAME}_tmp`);

    let activeListings = await $propertyListings
        .knex()
        .select("id")
        .where({ active: true });

    $logger.info(`processing ${activeListings.length} active listings...`);

    let chunks = chunk(
        activeListings.map(({ id }) => id.split(".").pop()!),
        500
    );

    await Promise.all(
        Array.from({ length: Math.ceil(cpus().length / 2) }).map(async () => {
            let worker = new Worker(__filename);

            while (true) {
                let chunk = chunks.pop();

                if (!chunk) break;

                await new Promise<any[]>((resolve) => {
                    worker.once("message", resolve);
                    worker.postMessage({ chunk });
                });
            }

            await worker.terminate();
        })
    );

    $logger.info(`renaming table...`);

    let statements = [
        `DROP TABLE IF EXISTS ${CH_TABLE_NAME}_old SYNC`,
        `RENAME TABLE IF EXISTS ${CH_TABLE_NAME} TO ${CH_TABLE_NAME}_old`,
        `RENAME TABLE ${CH_TABLE_NAME}_tmp TO ${CH_TABLE_NAME}`,
    ];

    for (let statement of statements) {
        await $clickhouse.client
            .command({
                query: statement,
            })
            .catch((err) => {
                $logger.warn(err, `${statement} failed`);
            });
    }
}

if (!isMainThread) {
    parentPort?.on("message", async ({ chunk }) => {
        let timer = StopWatch({ units: "seconds" });

        let events: any = [];

        for (let id of chunk) {
            events = events.concat(await parseRmSimplifiedEvents(id));
        }

        timer.lap("parse_events");

        await retry(async () => {
            await $clickhouse.client.insert({
                table: `${CH_TABLE_NAME}_tmp`,
                format: "JSONEachRow",
                values: events,
            });
        });

        timer.lap("insert_events");

        $logger.info(timer.getResults(), "processed batch");

        return parentPort?.postMessage("");
    });
}
