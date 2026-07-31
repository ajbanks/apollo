import { $clickhouse } from "../../services/clickhouse";
import { CliCommand } from "../../app/cli-command";

const TABLE_NAME = "mixed_used_matching_v1";

export const MixedUsedBuildingsV1MatchingCmd = CliCommand({
    name: "match-mixed-used-buildings-v1",
    handler: calculateMixedUsedMatches,
});

export async function calculateMixedUsedMatches(): Promise<void> {
    let mixedUsedMatch = `
            WITH
            latest_epc AS (
                SELECT *
                FROM epc_data_england
                WHERE lodgement_datetime >= NOW() - INTERVAL '10 years'
                ORDER BY lodgement_datetime DESC
                LIMIT 1 BY uprn, epc_type
            ),
            insp_multi AS (
                SELECT ins.INSPIREID
                FROM latest_epc epc
                JOIN inspire_uprn_clean ins ON latest_epc.uprn = ins.uprn
                WHERE epc.epc_type IN ('commercial','domestic')
                GROUP BY ins.INSPIREID
                HAVING COUNT(DISTINCT latest_epc.epc_type) = 2
            )
            SELECT
                im.INSPIREID AS inspire_id,
                le.uprn AS uprn,
                le.id AS epc_id,
                le.epc_type,
                le.lodgement_date,
                up.lat,
                up.lon,
                le.address,
                le.postcode,
                le.property_type,
                le.total_floor_area,
                ins.plot_area_sqm
            FROM latest_epc AS le
            JOIN inspire_uprn_clean ins ON le.uprn = ins.uprn
            JOIN insp_multi      im    ON ins.INSPIREID = im.INSPIREID
            JOIN uprn_os         up    ON le.uprn = up.uprn
            ORDER BY im.INSPIREID DESC, le.epc_type;
        `;

    let queries = [
        `DROP TABLE IF EXISTS default.${TABLE_NAME} SYNC`,
        `CREATE TABLE default.${TABLE_NAME}
         ENGINE = MergeTree() 
         ORDER BY inspire_id
         AS
         ${mixedUsedMatch}
        `,
    ];

    for (let query of queries) {
        await $clickhouse.client.command({
            query: query,
        });
    }
}
