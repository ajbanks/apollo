import { booleanContains, flatten } from "@turf/turf";
import { CliCommand } from "../../app/cli-command";
import { $locations } from "../../models/db/locations";
import { GeoFeature } from "./geo.type";
import { dumpFile } from "../../utils/dump-file";
import { jsonStringify } from "@bahatron/utils/lib/helpers";
import { cpus } from "os";
import { isMainThread, parentPort, Worker } from "worker_threads";
import { $logger } from "../../utils/logger";
import { $csv } from "../../utils/csv";
import { resolve } from "path";

export const BuildLocationHierarchyCmd = CliCommand({
    name: "build-location-hierarchy",
    handler: buildLocationHierarchy,
});

export async function buildLocationHierarchy() {
    let result = {} as Record<string, Record<string, string[]>>;

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

    $logger.info(data[0], "loaded map file");

    let countries = Array.from(new Set(data.map((item) => item.CTRY23CD)));
    for (let country of countries) {
        let children = Array.from(
            new Set(
                data
                    .filter((item) => item.CTRY23CD === country)
                    .map((item) => item.RGN23CD)
            )
        );

        result[country] = {
            rgn23: children,
        };
    }

    let regions = Array.from(new Set(data.map((item) => item.RGN23CD)));
    for (let location of regions) {
        let children = Array.from(
            new Set(
                data
                    .filter((item) => item.RGN23CD === location)
                    .map((item) => item.LAD23CD)
            )
        );

        result[location] = {
            lad23: children,
        };
    }

    let lads = Array.from(new Set(data.map((item) => item.LAD23CD)));
    $logger.info(lads.length, "lads");

    for (let location of lads) {
        let children = data
            .filter((item) => item.LAD23CD === location)
            .map((item) => item.WD23CD)
            .flat();

        $logger.info(children, `${location} has ${children.length} children`);

        result[location] = {
            wd23: Array.from(new Set(children)),
        };
    }

    await dumpFile(
        `location-hierarchy-v2.json`,
        jsonStringify(result, null, 4)
    );
}
