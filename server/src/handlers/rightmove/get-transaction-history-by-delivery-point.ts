import { $logger } from "../../utils/logger";
import { $proxyV2 } from "../../services/proxy";

interface RightmoveTransactionHistory {
    year: string;
    soldPrice: string;
    percentageDifference: string;
}

export async function getTransactionHistoryByDeliveryPoint(
    deliveryPoint,
    encId
): Promise<RightmoveTransactionHistory[] | null> {
    try {
        if (!deliveryPoint) return null;

        let { data } = await $proxyV2({
            url: `https://www.rightmove.co.uk/properties/api/soldProperty/transactionHistory`,
            params: {
                deliveryPoint,
                encId,
            },
        });

        $logger.debug(data, "got transaction history");

        if (!data?.soldPropertyTransactions?.length) {
            return null;
        }

        return data?.soldPropertyTransactions;
    } catch (err) {
        $logger.warning(err, "error while fetching transaction history");
        return null;
    }
}
