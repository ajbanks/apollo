import { jsonParse, parallelize } from "@bahatron/utils/lib/helpers";
import { resolve } from "path";
import { $locations } from "../../models/db/locations";
import { readFileSync } from "fs";
import { $logger } from "../../utils/logger";
import { $csv } from "../../utils/csv";
import { $findThatPostcode } from "../../services/find-that-postcode";
import { parseGeoFeature } from "./parse-geo-feature";
import { StopWatch } from "../../utils/stop-watch";
import { CliCommand } from "../../app/cli-command";

export const LoadFuasLocationsCmd = CliCommand({
    name: "load-fuas-locations-static",
    options: {
        force: {
            alias: "f",
            type: "boolean",
        },
    },
    handler: async (args) => {
        await loadLocations(args.force);
    },
});

async function loadLocations(force = false) {
    let parsers = {
        fuasc: () => loadFuaFile("fuas_oecd_core", "FSC"),
        fuas: () => loadFuaFile("fuas_oecd_commuting", "FS"),
    };

    for (let code of Object.keys(parsers)) {
        await parsers[code]();
    }
}

async function loadFuaFile(name: string, suffix: "FSC" | "FS") {
    let data = jsonParse(
        readFileSync(
            resolve(process.cwd(), `resources/locations/${name}.geojson`)
        ).toString("utf-8")
    );

    let places = data.features as {
        properties: { fuacode: string; fuaname: string };
        geometry:
            | {
                  type: "MultiPolygon";
                  coordinates: [number, number][][][];
              }
            | {
                  type: "Polygon";
                  coordinates: [number, number][][];
              };
    }[];

    await parallelize({
        queue: places,
        workers: 10,
        handler: async (place) => {
            let geoFeature = await parseGeoFeature(place);

            await $locations
                .knex()
                .insert({
                    code: `${place.properties.fuacode}${suffix}`.padEnd(9, "0"),
                    type: suffix === "FS" ? "fuas" : "fuasc",
                    display_name: place.properties.fuaname,
                    geometry: geoFeature,
                })
                .onConflict("code")
                .merge();

            $logger.info(
                {
                    suffix,
                    code: place.properties.fuacode,
                    name: place.properties.fuaname,
                },
                "inserted location"
            );
        },
    });
}
