import { ExpectationFailed } from "@bahatron/utils/lib/error";
import { CliCommand } from "../../../app/cli-command";
import { $csv } from "../../../utils/csv";
import { dumpPath } from "../../../utils/dump-file";
import { $logger } from "../../../utils/logger";
import {
    BRIGHTON_LOCATION_CODE,
    BrightonHmoMapper,
} from "./brighton-hmo-registry";
import {
    $hmoRegistryLog,
    $hmoRegistryProperties,
    HmoRegistryProperty,
} from "../../../models/db/hmo-registry";
import { parallelize } from "@bahatron/utils/lib/helpers";
import moment from "moment";
import { chunk } from "lodash";
import {
    EASTBOURNE_DISTRICT_CODE,
    EastbourneHmoMapper,
} from "./eastbourne-hmo-registry";

/**
 * @description Code of valid mapping function per district code
 */
const HMO_REGISTRY_PROCESSORS: Record<
    string,
    (val: any) => Promise<HmoRegistryProperty>
> = {
    [BRIGHTON_LOCATION_CODE]: BrightonHmoMapper,
    [EASTBOURNE_DISTRICT_CODE]: EastbourneHmoMapper,
};

export const LoadHmoRegistryFileCmd = CliCommand({
    name: "load-hmo-registry-file",
    options: {
        file: {
            alias: "f",
            demandOption: true,
            type: "string",
            description: "relative to .dumps folder",
        },
        code: {
            alias: "c",
            demandOption: true,
            type: "string",
        },
    },
    handler: async ({ file, code }) => {
        if (!HMO_REGISTRY_PROCESSORS[code]) {
            throw ExpectationFailed("LOCATION_CODE_INVALID");
        }

        let data = await $csv.readCsv(dumpPath(file));

        let mapped: Record<string, HmoRegistryProperty> = {};
        await parallelize({
            workers: 10,
            queue: data,
            handler: async (item) => {
                let result = await HMO_REGISTRY_PROCESSORS[code](item);
                if (result && result.address) {
                    mapped[result.id] = result;
                }
            },
        });

        let chunks = chunk(Object.values(mapped), 1000);
        for (let chunk of chunks) {
            await $hmoRegistryProperties
                .knex()
                .insert(chunk)
                .onConflict("id")
                .merge();
        }

        await $hmoRegistryLog
            .knex()
            .insert({
                location_code: code,
                process_date: moment().format("YYYY-MM-DD"),
            })
            .onConflict(["location_code", "process_date"])
            .ignore();

        $logger.info(
            { record: Object.values(mapped).length },
            `file processed`
        );
    },
});
