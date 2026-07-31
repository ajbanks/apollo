import moment from "moment";
import { $landRegistryEngland } from "../../models/db/land-registry-england";

export async function findUPRNbyTransactionHistory({
    transactionHistory,
    postcode,
}): Promise<string | null> {
    let transactions = await $landRegistryEngland
        .knex()
        .select("price", "uprn", "date")
        .where({ postcode });

    let uprns = new Set<string | null>();

    for (let historyItem of transactionHistory) {
        let transaction = transactions.find((item) => {
            let transactionYear = moment(item.date).year();
            let salePrice = Number(
                historyItem.soldPrice.replaceAll(`£`, ``).replaceAll(`,`, ``)
            );

            return (
                transactionYear == historyItem.year && salePrice === item.price
            );
        });

        if (!transaction) return null;

        uprns.add(transaction.uprn);
    }

    return Array.from(uprns).filter(Boolean).shift()!;
}
