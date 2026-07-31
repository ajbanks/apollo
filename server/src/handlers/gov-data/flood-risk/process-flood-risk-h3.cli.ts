import { Worker, isMainThread, parentPort } from "worker_threads";
import { $floodRisk } from "../../../models/db/flood-risk";
import { $logger } from "../../../utils/logger";
import { $h3 } from "../../../utils/h3";
import { CliCommand } from "../../../app/cli-command";
import { cpus } from "os";

export const ProcessFloodRiskH3Cmd = CliCommand({
    name: "flood-risk-process-h3",
    options: {
        quick: {
            type: "boolean",
        },
    },
    handler: processFloodRiskH3,
});

if (!isMainThread) {
    parentPort?.on("message", async ({ id, quick }) => {
        let record = await $floodRisk.knex().where({ id }).first();

        if (!record) return parentPort?.postMessage("");

        for (let level of [9, 11]) {
            if (quick && record[`h3_${level}`].length) {
                continue;
            }

            let h3 = $h3.featureToH3Set(record?.geometry, level, {
                ensureOutput: true,
            });

            await $floodRisk
                .knex()
                .where({ id })
                .update({ [`h3_${level}`]: h3 });

            $logger.info({ level, id }, `loaded flood risk item h3 index`);
        }

        parentPort?.postMessage("");
    });
}

export async function processFloodRiskH3({ quick = false }) {
    let query = $floodRisk.knex().select("id");

    if (quick) {
        query.whereNull("h3_11").orWhereNull("h3_9");
    }

    $logger.debug(query.toString());

    let ids = await query;

    await Promise.all(
        Array(cpus().length)
            .fill(null)
            .map(async () => {
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
                    let id = ids.pop();

                    if (!id) break;

                    await new Promise((resolve) => {
                        worker.once("message", resolve);
                        worker.once("exit", resolve);
                        worker.postMessage({ ...id, quick });
                    });
                }

                await worker!.terminate();
            })
    );
}
