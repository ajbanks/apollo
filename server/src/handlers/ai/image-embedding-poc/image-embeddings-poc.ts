import { jsonParse, jsonStringify, retry } from "@bahatron/utils/lib/helpers";
import { $clickhouse } from "../../../services/clickhouse";
import { $imageBucket } from "../../../services/image-bucket";
import { generateText } from "ai";
import { $ai } from "../ai.client";
import { $logger } from "../../../utils/logger";
import { $pg } from "../../../services/postgres";
import { $imageMap } from "../../../models/db/image-map";
import { $propertyListings } from "../../../models/db/property-listings";
import { groupBy } from "lodash";
import { dumpFile } from "../../../utils/dump-file";
import { parseDatabaseUrl } from "../../../utils/parse-database-url";
import { $env } from "../../../utils/env";
import sample from "./image-sample";
// import Replicate from "replicate";
import { $axios } from "../../../utils/axios";

// const replicate = new Replicate({
//     auth: process.env.REPLICATE_TOKEN,
// });

$logger.warn({
    REPLICATE_TOKEN: process.env.REPLICATE_TOKEN,
    VOYAGE_TOKEN: process.env.VOYAGE_TOKEN,
});

const TABLE_NAME = "image_embeddings_poc_2025";

const Prompts = {
    property: `
    Create a detailed description of the image, focusing on the property's features, style, and surroundings. 
    Use descriptive language to highlight key aspects such as state of the property, furniture, and any unique characteristics.
    Optimise the description for embedding generation
    `,

    floor_plan: `
    Create a detailed description of the floor plan, focusing on the layout, room sizes, and overall design. 
    Use descriptive language to highlight key aspects such as the position of the kitchen towards the entrance, size and type of rooms per floor, etc.
    Optimise the description for embedding generation
    `,
};

export async function createPgTable() {
    await $pg.schema.createTableIfNotExists(TABLE_NAME, (table) => {
        table.string("listing_id").notNullable();
        table.string("image_url").notNullable();
        table.string("image_type").notNullable();
        table.text("description").notNullable();
        table.text("clip_vector");
        table.text("voyage_vector");
        table.text("voyage_vector_img_only");
    });
}

export async function createChTable(clean = false) {
    let postgres = parseDatabaseUrl($env.DATABASE_URL);

    let queries = [
        clean && `DROP TABLE IF EXISTS ${TABLE_NAME} SYNC`,
        `
            CREATE TABLE IF NOT EXISTS ${TABLE_NAME}
            ENGINE = MergeTree()
            ORDER BY (image_type, listing_id, image_url) 
            AS
                SELECT *
                FROM postgresql(
                    '${postgres.host}',
                    '${postgres.db}',
                    '${TABLE_NAME}',
                    '${postgres.user}',
                    '${postgres.password}'
                );
        `,
    ].filter(Boolean) as string[];

    for (let query of queries) {
        await $clickhouse.client.command({
            query,
        });
    }
}

