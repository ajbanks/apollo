import { createReadStream } from "fs";
import { parser } from "stream-json";
import StreamArray from "stream-json/streamers/StreamArray";
import { pick as StreamPick } from "stream-json/filters/Pick";
import { $locations, Location } from "../../models/db/locations";
import { $logger } from "../../utils/logger";
import { CliCommand } from "../../app/cli-command";
import { parseGeoFeature } from "./parse-geo-feature";
import { TypeMapper } from "./location-loader-mapper.util";
import moment from "moment";

export const LoadLocationFromGeoJSonCmd = CliCommand({
    name: "load-locations-from-geojson",
    options: {
        clean: {
            type: "boolean",
            default: false,
        },
        type: {
            type: "string",
            demandOption: true,
        },
        filePath: {
            type: "string",
            demandOption: true,
        },
    },
    handler: async ({ clean, type, filePath }) => {
        let mapper = TypeMapper(type);

        if (clean) {
            await $locations.knex().where({ type }).delete();
            $logger.warn({ type }, `location data deleted`);
        }

        let _cache: Partial<Location>[] = [];
        async function flushCache() {
            let start = moment();

            await $locations
                .knex()
                .insert(_cache)
                .onConflict(["code", "type"])
                .merge();

            _cache = [];

            $logger.info(
                `cache flushed in ${moment()
                    .diff(start, "seconds")
                    .toFixed(3)}s`
            );
        }

        let stream = createReadStream(filePath, {
            flags: "r",
            encoding: "utf8",
        })
            .pipe(parser())
            .pipe(StreamPick({ filter: "features" }))
            .pipe(new StreamArray());

        let counter = 0;
        for await (let { value: item } of stream) {
            let record = {
                code: mapper.code(item),
                display_name: mapper.display_name(item),
                type,
                meta: item.properties,
                geometry: parseGeoFeature(item),
                h3_7: null,
                h3_9: null,
                h3_11: null,
                date_end: null,
                date_start: null,
            };

            _cache.push(record);
            counter++;

            if (_cache.length >= 500) {
                await flushCache();
            }
        }

        await flushCache();

        $logger.info({ locations: counter }, `data loaded`);
    },
});
