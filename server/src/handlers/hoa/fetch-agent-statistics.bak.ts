import { pick } from "lodash";
import { HAS_PERMISSIONS } from "../../app/middleware/has-permissions";
import { RATE_LIMITED } from "../../app/middleware/rate-limit";
import { Route } from "../../app/route";
import {
    $rmAgentStatistics,
    AgentStatisticsRecordSchema,
    AgentStatisticsV2Schema,
} from "../../models/db/rm-agent-statistics";
import { $schema } from "../../utils/json-schema";
import { ApiPermissions } from "../api-management/api-permissions.enum";
import { ExpectationFailed } from "@bahatron/utils/lib/error";
import { $logger } from "../../utils/logger";

/**
 * @description disabled as per contract
 */
export const FetchHoaAgentsRoute = Route({
    method: "get",
    route: "/hoa/agents/statistics",
    docs: {
        disabled: true,
        tags: ["HOA"],
        badges: [{ label: "HoA", color: "blue" }],
        parameters: [
            {
                in: "query",
                name: "agent_ids",
                schema: $schema.Array($schema.String()),
                required: true,
                description:
                    "List of agent IDs to fetch statistics for, max 100 items",
            },
        ],
        responses: {
            200: {
                schema: $schema.Array(
                    $schema.Intersect([
                        AgentStatisticsRecordSchema,
                        $schema.Object({
                            statistics: AgentStatisticsV2Schema,
                        }),
                    ])
                ),
            },
        },
    },
    handler: [
        RATE_LIMITED,
        HAS_PERMISSIONS([ApiPermissions.HOA_ACCESS]),
        async (req, res) => {
            $logger.info(req.query);

            let { agent_ids } = $schema.validate(
                req.query,
                $schema.Object({
                    agent_ids: $schema.Array($schema.String(), {
                        maxItems: 100,
                    }),
                })
            );

            res.json(await fetchAgentStatistics(agent_ids));
        },
    ],
});

export async function fetchAgentStatistics(agent_ids: string[]) {
    let records = await $rmAgentStatistics
        .knex()
        .whereIn("agent_id", agent_ids);

    return records.map((agent) => {
        return {
            ...agent,
            statistics: (agent.statistics ?? {})["RES_BUY"],
            sample: agent.sample.filter(
                (listing) => listing.channel === "RES_BUY"
            ),
        };
    });
}
