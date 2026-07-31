import { globSync } from "fs";
import { CliCommand } from "../../../app/cli-command";
import { dumpPath } from "../../../utils/dump-file";
import { buildCensus2021Keys } from "./build-census-keys.cli";
import { cpus } from "os";
import { isMainThread, parentPort, Worker } from "worker_threads";
import { $csv } from "../../../utils/csv";
import { $census2021, Census2021 } from "../../../models/db/census-2021";
import { $logger } from "../../../utils/logger";
import { Resolved } from "@bahatron/utils/lib/types";
import { ExpectationFailed } from "@bahatron/utils/lib/error";

export const LoadCensus2021DataCmd = CliCommand({
    name: "load-census-2021-data",
    handler: async () => {
        let keyMap = await buildCensus2021Keys();

        let files = globSync(dumpPath("**/*.csv"));

        await Promise.all(
            Array.from({ length: cpus().length }).map(async () => {
                let worker: Worker;
                function setupWorker() {
                    worker = new Worker(__filename);
                    worker.on("error", setupWorker);
                }
                setupWorker();

                while (true) {
                    let file = files.pop();

                    if (!file) break;

                    await new Promise<void>((resolve) => {
                        worker.once("exit", resolve);
                        worker.once("message", () => {
                            worker.off("exit", resolve);
                            return resolve();
                        });

                        worker.postMessage({ file, keyMap });
                    });
                }

                await worker!.terminate();
            })
        );
    },
});

if (!isMainThread) {
    parentPort?.on(
        "message",
        async ({
            file,
            keyMap,
        }: {
            file: string;
            keyMap: Resolved<ReturnType<typeof buildCensus2021Keys>>;
        }) => {
            let fileCode = file.split("-").find((path) => path.includes("ts"))!;
            let locationType = file.includes("oa") ? "oa21" : "lad21";

            let data = await $csv.readCsv(file);

            let _cache: Census2021[] = [];

            for (let row of data) {
                $logger.debug(row);

                let locationCode = row["geography code"];

                let entries = Object.entries(row)
                    .filter(([key, val]) => {
                        return ![
                            "date",
                            "geography",
                            "geography code",
                        ].includes(key);
                    })
                    .reduce((fold, [key, value]) => {
                        let map = keyMap[key];

                        if (!map) {
                            $logger.warn(`no map for ${key}`);
                            throw ExpectationFailed(
                                { key, fileCode },
                                "NO_MAP_FOR_KEY"
                            );
                        }

                        if (map.fileCode !== fileCode) {
                            $logger.debug(
                                { file: map.fileCode, fileCode },
                                "file mismatch"
                            );

                            return fold;
                        }

                        fold.push({
                            location_code: locationCode,
                            location_type: locationType,
                            key: map.key,
                            display_name: key,
                            file_code: fileCode,
                            value: Number(value),
                        });

                        return fold;
                    }, [] as Census2021[]);

                _cache = [..._cache, ...entries];

                if (_cache.length >= 1000) {
                    await $census2021.knex().insert(_cache);
                    _cache = [];
                }
            }

            // merge really?
            $census2021
                .knex()
                .insert(_cache)
                .onConflict(["location_code", "key"])
                .merge();

            $logger.info(`finished loading ${file}`);

            parentPort?.postMessage("");
        }
    );
}
