import { $slack } from "../../services/slack";
import { StopWatch } from "../../utils/stop-watch";
import { CliCommand } from "../../app/cli-command";
import { matchLandRegistryRecordsWithUprn } from "./land-registry-ew/match-land-registry-to-uprn";
import { execute } from "@bahatron/utils/lib/helpers";
import { buildProperties } from "../properties/build-properties.cli";
import { reloadActiveListings } from "../rightmove/reload-active-listings.cli";
import { fillEPCUprn } from "./epc-ew/epc-fill-uprn.cli";

export const GovFilePostProcessCommand = CliCommand({
    name: "post-process-gov-file",
    handler: main,
});

async function main() {
    let timer = StopWatch({ units: "minutes" });

    await fillEPCUprn();
    timer.lap(`epc_uprn`);

    await matchLandRegistryRecordsWithUprn();
    timer.lap(`matching`);

    await buildProperties();
    timer.lap(`property_map`);

    await $slack.sendMessage({
        channel: $slack.NOTIFICATIONS,
        text: `Post GOV file load finished successfully`,
        context: timer.getResults(),
    });
}

if (require.main === module) {
    execute(main);
}
