import { MercuriosEvent } from "@bahatron/mercurios";
import {
    jsonParse,
    jsonStringify,
    stringify,
} from "@bahatron/utils/lib/helpers";
import { omit, pick } from "lodash";
import {
    $propertyListings,
    PropertyListing,
} from "../../models/db/property-listings";
import { $logger } from "../../utils/logger";
import { foldStream, RIGHTMOVE_KEYS } from "./fold-rm-stream";
import {
    EPC_RATINGS,
    parseEPCfromGovHtml,
} from "../gov-data/epc-ew/crawl-gov-epc-rating";
import { applyDiff, getDiff } from "recursive-diff";
import { RmListingUrl } from "./rm-listing-url.util";
import moment from "moment";
import { findUPRNbyTransactionHistory } from "./find-uprn-by-transaction-history";
import { geolocatePostcode } from "../addresses/geolocate-postcode";
import { $listingUprnMap } from "../../models/db/listing-uprn-map";
import { StopWatch } from "../../utils/stop-watch";
import { RmListingId } from "./rm-listing-id.util";
import { parseCrawledPrice } from "./parse-crawled-price.util";
import { ProcessRmImage } from "../properties/process-property-image.queue";
import { $h3 } from "../../utils/h3";
import { parseRmSimplifiedEvents } from "./parse-rm-simplified-events";
import { $imageMap } from "../../models/db/image-map";
import { parseRmFeatures } from "./listing-helpers";
import { $rmAgents, RmAgent } from "../../models/db/rm-agents";
import { POSTCODE_REGEX } from "../addresses/postcode.utils";
import { RmToPropertyTypeMap } from "./rm-property-type-mapper";
import { $bull } from "../../services/bull";
import { queueAgentLogoProcessing } from "./rm-agents/process-agent-logo.queue";

export const CHANNELS = ["RES_BUY", "RES_LET"] as const;

const STUDIO_SUBTYPES = ["Studio", "Apartment", "Flat"];

export const upsertRmPropertyListing = async (id: string, active?: boolean) => {
    let timer = StopWatch({ units: "milliseconds" });

    let fold = await foldStream(id);
    timer.lap("fold");

    if (!fold || !fold.data?.details) return;

    let data = fold.data;
    let listingId = RmListingId(id);
    let price = parseCrawledPrice(data);
    let epcGraphs = (data.details.epcGraphs || []).map((item) => item?.url);
    let propertyType = parsePropertyType(data.details.propertySubType);
    let postcode = data.details?.address
        ? `${data.details.address.outcode} ${data.details.address.incode}`
        : "";

    let processes = Promise.all([
        geolocatePostcode(postcode),
        processAgentData(data?.details?.customer),
    ]);

    let [epcRating, uprn, listingEvents] = await Promise.all([
        parseEpc(epcGraphs, data.details.keyFeatures),
        parseUPRN(listingId, data.details),
        parseListingEvents(id),
    ]);

    timer.lap("enrichment");

    let payload: PropertyListing = {
        id: listingId,
        active,
        // data: data,
        udprn: data?.details?.address?.deliveryPointId,
        display_size: data.api?.displaySize,
        channel: data.details?.channel,
        postcode: postcode,
        price: price,
        display_status: data.api.displayStatus,
        first_crawled_at: fold.root?.timestamp!,
        last_crawled_at: fold.tail?.timestamp!,
        first_visible_at: data.api.firstVisibleDate,
        ...calculateDatesV2(listingEvents),
        // ...calculateDates(fold.events),
        property_subtype: data.details.propertySubType,
        commercial: data.api.commercial,
        development: data.api.development,
        residential: data.api.residential,
        students: data.api.students,
        auction: data.api.auction,
        property_type: propertyType,
        bedrooms: parseBedrooms(
            data.details.bedrooms,
            data.details.propertySubType,
            data.details?.dfpAdInfo?.targeting
        ),
        bathrooms: data.details.bathrooms,
        lat: data.details.location.latitude,
        lon: data.details.location.longitude,
        ownership: data.details.tenure?.tenureType?.toLowerCase(),
        epc_rating: epcRating,
        uprn,
        council_tax_band: data.details.livingCosts?.councilTaxBand,
        furnish_type: data.details.lettings?.furnishType,
        url: RmListingUrl(id),
        let_type: data.details.lettings?.letType,
        agent_id: data?.details.customer.branchId,
        h3_7: $h3.latLngToCell(
            data.details.location.latitude,
            data.details.location.longitude,
            7
        ),
        h3_9: $h3.latLngToCell(
            data.details.location.latitude,
            data.details.location.longitude,
            9
        ),
        h3_11: $h3.latLngToCell(
            data.details.location.latitude,
            data.details.location.longitude,
            11
        ),
        events: jsonStringify(listingEvents) as any,
        description: data.details?.text?.description,
        images: jsonStringify(await parseListingImages(data)) as any,
        features: jsonStringify(parseRmFeatures(data)) as any,
    };

    $logger.debug({ ...omit(payload, "data"), id }, "property listing object");

    let record = await $propertyListings
        .knex()
        .where({ id: listingId })
        .first();

    if (!record) {
        await $propertyListings.knex().insert({
            ...payload,
        });
    } else {
        await $propertyListings
            .knex()
            .where({
                id: listingId,
            })
            .update(payload);
    }

    timer.lap("insert");

    await processes;

    $logger.info({ id, times: timer.getResults() }, "updated property view");
};

