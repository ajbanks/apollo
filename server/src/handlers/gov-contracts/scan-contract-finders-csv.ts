import { $axios } from "../../utils/axios";
import { $csv } from "../../utils/csv";
import { $logger } from "../../utils/logger";
import { $slack } from "../../services/slack";
import { $proxyV2 } from "../../services/proxy";

const regex = /(hous|resident|property|accommodation)/i;
const columns = [
    "uri",
    "releases/0/tender/title",
    "releases/0/tender/description",
];

export async function scanContractsFromContractFinders() {
    $logger.info(`scanning contracts records...`);

    let response = await $proxyV2({
        url: `https://www.contractsfinder.service.gov.uk/harvester/Notices/Data/CSV/Daily`,
    });

    let contracts = await $csv.stringToJson(response.data);

    let usefulContracts: { url: string }[] = contracts.reduce((fold, item) => {
        let keys = Object.keys(item);

        $logger.debug({ keys, picked: columns }, `columns picked`);

        let tests = [
            columns.some((key) =>
                (item[key] as string | undefined)
                    ?.toLowerCase()
                    ?.includes("data")
            ),

            // regex check
            columns.some((key) => regex.test(item[key])),
        ];

        if (tests.every(Boolean)) {
            fold.push({ url: item[`uri`] });
        }

        return fold;
    }, [] as { url: string }[]);

    if (usefulContracts.length) {
        await $slack.sendMessage({
            channel: $slack.NOTIFICATIONS,
            text: `Found ${usefulContracts.length} possible interesting contracts`,
            context: usefulContracts.map((item) => item.url),
        });
    }
}
