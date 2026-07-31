import { parallelize, sleep } from "@bahatron/utils/lib/helpers";
import { CliCommand } from "../../app/cli-command";
import { $logger } from "../../utils/logger";
import { parseShapeFile } from "./parse-shapefile";
import { parseGeoFeature } from "./parse-geo-feature";
import { $locations } from "../../models/db/locations";
import { GeoFeature } from "./geo.type";
import { TypeMapper } from "./location-loader-mapper.util";
import { omit } from "lodash";

export const LoadLocationsFromShapefile = CliCommand({
    name: "load-locations-from-shapefile",
    options: {
        filePath: {
            type: "string",
            demandOption: true,
            description: `Absolute Path`,
        },
        type: {
            type: "string",
            demandOption: true,
        },
    },
    handler: async ({ filePath, type }) => {
        let _cache: any[] = [];
        async function flushCache() {
            await $locations
                .knex()
                .insert(_cache)
                .onConflict(["code", "type"])
                .ignore();

            $logger.info(`cache flushed`);
        }

        let mapper = TypeMapper(type);
        await parseShapeFile(filePath, async (item) => {
            $logger.debug(omit(item, "geometry"), `processing record...`);

            let display_name = mapper.display_name(item);
            let code = mapper.code(item);

            _cache.push({
                display_name,
                code,
                meta: item.properties,
                type,
                geometry: parseGeoFeature(item),
            });

            if (_cache.length >= 1_000) {
                await flushCache();
            }
        });

        await flushCache();

        $logger.info(`done`);
    },
});
