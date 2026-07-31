import { Resolved } from "@bahatron/utils/lib/types";
import { applyDiff } from "recursive-diff";
import { $mercurios } from "../../services/mercurios";
import { ExpectationFailed } from "@bahatron/utils/lib/error";
import { $logger } from "../../utils/logger";
import { jsonParse, jsonStringify } from "@bahatron/utils/lib/helpers";

export const rmTopic = (id: string) => {
    if (id.toString().startsWith(`rm_listing.`)) {
        return id;
    }

    return `rm_listing.${id}`;
};

export const RIGHTMOVE_KEYS = {
    API: "api",
    DETAILS: "details",
} as const;

export type RightmoveKeys =
    (typeof RIGHTMOVE_KEYS)[keyof typeof RIGHTMOVE_KEYS];

export type RightmoveFold = Resolved<ReturnType<typeof foldStream>>;

export async function foldStream(id: string) {
    let events = await $mercurios.filter(rmTopic(id));

    if (!events) throw ExpectationFailed({ id }, "NO_EVENTS_FOUND_FOR_LISTING");

    let data = events.reduce((fold, event) => {
        let data = jsonParse(jsonStringify(event.data));

        if (!fold[event.key!]) {
            fold[event.key!] = data;
            return fold;
        }

        fold[event.key!] = applyDiff(fold[event.key!], data);

        return fold;
    }, {} as any);

    let root = events[0];
    let tail = events[events.length - 1];

    return {
        data,
        events,
        root,
        tail,
        lastSeq: tail.seq,
    };
}
