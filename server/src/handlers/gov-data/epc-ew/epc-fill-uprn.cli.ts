import { parallelize } from "@bahatron/utils/lib/helpers";
import { CliCommand } from "../../../app/cli-command";
import { $epcEngland } from "../../../models/db/epc-england";
import { $logger } from "../../../utils/logger";
import { logProcess } from "../../../utils/log-progress";

export const FillEpcUPRNCmd = CliCommand({
    name: "epc-fill-uprn",
    handler: fillEPCUprn,
});

export async function fillEPCUprn() {
    $logger.info(`fetching EPCs with missing UPRN`);

    let missing = await $epcEngland
        .knex()
        .select("postcode", "id", "uprn", "building_reference_number")
        .whereNotNull("building_reference_number")
        .where("uprn", null)
        .orWhere("uprn", "");

    $logger.info(`fixing ${missing.length} EPCs with missing UPRN`);

    await logProcess(async (clicker) => {
        await parallelize({
            workers: 20,
            queue: missing,
            handler: async (item) => {
                clicker();

                let records = await $epcEngland.knex().select("uprn").where({
                    building_reference_number: item.building_reference_number,
                    postcode: item.postcode,
                });

                let uprns = Array.from(
                    new Set(records.map((r) => r.uprn).filter(Boolean))
                );

                if (uprns.length !== 1) {
                    if (uprns.length > 1) {
                        $logger.debug(
                            {
                                id: item.building_reference_number,
                                uprns,
                            },
                            "Multiple UPRNs found for building reference number"
                        );
                    }

                    return;
                }

                $logger.info(
                    {
                        id: item.id,
                        uprn: item.uprn,
                        building_reference_number:
                            item.building_reference_number,
                        postcode: item.postcode,
                        found_uprns: uprns,
                    },
                    "Filling EPC UPRN"
                );

                await $epcEngland
                    .knex()
                    .update({ uprn: uprns[0] })
                    .where({ id: item.id });
            },
        });
    });
}
