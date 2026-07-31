import { applyDiff, getDiff, rdiffResult } from "recursive-diff";
import { foldStream } from "./fold-rm-stream";
import { omit } from "lodash";
import { $logger } from "../../utils/logger";
import { RmListingUrl } from "./rm-listing-url.util";
import { $clickhouse, ClickhouseMappers } from "../../services/clickhouse";
import { RmListingId } from "./rm-listing-id.util";
import { parseCrawledPrice } from "./parse-crawled-price.util";
import { parseRmFeatures } from "./listing-helpers";
import { ChRmListingEvents } from "../../clickhouse/ch-rm-listing-events";
import { RmToPropertyTypeMap } from "./rm-property-type-mapper";

export async function parseRmSimplifiedEvents(
    id: string,
    options: { preserveDate?: boolean } = {}
) {
    let stream = await foldStream(id);

    let entries: ChRmListingEvents[] = [];
    let fold: { details?: any; api?: any } = {};

    for (let event of stream.events) {
        $logger.debug(
            `testing for listing: ${event.data?.id} - seq: ${event.seq} - key: ${event.key}`
        );

        try {
            if (!fold[event.key!]) {
                fold[event.key!] = event.data;
            } else {
                fold[event.key!] = applyDiff(fold[event.key!], event.data);
            }

            if (fold.details && fold.api) {
                let item = RmSimplifiedModel(fold as any);

                let diff = getDiff(
                    omit(entries[entries.length - 1] ?? {}, [
                        "event_type",
                        "event_timestamp",
                        "uprn",
                    ]),
                    item
                );

                if (diff.length) {
                    let entry = {
                        ...item,
                        event_timestamp: options.preserveDate
                            ? event.timestamp
                            : ($clickhouse.dateTime(event.timestamp) as string),
                        event_type: parseEventType(item, diff),
                    };

                    $logger.debug(
                        {
                            diff: diff.map((keys) => keys.path).flat(),
                            event_seq: event.seq,
                            entry,
                        },
                        "processing event"
                    );

                    /** @todo revalidate type */
                    entries.push(entry as ChRmListingEvents);
                }
            }
        } catch (err: any) {
            $logger.warning(err.message);
        }
    }

    $logger.debug({ id }, `parsed ch events for rm listing`);

    return entries;
}

function parseEventType(
    event: Partial<ChRmListingEvents>,
    diff: rdiffResult[]
) {
    let events = diff.map((item) => item.path[0].toString());

    if (Object.keys(event).every((key) => events.includes(key))) {
        return ["listing_found"];
    } else {
        return Array.from(new Set(events));
    }
}

export function RmSimplifiedModel(data: {
    api: any;
    details: any;
}): Omit<ChRmListingEvents, "uprn" | "event_timestamp" | "event_type"> {
    function postcode() {
        return data.details?.address
            ? `${data.details.address.outcode} ${data.details.address.incode}`
            : "";
    }

    let first_visible_date =
        ClickhouseMappers.dateTime(data.api.firstVisibleDate) || "";

    let listing_update_time =
        ClickhouseMappers.dateTime(data.api.listingUpdate?.listingUpdateDate) ||
        first_visible_date;

    return {
        id: RmListingId(data.details.id),
        url: RmListingUrl(data.details.id),
        udprn: data.details.address?.deliveryPointId,
        channel: data.details?.channel,
        postcode: postcode(),
        agent_name: data.details.customer?.branchDisplayName,
        commercial: data.api.commercial,
        development: data.api.development,
        residential: data.api.residential,
        students: data.api.students,
        auction: data.api.auction,
        display_status: data.api.displayStatus,
        price: parseCrawledPrice(data) ?? 0,
        lat: data.details.location?.latitude,
        lon: data.details.location?.longitude,
        point_type: data.details.location?.pinType,
        council_tax_band: data.details.livingCosts?.councilTaxBand,
        furnish_type: data.details.lettings?.furnishType,
        let_type: data.details.lettings?.letType,
        first_visible_date,
        listing_update_time,
        listing_update_reason: data.api.listingUpdate?.listingUpdateReason,
        bedrooms: data.details.bedrooms,
        bathrooms: data.details.bathrooms,
        property_subtype: data.details.propertySubType,
        property_type:
            RmToPropertyTypeMap[data.details.propertySubType] ?? null,
        ownership: data.details.tenure?.tenureType,
        summary: data.api.summary,
        description: data.details.text?.description,
        features: parseRmFeatures(data),
        rooms: (data.details.rooms ?? []).map((item) => item?.name),
    };
}
