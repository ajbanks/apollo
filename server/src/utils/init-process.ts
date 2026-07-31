import { $session } from "../app/session.service";
import { $logger } from "./logger";
import { $slack } from "../services/slack";

export function initProcess() {
    ["SIGINT"].map((event) => {
        process.on(event, (params) => {
            $logger.warning({ params }, `received SIGINT event, exiting...`);

            process.exit(0);
        });
    });

    [`uncaughtException`, `unhandledRejection`].map((event) => {
        process.on(event, async (err) => {
            await $slack.sendMessage({
                channel: $slack.ERROR_NOTIFICATIONS,
                text: `[Critical Error]: ${err?.message}`,
                context: {
                    stack: err.stack,
                    ...($session.getStore() ?? {}),
                },
            });

            $logger.error(err, event);
            process.exit(-1);
        });
    });
}
