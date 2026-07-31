import { globSync } from "fs";
import { $epcEnglandRecommendations } from "../../../models/db/epc-recommendation";
import { parallelize } from "@bahatron/utils/lib/helpers";
import { resolve } from "path";
import { $csv } from "../../../utils/csv";
import { $logger } from "../../../utils/logger";
import { CliCommand } from "../../../app/cli-command";
import { dumpPath } from "../../../utils/dump-file";
import moment from "moment";

interface DomesticRecommendation {
    LMK_KEY;
    IMPROVEMENT_ITEM;
    IMPROVEMENT_SUMMARY_TEXT;
    IMPROVEMENT_DESCR_TEXT;
    IMPROVEMENT_ID;
    IMPROVEMENT_ID_TEXT;
    INDICATIVE_COST;
}

interface CommercialRecommendation {
    LMK_KEY;
    RECOMMENDATION;
    CO2_IMPACT;
    PAYBACK_TYPE;
    RECOMMENDATION_ITEM;
    RECOMMENDATION_CODE;
}

export const LoadEpcRecommendationsCmd = CliCommand({
    name: "load-epc-recommendations",
    handler: async () => {
        await Promise.all([
            loadEpcEnglandRecommendations({
                path: dumpPath(`/all-non-domestic-certificates`),
                epcType: "commercial",
            }),
            loadEpcEnglandRecommendations({
                path: dumpPath(`/all-domestic-certificates`),
                epcType: "domestic",
            }),
        ]);
    },
});

export async function loadEpcEnglandRecommendations({
    path,
    epcType,
}: {
    path: string;
    epcType: "domestic" | "commercial";
}) {
    let files = globSync(`${path}/**/recommendations.csv`);

    async function flushData(data) {
        await $epcEnglandRecommendations
            .knex()
            .insert(data.map((item) => toDatabaseEntry(item, epcType)))
            .onConflict(["certificate_id", "item"])
            .ignore();
    }

    await parallelize({
        queue: files,
        workers: 10,
        handler: async (fileName) => {
            let items: any[] = [];
            let data = await $csv.readCsvStream(
                resolve(process.cwd(), fileName)
            );

            for await (let item of data) {
                items.push(item);

                if (items.length >= 1_000) {
                    try {
                        await flushData(items);

                        $logger.info(`chunk inserted`);
                    } catch (err) {
                        $logger.warning(err);
                    } finally {
                        items = [];
                    }
                }
            }

            if (items.length) await flushData(items);
        },
    });
}

function toDatabaseEntry(
    item: DomesticRecommendation | CommercialRecommendation,
    type: "domestic" | "commercial"
) {
    if (type === "domestic") {
        let entry = item as DomesticRecommendation;
        return {
            certificate_id: entry.LMK_KEY,
            item: entry.IMPROVEMENT_ITEM,
            recommendation:
                entry.IMPROVEMENT_SUMMARY_TEXT || entry.IMPROVEMENT_DESCR_TEXT,
            indicative_cost: entry.INDICATIVE_COST,
            indicative_roi: null,
            co2_impact: null,
        };
    } else {
        let entry = item as CommercialRecommendation;
        return {
            certificate_id: entry.LMK_KEY,
            item: entry.RECOMMENDATION_ITEM,
            recommendation: entry.RECOMMENDATION,
            indicative_cost: null,
            indicative_roi: entry.PAYBACK_TYPE?.toUpperCase(),
            co2_impact: entry.CO2_IMPACT?.toUpperCase(),
        };
    }
}
