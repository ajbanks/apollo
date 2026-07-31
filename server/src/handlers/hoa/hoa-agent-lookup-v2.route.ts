import { AUTHENTICATION_REQUIRED } from "../../app/middleware/auth-required";
import { HAS_PERMISSIONS } from "../../app/middleware/has-permissions";
import { RATE_LIMITED } from "../../app/middleware/rate-limit";
import { Route } from "../../app/route";
import { ApiPermissions } from "../api-management/api-permissions.enum";
import {
    HoaAgentLookupResponseSchema,
    hoaAgentsLookup,
} from "./hoa-agent-lookup";

export const HoaAgentLookupRoute = Route({
    method: "get",
    route: `/hoa/agent-lookup`,

    docs: {
        tags: ["HOA"],
        description: `V2 version of HOA agent lookup.`,
        security: true,
        parameters: [
            {
                in: "query",
                name: "postcode",
                required: true,
                schema: {
                    type: "string",
                },
                description: "The postcode to lookup agents for.",
            },
            {
                in: "query",
                name: "maxRadius",
                schema: {
                    type: "number",
                },
                description:
                    "The maximum search radius in meters to include listings for.",
            },
        ],
        responses: {
            200: {
                schema: HoaAgentLookupResponseSchema,
            },
        },
    },
    handler: [
        HAS_PERMISSIONS([ApiPermissions.HOA_ACCESS]),
        RATE_LIMITED,
        async (req, res) => {
            let result = await hoaAgentsLookup(req.query as any);

            res.json(result);
        },
    ],
});
