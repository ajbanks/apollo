import { $probateGazette } from "../../../models/db/probate-gazette";
import moment from "moment";
import { $logger } from "../../../utils/logger";
import { retry } from "@bahatron/utils/lib/helpers";
import { omit } from "lodash";
import { CliCommand } from "../../../app/cli-command";
import { $slack } from "../../../services/slack";
import { $proxyV2 } from "../../../services/proxy";
import { $xml } from "../../../utils/xml";

interface EntryItem {
    id: string;
    link: { "@_href": string; "@_rel": string }[];
    updated: string;
    published: string;
    [key: string]: any;
}

export const IngestProbateFeedCmd = CliCommand({
    name: "ingest-probate-gazette",
    handler: ingestProbateFeed,
});

const client = $proxyV2;

export async function ingestProbateFeed() {
    await $slack.sendMessage({
        channel: $slack.NOTIFICATIONS,
        text: `Probate crawler started`,
    });

    try {
        let now = moment();

        let start = await client({
            method: "get",
            url: "https://www.thegazette.co.uk/wills-and-probate/data.feed",
        });

        let { feed } = $xml.parse(start.data);

        let pages = 0;
        while (++pages < 100) {
            $logger.debug(
                {
                    feed: {
                        ...omit(feed, ["entry"]),
                        sample_entry: feed.entry[0] ?? null,
                    },
                },
                "parsing feed",
            );

            let entries = feed.entry as EntryItem[];

            await Promise.allSettled(entries.map(processEntry));

            let next = feed.link.find((item) => item["@_rel"] == "next");

            $logger.debug({ next }, "next page");

            if (!next) break;

            let response = await client({
                method: "get",
                url: next["@_href"],
            });

            feed = $xml.parse(response.data).feed;

            if (!moment(entries[0].updated).isSame(now, "day")) {
                $logger.info("end of today's feed, stopping crawler");
                break;
            }
        }

        await $slack.sendMessage({
            text: `Probate crawler run completed`,
        });
    } catch (err: any) {
        $logger.error(err);
        await $slack.sendMessage({
            text: `Probate crawler error: ${err.message}`,
        });

        throw err;
    }
}

async function processEntry(entry: EntryItem) {
    let id = entry.id.split("/").pop();
    let updatedAt = moment(entry.updated);
    let publishedAt = moment(entry.published);

    let record = await $probateGazette.knex().where({ id }).first();
    if (record && updatedAt.isSame(moment(record.updated_at))) {
        return;
    }

    let res = await retry(
        () =>
            client({
                method: "get",
                url: `https://www.thegazette.co.uk/notice/${id}/data.json?view=linked-data`,
            }),
        {
            tries: 5,
            timeout: 500,
        },
    );

    await $probateGazette
        .knex()
        .insert({
            id,
            updated_at: updatedAt.toDate(),
            published_at: publishedAt.toDate(),
            feed: entry,
            data: res.data,
        })
        .onConflict("id")
        .merge();

    $logger.info(`feed entry processed and stored: ${id}`);
}
