import { $env } from "../utils/env";
import { $logger } from "../utils/logger";
import { $axios } from "../utils/axios";
import { YmlFormatter } from "@bahatron/utils/lib/logger/formatters";
import { $session } from "../app/session.service";

enum SlackChannels {
    ERROR_NOTIFICATIONS = "health-monitoring",
    NOTIFICATIONS = "apollo-notifications",
}

export const $slack = {
    ...SlackChannels,
    async sendMessage({
        channel,
        text,
        context = undefined,
    }: {
        channel?: string;
        text: string;
        context?: Object;
    }) {
        let id = $session.getStore()?.process ?? process.pid;

        // disabled for now
        if ($env.DEV_MODE || true) {
            await $logger.warn(context, text);
            return;
        }

        await $axios({
            method: "post",
            url: `https://discord.com/api/webhooks/1438573520610267349/ChPCX1l0ANv23duw6Sp_qjOD9TmyC7EZzvw68vGlH-N7q6Petg4sK4Rf4ELLvhVr_zyp`,
            data: {
                content: `[Apollo:${id}]  ${text}${
                    context ? YmlFormatter(context) : ""
                }`,
            },
        });
    },
};

async function sendSlackMessage({ text, channel, context }) {
    try {
        if (!$env.SLACK_API_KEY) {
            return $logger.warn(
                {
                    text,
                    context,
                },
                `no slack api key, aborted sending slack message`,
            );
        }

        let id = $session.getStore()?.process ?? process.pid;

        await $axios({
            method: "post",
            url: `https://slack.com/api/chat.postMessage`,
            data: {
                channel,
                text: `[Apollo:${id}]  ${text}${
                    context ? YmlFormatter(context) : ""
                }`,
            },
            headers: {
                authorization: `Bearer ${$env.SLACK_API_KEY}`,
            },
        });

        $logger.info(`slack message sent successfully!`);
    } catch (err) {
        $logger.error(err, "error sending slack message");
    }
}
