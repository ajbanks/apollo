import { resolve } from "path";
import {
    $landRegistryEngland,
    PROPERTY_TYPE_MAP,
    DURATION_MAP,
    PPD_MAP,
    RECORD_STATUS_MAP,
    NEW_BUILD_MAP,
    LandRegistryRecord,
} from "../../../models/db/land-registry-england";
import { $logger } from "../../../utils/logger";
import { CliCommand } from "../../../app/cli-command";
import { $csv } from "../../../utils/csv";
import { LandRegistryToPropertyTypeMap } from "../../properties/property-type.values";

// Property Type D = Detached, S = Semi-Detached, T = Terraced, F = Flats/Maisonettes, O = Other
// Duration Relates to the tenure: F = Freehold, L= Leasehold etc.

// PPD Category Type Indicates the type of Price Paid transaction.
// A = Standard Price Paid entry, includes single residential property sold for full market value.
// B = Additional Price Paid entry including transfers under a power of sale/repossessions, buy-to-lets (where they can be identified by a Mortgage) and transfers to non-private individuals. Note that category B does not separately identify the transaction types stated. HM Land Registry has been collecting information on Category A transactions from January 1995. Category B transactions were identified from October 2013.

// Record Status - monthly file only Indicates additions, changes and deletions to the records.(see guide below).
// A = Addition
// C = Change
// D = Delete.

export const LoadLandRegistryEnglandCmd = CliCommand({
    name: "load-lr-england-file",
    handler: loadLandRegistryEnglandFile,
});

const HEADERS_ARRAY = [
    "transaction_id",
    "price",
    "date",
    "postcode",
    "property_type",
    "new_build",
    "duration",
    "paon",
    "saon",
    "street",
    "locality",
    "town_or_city",
    "district",
    "county",
    "ppd",
    "record_status",
];

const fileName = () => {
    return resolve(process.cwd(), `.dumps/pp-complete.csv`);
};

const MAPPING_RULES = {
    property_type: (value) => PROPERTY_TYPE_MAP[value],
    new_build: (value) => NEW_BUILD_MAP[value],
    duration: (value) => DURATION_MAP[value],
    ppd: (value) => PPD_MAP[value],
    record_status: (value) => RECORD_STATUS_MAP[value],
};

export async function loadLandRegistryEnglandFile() {
    let start = new Date();

    let stream = $csv.readCsvStream(fileName(), {});

    let data: any[] = [];
    for await (let item of stream) {
        data.push(item);

        if (data.length >= 1_000) {
            await flushData(data, start);

            data = [];
        }
    }

    if (data.length) {
        await flushData(data, start);
    }

    $logger.info(`land registry file loaded`);
}

async function flushData(data: any[][], publishDate: Date) {
    let parsed = data.map((row) => {
        return HEADERS_ARRAY.reduce((partial, key, i) => {
            let value = row[i];

            partial[key] = MAPPING_RULES[key]?.(value) ?? value;

            return {
                ...partial,
                publish_date: publishDate,
            };
        }, {} as LandRegistryRecord);
    });

    await $landRegistryEngland
        .knex()
        .insert(parsed)
        .onConflict("transaction_id")
        .ignore();

    $logger.info(`flushed chunk`);
}
