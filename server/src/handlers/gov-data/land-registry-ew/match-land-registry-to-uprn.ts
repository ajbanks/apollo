import { parallelize } from "@bahatron/utils/lib/helpers";
import { $landRegistryEngland } from "../../../models/db/land-registry-england";
import { $logger } from "../../../utils/logger";
import { logProcess } from "../../../utils/log-progress";
import { findUprnForLandRegistryTransaction } from "./find-uprn-for-land-registry-transaction";

export async function matchLandRegistryRecordsWithUprn() {
    let landRegistryRecords = await $landRegistryEngland
        .knex()
        .whereNull("uprn")
        .orWhere({ uprn: "" });

    $logger.info(
        `attempting to match ${landRegistryRecords.length} land registry records`
    );

    let successful = 0;

    await logProcess(async (clicker) => {
        await parallelize({
            workers: 20,
            queue: landRegistryRecords,
            handler: async (record) => {
                clicker();

                let uprn = await findUprnForLandRegistryTransaction(record);

                if (!uprn) return;

                $logger.info(`found UPRN for transaction`);

                successful += 1;

                await $landRegistryEngland
                    .knex()
                    .where({ transaction_id: record.transaction_id })
                    .update({ uprn });
            },
        });
    });

    $logger.info(`matched ${successful} land registry records with UPRN`);
}
