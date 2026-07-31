import os from "os";
import { $locations } from "../../models/db/locations";
import { CliCommand } from "../../app/cli-command";
import { $logger } from "../../utils/logger";
import { Worker, isMainThread, parentPort } from "worker_threads";
import { $h3 } from "../../utils/h3";

const TYPE_LEVEL = {
    default: [7, 9],
    oa21: [7, 9, 11, 13],
    lsoa21: [7, 9, 11, 13],
    msoa21: [7, 9, 11],
    region: [7, 9],
    country: [7, 9],
    fuas: [7, 9, 11],
    fuasc: [7, 9, 11],
    lad23: [7, 9],
    lad21: [7, 9],
    wd21: [7, 9, 11],
    wd23: [7, 9, 11],
    brma25: [7, 9, 11],
    pcon24: [7, 9, 11],
};

export const ParseLocationGeometryCommand = CliCommand({
    name: "process-location-h3",
    description: "Updates location metadata with h3 hexagons",
    options: {
        clean: {
            type: "boolean",
        },
        type: {
            type: "array",
            string: true,
        },
    },
    handler: async ({ type, clean }) => {
        let query = $locations
            .knex()
            .select("code", "type")
            .whereNotNull("geometry");

        if (!clean) {
            query.where(function () {
                this.orWhereNull("h3_7");
                this.orWhereNull("h3_9");
                this.orWhereNull("h3_11");
                this.orWhereNull("h3_13");
            });
        }

        if (type?.length) {
            query.whereIn("type", type);
        }

        let locations = await query;

        $logger.info(
            { query: query.toString(), locations },
            `processing ${locations.length} locations...`
        );

        await Promise.all(
            Array.from({ length: os.cpus().length }).map(async () => {
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
                    let location = locations.pop();

                    if (!location) break;

                    await new Promise<void>((resolve) => {
                        worker.once("exit", resolve);
                        worker.once("message", () => {
                            worker.off("exit", resolve);
                            return resolve();
                        });

                        worker.postMessage({
                            code: location.code,
                            type: location.type,
                            clean,
                        });
                    });
                }

                worker!.terminate();
            })
        );

        $logger.info(`h3 indices calculated`);
    },
});

if (!isMainThread) {
    parentPort?.on(
        "message",
        async ({
            code,
            clean,
            type,
        }: {
            type: string;
            code: string;
            clean: boolean;
        }) => {
            if (clean) {
                await $locations.knex().where({ code }).update({
                    h3_7: null,
                    h3_9: null,
                    h3_11: null,
                    h3_13: null,
                });
            }

            let location = await $locations
                .knex()
                .where({ code, type })
                .first();

            if (!location) return parentPort?.postMessage("");

            let levels = TYPE_LEVEL[type] ?? TYPE_LEVEL.default;

            for (let level of levels) {
                if (!clean && location[`h3_${level}`] !== null) {
                    $logger.info(
                        { code, level },
                        `location already has h3 indices`
                    );

                    continue;
                }

                let indices = $h3.featureToH3Set(location.geometry, level, {
                    ensureOutput: true,
                });

                await $locations
                    .knex()
                    .where({ code })
                    .update({
                        [`h3_${level}`]: indices,
                    });

                $logger.info(
                    {
                        code,
                        level,
                    },
                    "parsed h3 indices"
                );
            }

            return parentPort?.postMessage(code);
        }
    );
}