export async function buildSample() {
    await createPgTable();

    for (let image of sample) {
        let listingId = image.id;

        for (let img of image.images) {
            let RECORD_REFERENCE = { image_url: img.original_url };

            let record = await $pg
                .table(TABLE_NAME)
                .where(RECORD_REFERENCE)
                .first();

            if (!record) {
                record = {
                    listing_id: listingId,
                    image_url: img.original_url,
                    image_type: img.type,
                };

                await $pg.table(TABLE_NAME).insert(record);

                $logger.info(`record created for ${img.original_url}`);
            }

            let imageData = await $imageBucket.fetchImageBuffer({
                key: img.id,
            });

            $logger.info(`fetched image ${img.id} of type ${imageData.type}`);

            if (!record.description) {
                let description = await generateText({
                    model: $ai.models.base,
                    system: Prompts[img.type],
                    messages: [
                        {
                            role: "user",
                            content: [
                                {
                                    type: "file",
                                    mediaType: imageData.type,
                                    data: imageData.data,
                                },
                            ],
                        },
                    ],
                });

                $logger.info(description, `generated description`);

                await $pg.table(TABLE_NAME).where(RECORD_REFERENCE).update({
                    description: description.text,
                });
            }

            // if (!record.clip_vector) {
            //     $logger.info(`generating clip vector for ${img.original_url}`);

            //     let { embedding }: any = await retry(
            //         () => {
            //             return replicate.run("openai/clip", {
            //                 input: {
            //                     image: img.original_url,
            //                 },
            //             });
            //         },
            //         {
            //             factor: 2,
            //         }
            //     );

            //     await $pg
            //         .table(TABLE_NAME)
            //         .where(RECORD_REFERENCE)
            //         .update({
            //             clip_vector: jsonStringify(embedding),
            //         });

            //     $logger.info(`clip vector saved for ${img.original_url}`);
            // }

            if (!record.voyage_vector) {
                let { data: response } = await $axios<VoyageResponse>({
                    method: "post",
                    url: "https://api.voyageai.com/v1/multimodalembeddings",
                    headers: {
                        Authorization: `Bearer ${process.env.VOYAGE_TOKEN}`,
                    },
                    data: {
                        model: "voyage-multimodal-3",
                        inputs: [
                            {
                                content: [
                                    {
                                        type: "text",
                                        text: record.description,
                                    },
                                    {
                                        type: "image_base64",
                                        image_base64: `data:${
                                            imageData.type
                                        };base64,${imageData.data.toString(
                                            "base64"
                                        )}`,
                                    },
                                ],
                            },
                        ],
                    },
                });

                $logger.info(response.usage, `voyager response`);

                await dumpFile(
                    `${img.id}.json`,
                    jsonStringify(response, null, 4)
                );

                await $pg
                    .table(TABLE_NAME)
                    .where(RECORD_REFERENCE)
                    .update({
                        voyage_vector: jsonStringify(
                            response.data[0].embedding
                        ),
                    });
            }

            if (!record.voyage_vector_img_only) {
                let { data: response } = await $axios<VoyageResponse>({
                    method: "post",
                    url: "https://api.voyageai.com/v1/multimodalembeddings",
                    headers: {
                        Authorization: `Bearer ${process.env.VOYAGE_TOKEN}`,
                    },
                    data: {
                        model: "voyage-multimodal-3",
                        inputs: [
                            {
                                content: [
                                    {
                                        type: "image_base64",
                                        image_base64: `data:${
                                            imageData.type
                                        };base64,${imageData.data.toString(
                                            "base64"
                                        )}`,
                                    },
                                ],
                            },
                        ],
                    },
                });

                $logger.info(response.usage, `voyager response`);

                await $pg
                    .table(TABLE_NAME)
                    .where(RECORD_REFERENCE)
                    .update({
                        voyage_vector_img_only: jsonStringify(
                            response.data[0].embedding
                        ),
                    });
            }
        }
    }
}

interface VoyageResponse {
    object: string;
    data: {
        object: string;
        embedding: number[];
        index: number;
    }[];
    model: string;
    usage: {
        text_tokens: number;
        image_pixels: number;
        total_tokens: number;
    };
}

async function getDataSample() {
    let stream = await $propertyListings
        .knex()
        .select("id", "images")
        .where({ channel: "RES_BUY" })
        .orderBy("last_added_at")
        .limit(200)
        .stream();

    let sample: {
        id: string;
        images: { type: string; id: string; original_url: string }[];
    }[] = [];

    for await (let row of stream) {
        if (
            row.id === "rm.13164921" ||
            row.images.some((val) => val.original_url.includes("sanity"))
        ) {
            continue;
        }

        let images = await $imageMap.knex().whereIn(
            "original_url",
            row.images.map((i) => i.original_url)
        );

        let imageMap = images.reduce((fold, val) => {
            fold[val.original_url] = val.id;
            return fold;
        }, {});

        let byType = groupBy(
            row.images.filter((val) => imageMap[val.original_url]),
            (val) => val.type
        );

        if (byType["floor_plan"]?.length && byType["property"]?.length) {
            sample.push({
                id: row.id,
                images: [
                    {
                        ...byType["floor_plan"][0],
                        id: imageMap[byType["floor_plan"][0].original_url],
                    },
                    {
                        ...byType["property"][0],
                        id: imageMap[byType["property"][0].original_url],
                    },
                    {
                        ...byType["property"][1],
                        id: imageMap[byType["property"][1].original_url],
                    },
                    {
                        ...byType["property"][2],
                        id: imageMap[byType["property"][2].original_url],
                    },
                ],
            });
        }

        if (sample.length >= 30) break;
    }

    await dumpFile(`image-sample.json`, jsonStringify(sample, null, 4));

    return sample;
}
