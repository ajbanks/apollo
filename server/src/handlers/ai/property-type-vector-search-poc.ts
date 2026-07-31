import { raw } from "express";
import { CliCommand } from "../../app/cli-command";
import {
    $propertyTypeMap,
    PropertyTypeMap,
} from "../../models/db/property-type-map";
import { $clickhouse } from "../../services/clickhouse";
import { $logger } from "../../utils/logger";
import { $openai } from "../../services/openai";
import { groupBy, omit } from "lodash";
import { dumpFile, dumpPath } from "../../utils/dump-file";
import { jsonParse, jsonStringify } from "@bahatron/utils/lib/helpers";
import { resolve } from "path";
import { readFile } from "fs/promises";
import { $pg } from "../../services/postgres";
import { $epcEngland } from "../../models/db/epc-england";
import { $landRegistryEngland } from "../../models/db/land-registry-england";
import { $propertyListings } from "../../models/db/property-listings";
import { createHashKey } from "../../utils/create-hash-key";
import { RmToPropertyTypeMap } from "../rightmove/rm-property-type-mapper";

export async function embedPropertyTypeVectors() {
    async function* propertyTypeMapIterator() {
        let lastItem = "";
        while (true) {
            let data = await $propertyTypeMap
                .knex()
                .distinctOn("hash")
                .select("hash", "property_types_clean")
                .where("hash", ">", lastItem)
                .limit(100);

            if (data.length === 0) break;

            lastItem = data[data.length - 1].hash;

            yield data;
        }
    }

    let queries = [
        `
            DROP TABLE IF EXISTS property_type_vector_search
        `,
        `
            CREATE TABLE IF NOT EXISTS property_type_vector_search (
                hash String NOT NULL,
                vector Array(Float32) NOT NULL,
                property_types String NOT NULL
            ) ENGINE = MergeTree()
            ORDER BY (hash)
        `,
    ];

    for (let query of queries) {
        await $clickhouse.client.command({
            query,
        });
    }

    for await (let page of propertyTypeMapIterator()) {
        let embeddings = await $openai.client.embeddings.create({
            model: $openai.EMBED_MODEL,
            input: page.map((item) => item.property_types_clean),
        });

        $logger.info(omit(embeddings, ["data"]), `openai embed response`);

        let rows = page.map((val, i) => {
            return {
                hash: val.hash,
                property_types: val.property_types_clean,
                vector: embeddings.data[i].embedding,
            };
        });

        await $clickhouse.client.insert({
            format: "JSONEachRow",
            table: "property_type_vector_search",
            values: rows,
        });
    }
}

export async function buildPropertyTypeMap() {
    async function* uprnIterator() {
        let lastItem = "";

        while (true) {
            let data = await $epcEngland
                .latestByUprn()
                .whereNotNull("uprn")
                .where({
                    epc_type: "domestic",
                })
                .orderBy("uprn")
                .where("uprn", ">", lastItem)
                .limit(1_000);

            if (!data.length) return;

            lastItem = data[data.length - 1].uprn!;

            yield data.map((val) => val.uprn!);
        }
    }

    for await (let batch of uprnIterator()) {
        let start = performance.now();

        let [epc, transactions, listings] = await Promise.all([
            $epcEngland
                .latestByUprn()
                .where({
                    epc_type: "domestic",
                })
                .select("built_form", "property_type", "uprn")
                .whereIn("uprn", batch),

            $landRegistryEngland
                .knex()
                .select("property_type", "uprn")
                .whereIn("uprn", batch),

            $propertyListings
                .knex()
                .select("property_subtype", "uprn")
                .whereIn("uprn", batch),
        ]);

        let epcMap = groupBy(epc, "uprn");
        let transactionsMap = groupBy(transactions, "uprn");
        let listingsMap = groupBy(listings, "uprn");

        let records = batch.map((uprn) => {
            let epc = epcMap[uprn][0];
            let transactions = transactionsMap[uprn];
            let listings = listingsMap[uprn];

            let propertyTypesRaw = [
                epc.built_form,
                epc.property_type,
                ...(listings ?? []).map((l) => l.property_subtype),
                ...(transactions ?? []).map((t) => t.property_type),
            ];

            let cleaned = Array.from(
                new Set(
                    propertyTypesRaw
                        .filter(
                            (val) =>
                                Boolean(val) &&
                                !["NO DATA!", "Not Recorded"].includes(val!)
                        )
                        .map((val) => {
                            return val!
                                .trim()
                                .toLowerCase()
                                .replaceAll("end of terrace", "end-terrace")
                                .replaceAll("_", "-")
                                .replaceAll(" ", "-");
                        })
                )
            ).join(" ");

            return {
                uprn,
                property_types_raw: propertyTypesRaw,
                property_types_clean: cleaned,
                hash: createHashKey(cleaned),
            };
        });

        await $propertyTypeMap
            .knex()
            .insert(records)
            .onConflict("uprn")
            .ignore();

        $logger.info(
            `inserted ${records.length} records in ${(
                performance.now() - start
            ).toFixed(0)}ms`
        );
    }
}

