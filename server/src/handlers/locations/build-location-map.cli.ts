import { resolve } from "path";
import { CliCommand } from "../../app/cli-command";
import { $csv } from "../../utils/csv";
import { dumpFile } from "../../utils/dump-file";
import { jsonStringify } from "@bahatron/utils/lib/helpers";
import { $logger } from "../../utils/logger";
import { writeFileSync } from "fs";
import { groupBy, pick } from "lodash";
import { ExpectationFailed } from "@bahatron/utils/lib/error";

const TABLE_NAME = "location_hierarchy_lookup";

export const BuildLocationMapCli = CliCommand({
    name: "build-location-map",
    options: {
        clean: {
            type: "boolean",
            default: false,
        },
    },
    handler: async ({ clean }) => {
        let queries = [
            clean && `DROP TABLE IF EXISTS ${TABLE_NAME}`,
            `CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
                location_type String,
                location_code String,
                display_name String,
                search_string String,
            )
            Engine = MergeTree()
            ORDER BY (location_type, location_code)
            `,
        ];

        let data: {
            WD23CD: string;
            WD23NM: string;
            LAD23CD: string;
            LAD23NM: string;
            RGN23CD: string;
            RGN23NM: string;
            CTRY23CD: string;
            CTRY23NM: string;
        }[] = await $csv.readCsv(
            resolve(process.cwd(), `./resources/locations/ward-to-la-2023.csv`)
        );

        let locations = data.map((item) => {
            return {
                wd23: item.WD23CD,
                wd23_name: item.WD23NM,
                lad23: item.LAD23CD,
                lad23_name: item.LAD23NM,
                rgn23: item.RGN23CD,
                rgn23_name: item.RGN23NM,
                ctry23: item.CTRY23CD,
                ctry23_name: item.CTRY23NM,
            };
        });

        let locationTypes = ["wd23", "lad23", "ctry23"];

        let index = 0;
        while (index < locationTypes.length - 1) {
            let current = locationTypes[index];
            let keys = locationTypes.slice(index, index + 2);

            let group = groupBy(locations, locationTypes[index]);

            let map = Object.fromEntries(
                Object.entries(group).map(([key, value]) => {
                    let folded = Array.from(
                        new Set(
                            value.map((item) => {
                                return Array.from(
                                    new Set(
                                        Object.values(
                                            pick(
                                                item,
                                                keys.map((k) => `${k}_name`)
                                            )
                                        )
                                    )
                                ).join(", ");
                            })
                        )
                    );

                    if (folded.length > 1) {
                        throw ExpectationFailed(
                            { current, key, folded },
                            "more than one string for location"
                        );
                    }

                    return [key, folded[0]];
                })
            );

            index++;
        }
    },
});
