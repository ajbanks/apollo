import { Logger } from "@bahatron/utils";
import { $env } from "./env";
import { $session } from "../app/session.service";
import { threadId } from "worker_threads";

export const $logger = Logger.Create({
    minLogLevel: $env.LOG_LEVEL,
    formatter: $env.DEV_MODE ? Logger.Formatters.Pretty : undefined,
    id: () => {
        let { requestId, process: script } = $session.getStore() || {};

        if (requestId) return requestId;

        if (script) return `${script}:${process.pid}`;

        return threadId > 0 ? `worker:${threadId}` : `process:${process.pid}`;
    },
});