function calculateDatesV2(events: PropertyListing["events"]) {
    let last_added_at: string | null = null;
    let last_price_update_at: string | null = null;
    let exit_at: string | null = null;

    for (let event of events ?? []) {
        if (event.event === "listing_added") {
            last_added_at = moment(event.event_timestamp).toISOString();
        } else if (event.event === "status_change") {
            if (event.display_status && event.display_status.length > 0) {
                exit_at = moment(event.event_timestamp).toISOString();
            } else {
                exit_at = null;
                last_added_at = moment(event.event_timestamp).toISOString();
            }
        } else if (event.event === "price_change") {
            last_price_update_at = moment(event.event_timestamp).toISOString();
        }
    }

    return {
        last_added_at,
        last_price_update_at,
        exit_at,
    };
}

/** @todo: this is replicating streamFold reducer, should be refactored so it's a callback on streamFold */
function calculateDates(events: MercuriosEvent[]) {
    let first_visible_at: string | null = null;
    let last_added_at: string | null = null;
    let last_price_update_at: string | null = null;
    let exit_at: string | null = null;

    $logger.debug(
        events.map((event) => omit(event, ["data"])),
        `calculating dates...`
    );

    events.reduce((fold, event) => {
        if (!fold[event.key!]) {
            fold[event.key!] = jsonParse(jsonStringify(event.data));
        } else {
            fold[event.key!] = applyDiff(fold[event.key!], event.data);
        }

        if (event.key === RIGHTMOVE_KEYS.API) {
            if (!first_visible_at) {
                first_visible_at = moment(
                    fold["api"].firstVisibleDate
                ).toISOString();

                last_added_at = first_visible_at;
            }

            if (fold["api"].listingUpdate?.listingUpdateReason === "new") {
                last_added_at = moment(
                    fold["api"]?.listingUpdate?.listingUpdateDate
                ).toISOString();

                exit_at = null;
                last_price_update_at = null;
            } else {
                last_price_update_at = moment(
                    fold["api"]?.listingUpdate?.listingUpdateDate
                ).toISOString();
            }

            if (fold["api"].displayStatus?.length > 1) {
                exit_at = event.timestamp;
            }

            $logger.debug({
                seq: event.seq,
                fold_dates: {
                    firstVisibleDate: fold["api"].firstVisibleDate,
                    ...pick(fold["api"].listingUpdate),
                    displayStatus: fold["api"].displayStatus,
                },
                partial: {
                    first_visible_at,
                    last_added_at,
                    last_price_update_at,
                    exit_at,
                },
            });
        }

        return fold;
    }, {} as any);

    return {
        first_visible_at: first_visible_at!,
        last_price_update_at,
        last_added_at,
        exit_at,
    };
}

function parsePropertyType(propertySubType: string) {
    if (!propertySubType) return null;

    return RmToPropertyTypeMap[propertySubType] ?? null;
}

export async function parseUPRN(listingId: string, details: any) {
    let record = await $listingUprnMap
        .knex()
        .where({ listing_id: listingId })
        .whereNull("inspire_id")
        .first();

    if (record) return record.uprn;

    if (!details?.address) return null;

    let postcode = `${details.address.outcode} ${details.address.incode}`;

    if (details.transactionHistory) {
        let result = await findUPRNbyTransactionHistory({
            transactionHistory: details.transactionHistory,
            postcode,
        });

        if (result) {
            await $listingUprnMap
                .knex()
                .insert({ listing_id: listingId, uprn: result })
                .onConflict("listing_id")
                .ignore();

            return result;
        }
    }

    return null;
}

