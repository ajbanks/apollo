import { CliCommand } from "../../../app/cli-command";
import { dumpPath } from "../../../utils/dump-file";
import { createReadStream } from "fs";
import StreamArray from "stream-json/streamers/StreamArray";
import { pick } from "stream-json/filters/Pick";
import { parser } from "stream-json";
import moment from "moment";
import { parseGeoFeature } from "../../locations/parse-geo-feature";
import { $floodRisk } from "../../../models/db/flood-risk";
import { $logger } from "../../../utils/logger";
import { createHashKey } from "../../../utils/create-hash-key";

export const LoadFloodRiskCommand = CliCommand({
    name: "load-flood-risk-file",
    options: {
        path: {
            alias: "p",
            type: "string",
        },
    },
    handler: async ({ path }) => {
        await loadFile(path);
    },
});

async function loadFile(path?: string) {
    let fileName =
        path ||
        dumpPath(
            "fulldataset-riskoffloodingfromriversandsea-geojson-output.json"
        );

    let stream = createReadStream(fileName, {
        flags: "r",
        encoding: "utf8",
    })
        .pipe(parser())
        .pipe(pick({ filter: "features" }))
        .pipe(new StreamArray());

    let _cache: any[] = [];
    async function flushCache() {
        let data = [..._cache];
        _cache = [];
        await $floodRisk.knex().insert(data).onConflict("id").ignore();
        $logger.info(`flood risk cache flushed`);
    }

    for await (let { value } of stream) {
        _cache.push(mapItemToRecord(value));

        if (_cache.length >= 1000) {
            await flushCache();
        }
    }

    await flushCache();
}

function mapItemToRecord(item: any) {
    let geo = parseGeoFeature(item);
    let id = createHashKey(item);

    return {
        id,
        flood_risk: item.properties.prob_4band,
        suitability: item.properties.suitability,
        date: moment(item.properties).toDate(),
        geometry: geo,
    };
}
