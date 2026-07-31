import { CliCommand } from "../../app/cli-command";
import { buildPropertyFromUprn } from "./build-property-from-uprn";

export const ManualBuildPropertyCmd = CliCommand({
    name: "manual-build-property",
    options: {
        uprn: {
            alias: "u",
            demandOption: true,
            type: "string",
        },
    },
    handler: async (args) => {
        await buildPropertyFromUprn(args.uprn);
    },
});
