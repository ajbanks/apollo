import { first, groupBy, omit, property } from "lodash";
import {
    $propertyListings,
    PropertyListing,
} from "../../../models/db/property-listings";
import { PropertyTypes } from "../../properties/property-type.values";
import { quantile } from "../../../utils/quantile";
import { $landRegistryEngland } from "../../../models/db/land-registry-england";
import moment from "moment";
import { Decimal } from "../../../utils/number-helpers";
import {
    $rmAgentStatistics,
    AgentStatisticsV2,
    AgentStatsDatapoints,
} from "../../../models/db/rm-agent-statistics";
import { $logger } from "../../../utils/logger";
import { StopWatch } from "../../../utils/stop-watch";
import { jsonStringify } from "@bahatron/utils/lib/helpers";

const USE_LR_ONLY_FOR_ACHIEVED_PRICE = true;

let simplifiedPropertyTypes: Record<PropertyTypes, string> = {
    [PropertyTypes.DETACHED]: "detached",
    [PropertyTypes.SEMI_DETACHED]: "semi_detached",
    [PropertyTypes.TERRACED]: "terraced",
    [PropertyTypes.END_OF_TERRACE]: "terraced",
    [PropertyTypes.MAISONETTE]: "flat",
    [PropertyTypes.BUNGALOW]: "bungalow",
    [PropertyTypes.TERRACED_BUNGALOW]: "bungalow",
    [PropertyTypes.SEMI_DETACHED_BUNGALOW]: "bungalow",
    [PropertyTypes.FLAT]: "flat",
    [PropertyTypes.CARAVAN]: "other",
    [PropertyTypes.OTHER]: "other",
};

