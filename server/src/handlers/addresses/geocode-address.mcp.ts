import { McpRoute } from "../../app/mcp-route";
import z from "zod";
import { $logger } from "../../utils/logger";
import { jsonStringify } from "@bahatron/utils/lib/helpers/json-stringify";
import { geocodeAddress } from "./geocode-address";

export const GeocodeAddressMcp = McpRoute((server) => {
    server.registerTool(
        "geocode-address",
        {
            title: "Geocode Address",
            description: "Translate user query into well known address codes",
            inputSchema: {
                query: z
                    .string()
                    .describe("The user's query about an address or location"),
            },
        },
        async (params) => {
            $logger.info(params, `geocode address mcp route triggered`);

            let { query } = params;

            let location = await geocodeAddress(query);

            return {
                content: [
                    {
                        type: "text",
                        text: jsonStringify(location),
                    },
                ],
                // structuredContent: location,
            };
        }
    );
});
