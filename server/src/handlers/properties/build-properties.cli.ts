import { parallelize } from "@bahatron/utils/lib/helpers";
import { CliCommand } from "../../app/cli-command";
import { $epcEngland, EpcCertificate } from "../../models/db/epc-england";
import { $logger } from "../../utils/logger";
import moment from "moment";
import { $slack } from "../../services/slack";
import { isMainThread, parentPort, Worker } from "worker_threads";
import { chunk, sortBy } from "lodash";
import { $uprnOs, UprnOS } from "../../models/db/uprn-os";
import {
    $propertyListings,
    PropertyListing,
} from "../../models/db/property-listings";
import {
    $landRegistryEngland,
    LandRegistryRecord,
} from "../../models/db/land-registry-england";
import { $properties, Property } from "../../models/db/properties";
import { buildProperty } from "./build-property-from-uprn";
import { StopWatch } from "../../utils/stop-watch";
import { $clickhouse } from "../../services/clickhouse";

export const BuildPropertiesCommand = CliCommand({
    name: "build-properties",
    options: {
        clean: {
            demandOption: false,
            default: false,
            type: "boolean",
        },
    },
    handler: async (options) => {
        await buildProperties(options);
    },
});

export async function buildProperties({ clean = false } = {}) {
    let start = moment();

    let uprns = await $epcEngland
        .knex()
        .distinct("uprn")
        .select("uprn")
        .whereNotNull("uprn")
        .whereNot(`property_type`, "Park Home")
        .where("uprn", "!=", "");

    $logger.info(`found ${uprns.length} addresses`);

    let chunks = chunk(
        uprns.map(({ uprn }) => uprn),
        500
    );

    await Promise.all(
        // 10 workers is clogging the server
        Array.from({ length: 5 }).map(async () => {
            let worker: Worker;
            function setupWorker() {
                worker = new Worker(__filename);
                worker.on("error", (err) => {
                    $logger.warn(
                        { err, workerId: worker.threadId },
                        "worker error"
                    );
                    worker.terminate();
                    setupWorker();
                });
            }
            setupWorker();

            while (true) {
                let _chunk = chunks.pop();
                if (!_chunk) break;

                await new Promise<void>((resolve) => {
                    worker.once("exit", resolve);
                    worker.once("message", () => {
                        worker.off("exit", resolve);
                        return resolve();
                    });

                    worker.postMessage({
                        uprnList: _chunk,
                        clean,
                    });
                });
            }
        })
    );

    await $slack.sendMessage({
        channel: $slack.NOTIFICATIONS,
        text: `Property Map built`,
        context: {
            time: `${moment().diff(start, "minutes").toFixed(2)} minutes`,
        },
    });
}

if (!isMainThread) {
    parentPort?.on(
        "message",
        async ({
            uprnList,
            clean,
        }: {
            uprnList: string[];
            clean?: boolean;
        }) => {
            let timer = StopWatch({ units: "milliseconds" });

            $logger.debug(
                {
                    uprnList: uprnList.length,
                },
                "build properties by uprn"
            );

            let [epcs, uprns, listings, transactions, { data: inspireIds }] =
                await Promise.all([
                    $epcEngland
                        .knex()
                        .distinctOn("uprn")
                        .whereIn("uprn", uprnList)
                        .orderBy([
                            {
                                column: "uprn",
                                order: "asc",
                            },
                            {
                                column: "lodgement_date",
                                order: "desc",
                            },
                        ]),
                    $uprnOs.knex().whereIn("uprn", uprnList),
                    $propertyListings.knex().whereIn("uprn", uprnList),
                    $landRegistryEngland.knex().whereIn("uprn", uprnList),
                    $clickhouse.client
                        .query({
                            query: `
                            SELECT INSPIREID as inspire_id, uprn 
                            FROM inspire_uprn_clean 
                            WHERE uprn IN (${uprnList.join(",")})
                        `,
                        })
                        .then((res) => res.json() as any),
                ]);

            timer.lap("fetch_data");

            let epcMap = epcs.reduce((acc, epc) => {
                if (!acc[epc.uprn!]) {
                    acc[epc.uprn!] = [];
                }
                acc[epc.uprn!].push(epc);
                return acc;
            }, {} as Record<string, EpcCertificate[]>);

            let uprnMap = uprns.reduce((acc, record) => {
                if (!acc[record.uprn!]) {
                    acc[record.uprn!] = [];
                }
                acc[record.uprn!].push(record);
                return acc;
            }, {} as Record<string, UprnOS[]>);

            let listingMap = listings.reduce((acc, record) => {
                if (!acc[record.uprn!]) {
                    acc[record.uprn!] = [];
                }
                acc[record.uprn!].push(record);

                return acc;
            }, {} as Record<string, PropertyListing[]>);

            let transactionMap = transactions.reduce((acc, record) => {
                if (!acc[record.uprn!]) {
                    acc[record.uprn!] = [];
                }
                acc[record.uprn!].push(record);
                return acc;
            }, {} as Record<string, LandRegistryRecord[]>);

            let grouped = uprnList.reduce(
                (map, uprn) => {
                    map[uprn] = {
                        listings: listingMap[uprn] || [],
                        uprns: uprnMap[uprn] || [],
                        transactions: transactionMap[uprn] || [],
                        epcs: epcMap[uprn] || [],
                    };

                    return map;
                },

                {} as Record<
                    string,
                    {
                        listings: PropertyListing[];
                        uprns: UprnOS[];
                        transactions: LandRegistryRecord[];
                        epcs: EpcCertificate[];
                    }
                >
            );

            let result: Property[] = [];
            await parallelize({
                workers: 10,
                queue: Object.keys(grouped),
                handler: async (uprn) => {
                    let property = await buildProperty({
                        uprn: uprnMap[uprn]?.[0],
                        transaction: sortBy(transactionMap[uprn], "date")?.[0],
                        epcCertificate: sortBy(
                            epcMap[uprn],
                            "lodgement_date"
                        )?.[0],
                        listings: sortBy(listingMap[uprn], "last_crawled_at"),
                    }).catch((err) => undefined);

                    if (property) result.push(property as Property);
                },
            });

            timer.lap("property_map");

            await $properties
                .knex()
                .insert(result)
                .onConflict("uprn")
                [clean ? "merge" : "ignore"]();

            timer.lap("insert");

            $logger.info(
                {
                    times: timer.getResults(),
                },
                "processed property batch"
            );

            return parentPort?.postMessage("");
        }
    );
}
