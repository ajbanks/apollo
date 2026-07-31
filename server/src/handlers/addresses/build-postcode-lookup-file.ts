import {
    RecordBatchStreamWriter,
    tableFromArrays,
    tableFromJSON,
    tableToIPC,
} from "apache-arrow";
import { naturalCompare } from "../../utils/natural-compare";
import { normalisePostcode } from "./postcode.utils";
import { jsonStringify } from "@bahatron/utils/lib/helpers";
import { dumpFile, dumpPath } from "../../utils/dump-file";
import { writeFileSync } from "fs";
import { $properties } from "../../models/db/properties";
import { $postcodeMap } from "../../models/db/postcode-map";

export async function buildPostcodeLookupFile() {
    let [mappedPostcodes, propertyPostcodes] = await Promise.all([
        $postcodeMap
            .knex()
            .distinct("postcode")
            .select("postcode")
            .whereNotNull("postcode")
            .where("postcode", "!=", ""),

        $properties
            .knex()
            .distinct("postcode")
            .select("postcode")
            .whereNotNull("postcode")
            .where("postcode", "!=", ""),
    ]);

    let postcodes = Array.from(
        new Set([
            ...mappedPostcodes.map(({ postcode }) => postcode),
            ...propertyPostcodes.map(({ postcode }) => postcode),
        ])
    ).sort((a, b) => {
        return normalisePostcode(a).localeCompare(normalisePostcode(b));
    });

    let map = postcodes.reduce((partial, postcode) => {
        partial[normalisePostcode(postcode)] = postcode;

        return partial;
    }, {} as Record<string, string>);

    await dumpFile(
        `postcodes-test.json`,
        jsonStringify(Object.keys(map), null, 4)
    );

    await dumpFile(`postcodes.json`, jsonStringify(map));

    let table = tableFromArrays({
        value: Object.keys(map),
        display: Object.values(map),
    });

    await writeFileSync(
        dumpPath(`postcodes.arrow`),
        tableToIPC(table, "file"),
        "binary"
    );
}
