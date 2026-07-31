import { parallelize } from "@bahatron/utils/lib/helpers";
import { CliCommand } from "../../../app/cli-command";
import { $rmAgents } from "../../../models/db/rm-agents";
import { calculateAgentStatistics } from "./calculate-agent-statistics";
import moment from "moment";
import { $slack } from "../../../services/slack";

export const CalculateAgentStatisticsCmd = CliCommand({
    name: "calculate-agent-statistics",
    handler: calculateAllAgentsStatistics,
});

export async function calculateAllAgentsStatistics() {
    let start = moment();

    let agentIds = await $rmAgents.knex().select("id").pluck("id");

    await parallelize({
        workers: 25,
        queue: agentIds,
        handler: calculateAgentStatistics,
    });

    let diff = moment().diff(start, "minutes", true);

    await $slack.sendMessage({
        text: `Agent statistics calculation cron job completed successfully`,
        context: {
            time: `${diff.toFixed(2)} minutes`,
        },
    });
}
