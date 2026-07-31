import { $logger } from "../../../utils/logger";
import { $uprnOs } from "../../../models/db/uprn-os";
import { $csv } from "../../../utils/csv";
import { CliCommand } from "../../../app/cli-command";
import { dumpPath } from "../../../utils/dump-file";

export const LoadUprnFileCommand = CliCommand({
    name: "load-uprn-os-file",
    options: {
        filePath: {
            demandOption: true,
            string: true,
        },
    },
    handler: loadUprnFile,
});

export async function loadUprnFile({ filePath }) {
    let items: any[] = [];
    async function flushData() {
        let prepared = items.map((item) => {
            let uprn = item["﻿UPRN"];

            if (!uprn) {
                $logger.warning(`uprn missing from map csv: ${uprn}`);
            }

            return {
                uprn,
                lat: item.LATITUDE,
                lon: item.LONGITUDE,
                parent_uprn: item?.parentuprn,
            };
        });

        await $uprnOs.knex().insert(prepared).onConflict("uprn").merge();

        items = [];
    }

    let stream = await $csv.readCsvStream(dumpPath(filePath));

    for await (let item of stream) {
        items.push(item);

        if (items.length > 20_000) {
            await flushData();
            $logger.info(item, `flushed batch`);
        }
    }

    if (items.length) await flushData();

    $logger.info(`parse complete`);
}
