import { CliCommand } from "../../app/cli-command";
import { loadRmEventsToCH } from "./rm-events-to-ch";

export const ReloadRmEventsCmd = CliCommand({
    name: "ch-reload-rm-events",
    handler: async () => {
        await loadRmEventsToCH();
    },
});
