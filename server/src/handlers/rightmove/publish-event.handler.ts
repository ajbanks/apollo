import { $mercurios } from "../../services/mercurios";
import { RightmoveKeys, rmTopic } from "./fold-rm-stream";
import { UpdateListingViewQueue } from "./update-listing-view.queue";
import { $logger } from "../../utils/logger";
import { CrawlDetailsQueue } from "./detail-crawler.queue";
import { $slack } from "../../services/slack";
import { ExpectationFailed } from "@bahatron/utils/lib/error";

export const RM_NOTIFICATION_TOPIC = "rm_event_published";
export interface RmEventNotification {
    id: string;
    key: RightmoveKeys;
}

export async function publishRmEvent({
    data,
    expectedSeq,
    id,
    key,
}: {
    data: any;
    expectedSeq: number;
    id: string;
    key: RightmoveKeys;
}) {
    await $mercurios.append(rmTopic(id), {
        data,
        expectedSeq,
        key,
    });

    switch (key) {
        case "api": {
            await CrawlDetailsQueue.add({ id }, { jobId: `rm_details_${id}` })
                .then(() => $logger.info({ id }, `queued detail crawl`))
                .catch((err) =>
                    $slack.sendMessage({
                        text: `Error Storing RM event`,
                        channel: $slack.NOTIFICATIONS,
                        context: err,
                    })
                );
            break;
        }
        case "details": {
            await queueRmListingUpdate(id, true);
            $logger.info({ id }, `queued view update`);
            break;
        }
        default: {
            throw ExpectationFailed("UNKOWN_RM_EVENT_KEY");
        }
    }
}

/**
 * @todo: this seems like a handler
 */
export async function queueRmListingUpdate(id: string, active?: boolean) {
    try {
        await UpdateListingViewQueue.add(
            {
                id,
                active,
            },
            { jobId: rmTopic(id) }
        );
    } catch (err: any) {
        await $slack.sendMessage({
            text: `Error Storing RM event`,
            channel: $slack.NOTIFICATIONS,
            context: err,
        });
    }
}
