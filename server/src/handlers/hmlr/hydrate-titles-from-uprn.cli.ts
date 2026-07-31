import { CliCommand } from "../../app/cli-command";
import { $idpAddresses } from "../../models/db/idp-addresses";
import { $logger } from "../../utils/logger";
import { getTitleMetaByUprn } from "./get-title-meta-by-uprn";

export const HydrateTitlesFromUprnCmd = CliCommand({
    name: "hmlr-hydrate-titles-from-uprn",
    options: {
        force: {
            type: "boolean",
            default: false,
        },
    },
    handler: async ({ force }) => {
        let stream = await $idpAddresses
            .knex()
            .select("uprn")
            .whereNotNull("uprn")
            .stream();

        for await (let { uprn } of stream) {
            await getTitleMetaByUprn(uprn!, {
                forceUpdate: force,
            })
                .then(() => {
                    $logger.info(`hydrated titles for uprn: ${uprn}`);
                })
                .catch($logger.warn);
        }
    },
});
