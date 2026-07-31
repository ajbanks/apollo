import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { $logger } from "./utils/logger";
import { globSync } from "fs";
import { resolve } from "path";
import { McpRoute } from "./app/mcp-route";

export const mcp = new McpServer({
    name: "Galactus MCP Server",
    version: "0.0.0",
});

globSync(resolve(__dirname, "./**/*.mcp.{js,ts}")).forEach((filePath) => {
    $logger.debug(`loading mcp file: ${filePath}`);

    let module = require(filePath);

    try {
        for (let [key, value] of Object.entries(module)) {
            if ((value as McpRoute).isMcpRoute) {
                (value as McpRoute).register(mcp);

                $logger.info({ filePath }, `Registered MCP route: ${key}`);
            }
        }
    } catch (err) {
        $logger.warn(err);
    }
});

if (require.main === module) {
    let transport = new StdioServerTransport();
    mcp.connect(transport).then(() => {
        $logger.info(`MCP server started with stdio transport`);
    });
}
