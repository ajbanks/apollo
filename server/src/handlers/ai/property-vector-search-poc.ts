import { chunk, omit, Truthy } from "lodash";
import { $properties, Property } from "../../models/db/properties";
import { $locations } from "../../models/db/locations";
import moment from "moment";
import { $logger } from "../../utils/logger";
import { dumpFile } from "../../utils/dump-file";
import { jsonStringify } from "@bahatron/utils/lib/helpers";
import { $clickhouse } from "../../services/clickhouse";
import { $openai } from "../../services/openai";

const locations = [
    {
        code: "E06000043",
        type: "lad23",
    },
    {
        code: "E07000061",
        type: "lad23",
    },
    {
        code: "UK008FSC0",
        type: "fuasc",
    },
];

const priceMap = {
    "1995-01-01": {
        price_index: 0.19,
    },
    "1996-01-01": {
        price_index: 0.2,
    },
    "1997-01-01": {
        price_index: 0.21,
    },
    "1998-01-01": {
        price_index: 0.22,
    },
    "1999-01-01": {
        price_index: 0.25,
    },
    "2000-01-01": {
        price_index: 0.28,
    },
    "2001-01-01": {
        price_index: 0.31,
    },
    "2002-01-01": {
        price_index: 0.38,
    },
    "2003-01-01": {
        price_index: 0.45,
    },
    "2004-01-01": {
        price_index: 0.53,
    },
    "2005-01-01": {
        price_index: 0.56,
    },
    "2006-01-01": {
        price_index: 0.58,
    },
    "2007-01-01": {
        price_index: 0.62,
    },
    "2008-01-01": {
        price_index: 0.6,
    },
    "2009-01-01": {
        price_index: 0.59,
    },
    "2010-01-01": {
        price_index: 0.64,
    },
    "2011-01-01": {
        price_index: 0.62,
    },
    "2012-01-01": {
        price_index: 0.63,
    },
    "2013-01-01": {
        price_index: 0.63,
    },
    "2014-01-01": {
        price_index: 0.66,
    },
    "2015-01-01": {
        price_index: 0.7,
    },
    "2016-01-01": {
        price_index: 0.75,
    },
    "2017-01-01": {
        price_index: 0.78,
    },
    "2018-01-01": {
        price_index: 0.8,
    },
    "2019-01-01": {
        price_index: 0.82,
    },
    "2020-01-01": {
        price_index: 0.87,
    },
    "2021-01-01": {
        price_index: 0.94,
    },
    "2022-01-01": {
        price_index: 0.98,
    },
    "2023-01-01": {
        price_index: 0.94,
    },
    "2024-01-01": {
        price_index: 0.98,
    },
    "2025-01-01": {
        price_index: 1,
    },
} as const;

export const PROPERTY_VECTOR_POC_TABLE = "property_vector_search_poc";

export async function generateEmbeddings({ clean = false } = {}) {
    $logger.info(`creating CH table...`);

    let chQueries = [
        clean && `DROP TABLE IF EXISTS ${PROPERTY_VECTOR_POC_TABLE} SYNC`,
        `
            CREATE TABLE IF NOT EXISTS ${PROPERTY_VECTOR_POC_TABLE} (
                uprn UInt64,
                last_sale_price_original Nullable(Int),
                last_sale_price_normalised Nullable(Int),
                content String,
                vector Array(Float32),
            ) ENGINE = MergeTree()
            ORDER BY (uprn)
        `,
    ];

    for (let query of chQueries.filter(Boolean) as any[]) {
        await $clickhouse.client.command({
            query,
        });
    }

    let h3s = await getLocationBoundaries();

    $logger.info(`got ${h3s.length} h3 indexes...`);

    let properties = await $properties.knex().whereIn("h3_9", h3s);

    let { data: alreadyProcessed } = await $clickhouse.client
        .query({
            query: `
            SELECT uprn
            FROM ${PROPERTY_VECTOR_POC_TABLE}
        `,
        })
        .then((res) => res.json<{ uprn: string }>());

    let alreadyProcessedMap = alreadyProcessed.reduce((fold, val) => {
        fold[val.uprn] = true;
        return fold;
    }, {});

    properties = properties.filter((val) => !alreadyProcessedMap[val.uprn]);

    $logger.info(`creating embeddings for ${properties.length} properties...`);

    for (let part of chunk(properties, 1000)) {
        let mapped = part.map((val) => {
            let priceNormalised = normaliseSalePrice(val);
            let sanitised = prepareProperty(val);

            let content = Object.entries({
                ...sanitised,
                last_transaction_price: priceNormalised,
            })
                .map(([key, value]) => `${key}: ${value}`)
                .join("||");

            return {
                uprn: val.uprn,
                last_sale_price_original: val.last_transaction_price,
                last_sale_price_normalised: priceNormalised,
                content: content,
            };
        });

        let embeddings = await $openai.client.embeddings.create({
            model: $openai.EMBED_MODEL,
            input: mapped.map((item) => item.content),
        });

        await $clickhouse.client.insert({
            table: PROPERTY_VECTOR_POC_TABLE,
            format: "JSONEachRow",
            values: mapped.map((item, i) => ({
                ...item,
                vector: embeddings.data[i].embedding,
            })),
        });

        $logger.info(`inserted chunk of ${part.length} properties`);
    }
}

export async function testPropertyVectorSearch() {
    let { data: sample } = await $clickhouse.client
        .query({
            query: `
            SELECT uprn, content, vector
            FROM ${PROPERTY_VECTOR_POC_TABLE}
            LIMIT 100
        `,
        })
        .then((res) => res.json() as any);

    let results: any[] = [];

    for (let item of sample) {
        let { data: result }: any = await $clickhouse.client
            .query({
                query: `
                SELECT
                    uprn, content,
                    cosineDistance(CAST([${item.vector.join(
                        ", "
                    )}], 'Array(Float32)'), vector) AS score
                FROM ${PROPERTY_VECTOR_POC_TABLE}
                ORDER BY score ASC
                LIMIT 5
            `,
                format: "JSON",
            })
            .then((res) => res.json());

        results.push({
            key: item.content,
            uprn: item.uprn,
            result,
        });
    }

    await dumpFile(
        `property-vector-search-poc-results.json`,
        jsonStringify(results, null, 4)
    );
}

async function getLocationBoundaries() {
    let raw = await Promise.all(
        locations.map((loc) =>
            $locations.knex().select("h3_9").where(loc).first()
        )
    );

    return Array.from(new Set(raw.flatMap((val) => val?.h3_9 || [])));
}

function normaliseSalePrice(property: Property) {
    let priceIndex: { price: number; price_index: number } | undefined =
        priceMap[
            moment(property.last_transaction_date)
                .startOf("year")
                .format("YYYY-MM-DD")
        ];

    return !priceIndex
        ? null
        : Number(
              Math.round(
                  property.last_transaction_price! / priceIndex.price_index
              )
          );
}

function prepareProperty(property: Property) {
    return Object.fromEntries(
        Object.entries({
            ...omit(property, [
                "uprn",
                "postcode",
                "address",
                "epc",
                "potential_epc",
                "last_epc_certificate_date",
                "last_transaction_date",
                "last_transaction_id",
                "last_epc_certificate_id",
                "council_tax_band",
            ]),
        }).map(([key, value]) => {
            return [key, ["NODATA!", ""].includes(value as any) ? null : value];
        })
    );
}
