import { CliCommand } from "../../app/cli-command";
import { $listingUprnMap } from "../../models/db/listing-uprn-map";
import { $clickhouse } from "../../services/clickhouse";

const TABLE_NAME = "simon_rm_inspire_uprn";

export const RmMatchListingsToUprnInspireCmd = CliCommand({
    name: "rm-uprn-match-inspire",
    handler: matchListingToUprnInspire,
});

export async function matchListingToUprnInspire(): Promise<void> {
    await $clickhouse.client.command({
        query: `DROP TABLE IF EXISTS ${TABLE_NAME} SYNC`,
    });

    await $clickhouse.client.command({
        query: `
                CREATE TABLE ${TABLE_NAME}
                ENGINE = MergeTree()
                ORDER BY listing_id 
                AS
                    SELECT
                        listing_id,
                        uprn,
                        li.INSPIREID as inspire_id
                    FROM
                        (
                            SELECT
                                INSPIREID,
                                listing_id
                            FROM
                                (
                                    SELECT
                                        INSPIREID,
                                        h3
                                    FROM
                                        inspire_h3
                                    WHERE
                                        INSPIREID IN (
                                            SELECT
                                                INSPIREID
                                            FROM
                                                inspire_uprn_clean
                                            GROUP BY
                                                INSPIREID
                                            HAVING
                                                count(*) = 1
                                        )
                                ) AS ih
                                INNER JOIN (
                                    SELECT
                                        geoToH3 (any (lon), any (lat), 15) AS h3,
                                        id AS listing_id
                                    FROM
                                        rm_listing_events
                                    WHERE
                                        (point_type = 'ACCURATE_POINT')
                                        AND (
                                            listing_id NOT IN (
                                                SELECT
                                                    listing_id
                                                FROM
                                                    listing_uprn_map
                                            )
                                        )
                                    GROUP BY
                                        listing_id
                                ) AS rm ON ih.h3 = rm.h3
                        ) AS li ANY
                        INNER JOIN (
                            SELECT
                                INSPIREID,
                                any (uprn) AS uprn,
                                count(*) AS c
                            FROM
                                inspire_uprn_clean
                            GROUP BY
                                INSPIREID
                            HAVING
                                c = 1
                        ) AS iuc ON li.INSPIREID = iuc.INSPIREID;
        `,
    });

    let stream = await $clickhouse.client
        .query({
            query: `SELECT * FROM ${TABLE_NAME}`,
            format: "JSONEachRow",
        })
        .then((res) => res.stream() as any);

    for await (let items of stream) {
        await $listingUprnMap
            .knex()
            .insert(items.map((record) => record.json()))
            .onConflict("listing_id")
            .ignore();
    }
}
