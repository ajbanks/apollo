import { CliCommand } from "../app/cli-command";
import { $clickhouse } from "../services/clickhouse";
import { $logger } from "../utils/logger";

const TABLE_NAME = "api_usage_logs";

export const ChCreateApiLogsTableCli = CliCommand({
    name: "ch-create-api-logs-table",
    options: {
        clean: {
            type: "boolean",
            default: false,
            demandOption: false,
        },
    },
    handler: async ({ clean }) => {
        await chCreateApiLogsTable({ clean });
    },
});

export async function chCreateApiLogsTable({ clean = false } = {}) {
    let statements = [
        clean ? `DROP TABLE IF EXISTS ${TABLE_NAME} SYNC` : null,
        `CREATE TABLE IF NOT EXISTS ${TABLE_NAME}
        (
            api_key String NOT NULL,
            endpoint String NOT NULL,
            status_code UInt32 NOT NULL,
            timestamp DateTime64(3, 'UTC') DEFAULT now64(3),
            response_time_ms UInt64 NOT NULL
        ) ENGINE = MergeTree()
        ORDER BY (api_key, status_code, endpoint, timestamp)
        `,
    ].filter(Boolean) as string[];

    for (let statement of statements) {
        await $clickhouse.client
            .command({
                query: statement,
            })
            .catch((err) => {
                if (err.message.includes("already exists")) return;

                throw err;
            });
    }

    $logger.info(`Clickhouse table ${TABLE_NAME} is ready`);
}