export async function createVectorSearchQueries() {
    const testSearches = [
        "semi detached house",
        "terraced",
        "end of terrace",
        "duplex",
        "maisonette",
        "bungalow",
        "terraced bungalow",
        "ground flat",
        "new build flat",
        "penthouse",
        "studio",
        "room",
        "purpose built",
        ...Object.keys(RmToPropertyTypeMap),
    ];

    let embeddings = await $openai.client.embeddings.create({
        model: $openai.EMBED_MODEL,
        input: testSearches,
    });

    let map = testSearches.map((item, i) => {
        return {
            key: item,
            embed: embeddings.data[i].embedding,
        };
    });

    await dumpFile(
        "vector-search-poc-queries.json",
        jsonStringify(map, null, 4)
    );

    return map;
}

export async function searchTest() {
    let searchEmbeds =
        (jsonParse(
            await readFile(
                dumpPath("vector-search-poc-queries.json"),
                "utf-8"
            ).catch(() => null)
        ) as { key: string; embed: number[] }[]) ??
        (await createVectorSearchQueries());

    let results: any = [];

    for (let test of searchEmbeds) {
        let { data: result }: any = await $clickhouse.client
            .query({
                query: `
                SELECT
                    property_types,
                    cosineDistance(CAST([${test.embed.join(
                        ", "
                    )}], 'Array(Float32)'), vector) AS score
                FROM property_type_vector_search
                ORDER BY score ASC
                LIMIT 5
            `,
                format: "JSON",
            })
            .then((res) => res.json());

        results.push({
            key: test.key,
            result,
        });
    }

    await dumpFile(
        "vector-search-poc-results.json",
        jsonStringify(results, null, 4)
    );

    $logger.info(results);
}

export async function clusteringTest() {
    let { rows: top } = await $pg.raw(
        `
            SELECT count(hash) as count, hash, property_types_clean
            FROM property_type_map ptm group by hash, property_types_clean 
            ORDER BY count(hash) desc 
            LIMIT 10;
        `
    );

    let { rows: bottom } = await $pg.raw(
        `
            SELECT count(hash) as count, hash, property_types_clean
            FROM property_type_map ptm group by hash, property_types_clean 
            ORDER BY count(hash) asc 
            LIMIT 10;
        `
    );

    let { data: vectors }: any = await $clickhouse.client
        .query({
            query: `SELECT * FROM property_type_vector_search WHERE hash IN (${[
                ...top,
                ...bottom,
            ]
                .map((item) => `'${item.hash}'`)
                .join(", ")})`,
        })
        .then((res) => res.json());

    let results: any[] = [];

    for (let vector of vectors) {
        let { data: similarVectors }: any = await $clickhouse.client
            .query({
                query: `
                SELECT
                    property_types,
                    cosineDistance(CAST([${vector.vector.join(
                        ", "
                    )}], 'Array(Float32)'), vector) AS score
                FROM property_type_vector_search
                WHERE hash != '${vector.hash}'
                ORDER BY score ASC
                LIMIT 5
            `,
            })
            .then((res) => res.json());

        results.push({
            key: vector.property_types,
            neighbors: similarVectors,
        });
    }

    await dumpFile(
        `vector-neighborhood.json`,
        jsonStringify({ top, bottom, results }, null, 4)
    );
}
