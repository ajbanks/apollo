import { Gone } from "@bahatron/utils/lib/error";
import { Route } from "../../app/route";
import { $rmAgentLogos } from "../../models/db/rm-agent-logos";
import { $rmAgents } from "../../models/db/rm-agents";
import { kebabCase } from "lodash";
import { HAS_PERMISSIONS } from "../../app/middleware/has-permissions";

export const GetAgentLogoRoute = Route({
    method: "get",
    route: `/hoa/agents/:agentId/logo`,
    docs: {
        tags: ["HOA"],
        security: false,
        parameters: [
            {
                in: "path",
                name: "agentId",
                required: true,
                schema: {
                    type: "string",
                },
                description: "The ID of the agent to get the logo for.",
            },
        ],
        responses: {
            200: {
                schema: {
                    type: "string",
                    format: "binary",
                },
                description: "The agent logo image.",
            },
        },
    },
    handler: [
        async (req, res) => {
            let { agentId }: any = req.params;

            let [agent, agentLogo] = await Promise.all([
                $rmAgents.knex().where({ id: agentId }).first(),
                $rmAgentLogos.knex().where({ agent_id: agentId }).first(),
            ]);

            if (!agentLogo || !agent) throw Gone();

            let img = Buffer.from(agentLogo.data, "base64");

            res.setHeader("Content-Type", agentLogo.content_type);

            res.send(img);
        },
    ],
});
