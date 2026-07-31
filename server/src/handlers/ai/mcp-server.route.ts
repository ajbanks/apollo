import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Route } from "../../app/route";
import { mcp } from "../../mcp";
import { HAS_PERMISSIONS } from "../../app/middleware/has-permissions";
import { ApiPermissions } from "../api-management/api-permissions.enum";

export const ExpressMcpServer = Route({
    method: "post",
    route: "/mcp",
    docs: {
        security: true,
        tags: ["MCP"],
    },
    handler: [
        HAS_PERMISSIONS([ApiPermissions.ADMIN]),
        async (req, res) => {
            let transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
            });

            res.on("close", () => {
                console.log("Request closed");
                transport.close();
                mcp.close();
            });

            await mcp.connect(transport);
            await transport.handleRequest(req, res, req.body);
        },
    ],
});
