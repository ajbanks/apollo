const { watch } = require("fs");

const DEV_MODE = process.env.NODE_ENV !== "production";
const QUEUE_WORKERS = Number(process.env.QUEUE_WORKERS);

const LOG_CONFIG = {
    out_file: "/dev/null",
    error_file: "/dev/null",
};

const WATCH_CONFIG = {
    watch: DEV_MODE && ["dist"],
    kill_timeout: 2500,
};

module.exports = {
    apps: [
        {
            name: "tsc-compiler",
            script: "npm",
            args: ["run", "build:watch"],
            // stop_exit_codes: [0],
            ...LOG_CONFIG,
        },
        {
            name: "api",
            script: "dist/api.js",
            exec_mode: "cluster",
            instances: DEV_MODE ? "1" : "max",
            ...LOG_CONFIG,
            ...WATCH_CONFIG,
        },
        {
            name: "api:tsx",
            script: "tsx",
            args: ["src/api.ts"],
            ...LOG_CONFIG,
            watch: DEV_MODE && ["src"],
        },
        {
            name: "cron",
            script: "dist/cron.js",
            ...LOG_CONFIG,
            ...WATCH_CONFIG,
        },
        {
            name: "workers",
            script: "dist/queue-workers.js",
            exec_mode: "cluster",
            instances: DEV_MODE ? "1" : "max",
            ...DEV_MODE,
            ...LOG_CONFIG,
        },
        {
            name: "rm-crawler",
            script: "dist/rm-crawler.js",
            ...LOG_CONFIG,
            ...WATCH_CONFIG,
        },
    ],
};