export async function calculateAgentStatistics(agentId: string) {
    let timer = StopWatch({ units: "seconds" });

    let dateRange = moment().subtract(365, "days").toDate();

    let listingQuery = $propertyListings
        .knex()
        .select(...AgentStatsDatapoints)
        .where({ agent_id: agentId, auction: false })
        .where(function () {
            this.where("exit_at", ">=", dateRange).orWhere(
                "first_visible_at",
                ">=",
                dateRange
            );
        })
        .whereIn("channel", ["RES_BUY", "RES_LET"])
        .whereNotNull("property_type")
        .whereNotNull("price")
        .where("property_type", "!=", PropertyTypes.CARAVAN);

    $logger.debug(listingQuery.toString());

    let rawListings = await listingQuery;

    timer.lap(`listing-fetch`);

    let transactions = await $landRegistryEngland
        .knex()
        .select("transaction_id", "uprn", "price", "date")
        .whereIn("uprn", rawListings.map((val) => val.uprn).filter(Boolean))
        .where("date", ">=", moment().subtract(360, "days").toDate())
        .orderBy("date", "asc");

    timer.lap(`transactions-fetch`);

    let processedListings = rawListings.map((listing) => {
        let exitDate = !listing.exit_at ? null : moment(listing.exit_at);

        let hasExit =
            hasExitStatus(listing.display_status) || Boolean(listing.exit_at);

        let transaction =
            exitDate && listing.uprn && listing.channel === "RES_BUY"
                ? transactions.find((t) => {
                      let exitEvent:
                          | NonNullable<PropertyListing["events"]>[number]
                          | undefined;

                      for (let event of [...listing.events!].reverse()) {
                          if (hasExitStatus(event.display_status)) {
                              exitEvent = event;
                              break;
                          }
                      }

                      let match =
                          t.uprn === listing.uprn &&
                          moment(
                              exitEvent?.event_timestamp ?? exitDate
                          ).isSameOrBefore(moment(t.date), "day");

                      return match;
                  })
                : null;

        let tomV1 = hasExit ? timeOnMarketV1(listing) : null;

        let pricePerBedroom =
            listing.bedrooms && listing.bedrooms > 0
                ? Decimal(listing.price! / listing.bedrooms, 3)
                : null;

        let achievedPrice = hasExit
            ? calcAchievedPrice(listing, transaction)
            : null;

        return {
            ...listing,
            property_type:
                simplifiedPropertyTypes[listing.property_type as any],
            sale_transaction: transaction ?? null,
            has_exit: hasExit,
            time_on_market_v1: tomV1,
            price_per_bedroom: pricePerBedroom,
            achieved_price: achievedPrice,
        };
    });

    let byChannel = groupBy(processedListings, (p) => p.channel);

    let stats = Object.entries(byChannel).reduce(
        (fold, [channel, listings]) => {
            let pricePerBedroom = listings
                .filter((p) => p.bedrooms && p.bedrooms > 0)
                .map((p) => Decimal(p.price! / (p.bedrooms || 1), 3));

            let achievedPrices = listings
                .map((val) => val.achieved_price!)
                .filter(Boolean);

            let exitedListings = listings.filter((val) => {
                return (
                    hasExitStatus(val.display_status) &&
                    (val.events?.length ?? 0) >= 2
                );
            });

            let tomV1Points = listings
                .map((val) => val.time_on_market_v1!)
                .filter(Boolean);

            let propertyTypeDistribution = Object.entries(
                groupBy(listings, (l) => l.property_type)
            ).reduce((fold, [type, typeListings]) => {
                fold[type] = Decimal(typeListings.length / listings.length, 3);
                return fold;
            }, {} as Record<string, number>);

            let val: AgentStatisticsV2 = {
                sample_size: listings.length,

                mean_asking_price: Decimal(
                    listings.reduce((sum, p) => sum + p.price!, 0) /
                        listings.length
                ),
                median_asking_price: quantile(
                    listings.map((p) => p.price!),
                    50
                ),

                mean_asking_price_per_bedroom: Decimal(
                    pricePerBedroom.reduce((sum, p) => sum + p, 0) /
                        pricePerBedroom.length
                ),
                median_asking_price_per_bedroom: quantile(pricePerBedroom, 50),

                success_rate: Decimal(exitedListings.length / listings.length),

                property_type_distribution: propertyTypeDistribution,

                mean_achieved_price: Decimal(
                    achievedPrices.reduce((sum, val) => sum + val, 0) /
                        achievedPrices.length
                ),
                median_achieved_price: quantile(achievedPrices, 50),

                mean_time_on_market: Decimal(
                    tomV1Points.reduce((sum, val) => sum + val, 0) /
                        tomV1Points.length
                ),
                median_time_on_market: quantile(tomV1Points, 50),
            };

            fold[channel] = val;
            return fold;
        },
        {} as Record<string, AgentStatisticsV2 & { [x: string]: any }>
    );

    // await dumpFile(
    //     `agent-${agentId}-statistics.json`,
    //     jsonStringify({ stats, sample: processedListings }, null, 4)
    // );

    await $rmAgentStatistics
        .knex()
        .insert({
            agent_id: agentId,
            timestamp: new Date(),
            statistics: stats,
            sample: jsonStringify(processedListings) as any,
        })
        .onConflict("agent_id")
        .merge();

    timer.lap(`stats-upsert`);

    $logger.info(
        timer.getResults(),
        `Upserted statistics for agent ${agentId}`
    );
}

function calcAchievedPrice(listing, transaction?) {
    if (!listing.exit_at || !transaction) return null;

    let events = [...listing.events];

    if (!events) {
        $logger.debug(`no events: ${listing.uprn}`);
        return null;
    }

    let firstPrice = events[0].price;

    let lastPrice = events[events.length - 1].price;

    let achievedPrice = Decimal(transaction.price / firstPrice, 3);

    $logger.debug(
        {
            tPrice: transaction.price,
            fPrice: firstPrice.price,
            lPrice: lastPrice.price,
            listingId: listing.id,
            fEvent: events[0],
            lEvent: events[events.length - 1],
        },
        `using LR price for achieved price calc: ${listing.uprn} - ${achievedPrice}`
    );

    return achievedPrice;
}

function hasExitStatus(status) {
    return status && status !== "";
}

function timeOnMarketV1(listing) {
    let events = [...listing.events!];

    if (!events?.length || events.length < 2) return null;

    let exitEvent: NonNullable<PropertyListing["events"]>[number] | undefined;
    let exitEventIndex;

    for (let i = events.length - 1; i > 0; i--) {
        if (hasExitStatus(events[i].display_status)) {
            exitEvent = events[i];
            exitEventIndex = i;
            break;
        }
    }

    if (!exitEvent) return null;

    return moment(exitEvent.event_timestamp).diff(
        moment(events[0].event_timestamp),
        "days"
    );
}
