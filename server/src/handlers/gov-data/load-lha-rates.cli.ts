import { resolve } from "path";
import { CliCommand } from "../../app/cli-command";
import { $csv } from "../../utils/csv";
import { $logger } from "../../utils/logger";
import { parallelize } from "@bahatron/utils/lib/helpers";
import { $locations } from "../../models/db/locations";
import { $lhaRates } from "../../models/db/lha-rates";

export const LoadLHARatesCommand = CliCommand({
    name: "load-lha-file",
    options: {
        year: {
            type: "string",
            demandOption: true,
        },
        path: {
            type: "string",
        },
    },
    handler: async ({ year, path }) => {
        let filePath = path
            ? path
            : resolve(process.cwd(), "./resources/lha-rates-2024.csv");

        let data = await $csv.readCsv(filePath);

        $logger.info({ sample: data[0] }, "loaded lha file");

        await parallelize({
            workers: 10,
            queue: data,
            handler: async (item) => {
                let name = item["BRMA"];

                let locations = await $locations
                    .knex()
                    .select(`code`, `display_name`, `type`)
                    .whereILike(`display_name`, `%${name}%`);

                let location =
                    locations.length > 1
                        ? locations.find((item) => item.type === "lad23")
                        : locations.shift();

                await $lhaRates
                    .knex()
                    .insert({
                        location_name: name,
                        location_code: location?.code,
                        year,
                        cat_a: sanitize(item["CAT A"]),
                        cat_b: sanitize(item["CAT B"]),
                        cat_c: sanitize(item["CAT C"]),
                        cat_d: sanitize(item["CAT D"]),
                        cat_e: sanitize(item["CAT E"]),
                    })
                    .onConflict(["location_name", "year"])
                    .ignore();

                $logger.info(
                    { name, code: location?.code },
                    `added LHA rate item`
                );
            },
        });
    },
});

function sanitize(num: string) {
    return Number(num.replaceAll(`£`, ``));
}