async function parseEpc(epcGraphs: string[], keyFeatures: string[] | null) {
    try {
        if (keyFeatures) {
            let epcFeature = keyFeatures.find((item) => {
                let lower = item.toLowerCase();

                return (
                    lower.includes(`epc`) ||
                    lower.includes(`energy efficiency rating`) ||
                    lower.includes(`energy rating`)
                );
            });

            if (epcFeature) {
                let rating = epcFeature
                    .split(" ")
                    .pop()
                    ?.toUpperCase()
                    .replaceAll("(", "")
                    .replaceAll(")", "");

                if (rating) {
                    if (Object.keys(EPC_RATINGS).includes(rating)) {
                        return rating;
                    } else if (Number(rating)) {
                        let value = Number(rating);

                        let mappedRating: string | undefined = undefined;

                        for (let tuple of Object.entries(EPC_RATINGS)) {
                            if (value >= tuple[1]) {
                                mappedRating = tuple[0];
                                break;
                            }
                        }

                        if (mappedRating) return mappedRating;
                    }
                }
            }
        }

        let govUrl = epcGraphs.find((item) => {
            return (
                item.includes("find-energy-certificate.service.gov.uk") ||
                (item.length && !item.includes("http"))
            );
        });

        if (!govUrl) return null;

        let res = await parseEPCfromGovHtml(govUrl);

        return res.rating?.toUpperCase() ?? null;
    } catch (err: any) {
        $logger.warning(err.message);

        return null;
    }
}

function parseBedrooms(
    bedrooms: number | null,
    propertySubType: string,
    dfpAdInfo: { key: string; value: string[] }[] = []
) {
    if (!bedrooms && STUDIO_SUBTYPES.includes(propertySubType)) {
        return 0;
    }

    if (bedrooms) return bedrooms;

    return (
        Number(dfpAdInfo.find((item) => item.key === "BD")?.value?.[0]) || null
    );
}

export type RmImageItem = { url: string };
async function parseListingImages(data: any) {
    let floorPlanUrls = (data?.details?.floorplans ?? []).map(
        (item: RmImageItem) => item.url
    );
    let propertyUrls = (data?.details?.images ?? []).map(
        (item: RmImageItem) => item.url
    );

    let epcUrls = (data?.details?.epcGraphs ?? []).map(
        (item: RmImageItem) => item.url
    );

    let brochureUrls = (data?.details?.brochures ?? []).map(
        (item: RmImageItem) => item.url
    );

    return {
        floor_plans: floorPlanUrls,
        property_images: propertyUrls,
        epc_graphs: epcUrls,
        brochures: brochureUrls,
    };
}

function parseEventType(
    events: string[]
): NonNullable<PropertyListing["events"]>[number]["event"] {
    if (events.includes("listing_found")) {
        return "listing_added";
    } else if (events.includes("price")) {
        return "price_change";
    } else if (events.includes("display_status")) {
        return "status_change";
    } else {
        throw new Error(`Unknown event type: ${events.join(", ")}`);
    }
}

const SIMPLIFIED_EVENT_KEYS = ["listing_found", "price", "display_status"];
export async function parseListingEvents(
    id
): Promise<PropertyListing["events"]> {
    let simplifiedEvents = await parseRmSimplifiedEvents(id, {
        preserveDate: true,
    });

    return simplifiedEvents
        .filter((item) => {
            return SIMPLIFIED_EVENT_KEYS.some((event) => {
                return item.event_type!.includes(event);
            });
        })
        .map((item) => {
            return {
                event: parseEventType(item.event_type!),
                ...pick(item, ["event_timestamp", "display_status", "price"]),
                price: item.price!,
            };
        });
}

export async function processAgentData(customerData: any) {
    if (!customerData?.branchId) return;

    let address: string[] | undefined = customerData?.displayAddress
        ?.replaceAll(`\r\n`, `, `)
        ?.split(",")
        ?.map((s) => s.trim())
        ?.filter(Boolean);

    let postcode = address?.find((part) => POSTCODE_REGEX.test(part)) ?? null;

    let record: RmAgent = {
        id: customerData.branchId.toString(),
        raw: customerData,
        last_updated: new Date(),
        branch_name: customerData.branchName,
        display_name: customerData.branchDisplayName,
        company_name: customerData.companyName,
        trading_name: customerData.companyTradingName,
        address: address?.join(", ") ?? null,
        postcode,
    };

    let agentRecord = await $rmAgents.knex().where({ id: record.id }).first();

    let diff = getDiff(
        omit(agentRecord ?? {}, ["last_updated"]),
        omit(record, ["last_updated"])
    );

    if (diff.length) {
        await queueAgentLogoProcessing(record.id);

        $logger.debug(diff, "updating agent data...");

        await $rmAgents.knex().insert(record).onConflict("id").merge();

        $logger.info({ agent_id: record.id }, `agent data updated`);
    }
}
