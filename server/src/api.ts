import { resolve } from "path";
import { AppServer } from "./app/http-server";
import { $logger } from "./utils/logger";
import { $env } from "./utils/env";
import { $session } from "./app/session.service";
import { QUEUES } from "./queue-workers";
import { REQUEST_LOGGER_MIDDLEWARE } from "./app/middleware/log-request";
import { REQUEST_ID_MIDDLEWARE } from "./app/middleware/request-id";
import { PARSE_REQUEST_SESSION } from "./app/middleware/parse-session";
import { ERROR_HANDLER_MIDDLEWARE } from "./app/middleware/error-handler";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { AUTHENTICATION_REQUIRED } from "./app/middleware/auth-required";
import { chCreateApiLogsTable } from "./clickhouse/ch-create-api-logs-table.cli";

export async function QueueMonitor() {
    let adapter = new ExpressAdapter();

    adapter.setBasePath("/bull");

    let monitor = createBullBoard({
        queues: QUEUES?.map((queue) => new BullMQAdapter(queue.QUEUE)),
        serverAdapter: adapter,
    });

    return {
        adapter,
        monitor,
    };
}

$session.run({ process: `internal-api` }, async () => {
    let monitor = await QueueMonitor();

    await initChTables();

    let server = AppServer({
        routes: resolve(__dirname, "./**/*.route.{ts,js}"),
        swagger: {
            enabled: $env.ENABLE_DOCS,
            engine: "rapidoc",
            info: {
                title: "Apollo API",
                description: "API documentation for Apollo Server",
                // version: "0.1.0",
            },
            securityType: "api_key",
        },
        preRouteMiddleware: [
            REQUEST_LOGGER_MIDDLEWARE,
            REQUEST_ID_MIDDLEWARE,
            PARSE_REQUEST_SESSION,
            ["/bull", monitor.adapter.getRouter()],
        ],
        errorHandler: [ERROR_HANDLER_MIDDLEWARE],
    });

    server.listen($env.PORT, () => {
        $logger.debug(`debug mode enabled`);
        $logger.info(`Server listening in port ${$env.PORT}`);
    });
});

async function initChTables() {
    await chCreateApiLogsTable();
}
