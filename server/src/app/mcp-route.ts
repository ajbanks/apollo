import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type McpRoute = ReturnType<typeof McpRoute>;
export function McpRoute(func: (server: McpServer) => void) {
    return {
        isMcpRoute: true,
        register: func,
    };
}
