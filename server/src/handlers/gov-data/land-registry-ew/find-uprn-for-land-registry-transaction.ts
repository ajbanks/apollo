import moment from "moment";
import { $epcEngland } from "../../../models/db/epc-england";
import {
    $landRegistryEngland,
    LandRegistryRecord,
} from "../../../models/db/land-registry-england";
import { $logger } from "../../../utils/logger";

export async function findUprnForLandRegistryTransaction(
    entry: LandRegistryRecord
) {
    let epcItems = await $epcEngland
        .knex()
        .select("address", "uprn")
        .where({ postcode: entry.postcode })
        .whereNotNull("uprn")
        .whereRaw("lodgement_date >= NOW() - INTERVAL '10 years'")
        // .where({ epc_type: "domestic" })
        .where("uprn", "!=", "");

    let lrAddresses = [
        normalise(`${entry.paon} ${entry.street}`),
        normalise(`${entry.paon} ${entry.street} ${entry.locality}`),
        normalise(`${entry.paon} ${entry.street} ${entry.town_or_city}`),
        normalise(
            `${entry.paon} ${entry.street} ${entry.locality} ${entry.town_or_city}`
        ),
        normalise(`${entry.saon} ${entry.paon} ${entry.street}`),
        normalise(
            `${entry.saon} ${entry.paon} ${entry.street} ${entry.locality}`
        ),
        normalise(
            `${entry.saon} ${entry.paon} ${entry.street} ${entry.town_or_city}`
        ),
    ];

    let uprns = epcItems.reduce((fold, item) => {
        let epcAddress = normalise(item.address);

        if (lrAddresses.some((val) => epcAddress.startsWith(val))) {
            fold.push(item.uprn!.trim());
        }
        return fold;
    }, [] as string[]);

    let uniqueUprns = Array.from(new Set(uprns)).filter(Boolean);

    if (uniqueUprns.length === 1) {
        $logger.info(
            {
                transaction_id: entry.transaction_id,
                uprn: uniqueUprns[0],
            },
            `matching LR item with UPRN... successful`
        );

        return uniqueUprns[0];
    }

    let pastTransactions = await $landRegistryEngland
        .knex()
        .where({
            postcode: entry.postcode,
            paon: entry.paon,
            saon: entry.saon,
        })
        .where("date", "<", moment(entry.date).toDate());

    let pastTransactionsUprns = Array.from(
        new Set(pastTransactions.map((val) => val.uprn!).filter(Boolean))
    );

    if (pastTransactionsUprns.length === 1) {
        $logger.info(
            {
                transaction_id: entry.transaction_id,
                uprn: pastTransactionsUprns[0],
            },
            `matching LR item with UPRN from past transactions... successful`
        );

        return pastTransactionsUprns[0];
    }

    return null;
}

function normalise(str: string) {
    return str.replaceAll(",", "").trim().toLowerCase();
}
