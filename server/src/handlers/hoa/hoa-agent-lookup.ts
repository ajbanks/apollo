import { ExpectationFailed } from "@bahatron/utils/lib/error";
import { geolocatePostcode } from "../addresses/geolocate-postcode";
import { $h3 } from "../../utils/h3";
import { $logger } from "../../utils/logger";
import {
    $propertyListings,
    PropertyListing,
    PropertyListingSchema,
} from "../../models/db/property-listings";
import { StopWatch } from "../../utils/stop-watch";
import { groupBy, max, omit, pick } from "lodash";
import moment from "moment";
import {
    $rmAgentStatistics,
    AgentStatisticsV2Schema,
} from "../../models/db/rm-agent-statistics";
import { $rmAgents } from "../../models/db/rm-agents";
import { Decimal } from "../../utils/number-helpers";
import { $schema, Static } from "../../utils/json-schema";
import { $rmAgentLogos } from "../../models/db/rm-agent-logos";
import { distance } from "@turf/turf";

const PropertyListingKeys = [
    "id",
    "url",
    "agent_id",
    "bedrooms",
    "price",
    "display_status",
    "first_visible_at",
    "exit_at",
    "property_type",
] as const;

export type HoaAgentLookup = Static<typeof HoaAgentLookupResponseSchema>;
export const HoaAgentLookupResponseSchema = $schema.Object({
    postcode: $schema.String(),
    lat: $schema.Number(),
    lon: $schema.Number(),
    total_listings: $schema.Number(),
    search_radius_meters: $schema.Number(),
    agents: $schema.Array(
        $schema.Composite([
            $schema.Object({
                logo_url: $schema.Nullable($schema.String()),
                agent_id: $schema.String(),
                agent_name: $schema.String(),
                agent_address: $schema.Nullable($schema.String()),
                agent_postcode: $schema.Nullable($schema.String()),
                local_listings: $schema.Number(),
                local_market_share: $schema.Number(),
            }),
            AgentStatisticsV2Schema,
        ])
    ),
    listings: $schema.Optional(
        $schema.Array(
            $schema.Composite([
                $schema.Pick(PropertyListingSchema, PropertyListingKeys),
                $schema.Object({ distance_meters: $schema.Number() }),
            ])
        )
    ),
});

export async function hoaAgentsLookup({
    postcode,
    withListings = true,
    maxRadius,
    limit,
}: {
    postcode: string;
    maxRadius?: number;
    withListings?: boolean;
    limit?: number;
}): Promise<HoaAgentLookup> {
    if (maxRadius) {
        maxRadius = Number(maxRadius);
        if (maxRadius <= 0 || maxRadius > 2500) {
            throw ExpectationFailed(
                { maxRadius },
                "Invalid max radius, must be between 1 and 2500 meters"
            );
        }
    }
    let timer = StopWatch({ units: "seconds" });

    let geolocated = await geolocatePostcode(postcode);

    $logger.debug(geolocated, `Geolocated postcode ${postcode}:`);

    timer.lap("geolocation");

    if (!geolocated) throw ExpectationFailed({ postcode }, "INVALID_POSTCODE");

    let ring = $h3.gridDiskDistances(geolocated.h3_9!, 12);

    $logger.debug(ring, "h3 ring");

    let query = $propertyListings
        .knex()
        .select(...PropertyListingKeys, "lat", "lon")
        .whereIn("h3_9", ring.flat())
        .where("channel", "RES_BUY")
        .where({ active: true })
        .whereNotNull("property_type")
        .whereNotNull("agent_id");

    timer.lap("listings-fetch");

    let listings: Partial<
        PropertyListing & {
            distance_meters?: number;
        }
    >[] = await query;

    $logger.debug(
        { query: query.toString(), results: listings.length },
        "listings query"
    );

    listings = listings
        .map((val) => {
            return {
                ...val,
                distance_meters: Decimal(
                    distance(
                        [geolocated.lon, geolocated.lat],
                        [val.lon!, val.lat!],
                        { units: "meters" }
                    )
                ),
            };
        })
        .sort((a, b) => a.distance_meters! - b.distance_meters!)
        .map((val) => {
            return {
                ...omit(val, ["lat", "lon"]),
            };
        })
        .slice(0, 500);

    if (maxRadius) {
        listings = listings.filter((l) => l.distance_meters! <= maxRadius);
    }

    let byAgent = groupBy(listings, (l) => l.agent_id!);

    let [agentStatistics, agentData, agentLogos] = await Promise.all([
        $rmAgentStatistics
            .knex()
            .select("agent_id", "timestamp", "statistics")
            .whereIn("agent_id", Object.keys(byAgent)),
        $rmAgents.knex().whereIn("id", Object.keys(byAgent)),
        $rmAgentLogos
            .knex()
            .select("agent_id")
            .whereIn("agent_id", Object.keys(byAgent)),
    ]);

    let agentLogoMap = agentLogos.reduce((fold, logo) => {
        fold[logo.agent_id] = logo;
        return fold;
    }, {} as Record<string, (typeof agentLogos)[number]>);

    timer.lap("agent-data-fetch");

    let agentSummary = Object.entries(byAgent).reduce(
        (fold, [agentId, agentListings]) => {
            let stats = agentStatistics.find((s) => s.agent_id === agentId);
            let agent = agentData.find((a) => a.id === agentId);

            if (!stats?.statistics?.["RES_BUY"]) return fold;

            let marketShare = Decimal(
                agentListings.length / listings.length,
                3
            );

            $logger.debug(
                `Agent ${agentId} - ${agent!.display_name} has ${
                    agentListings.length
                } local listings, market share ${marketShare}`
            );

            fold.push({
                agent_id: agentId,
                agent_name: agent!.display_name,
                agent_address: agent!.address,
                agent_postcode: agent!.postcode,
                local_listings: agentListings.length,
                local_market_share: marketShare,
                logo_url: agentLogoMap[agentId]
                    ? `${process.env.DOMAIN_URL}/hoa/agents/${agentId}/logo`
                    : null,
                ...stats.statistics["RES_BUY"],
            } as const);

            return fold;
        },
        [] as HoaAgentLookup["agents"]
    );

    $logger.info(timer.getResults(), `HOA agent lookup complete`);

    return {
        postcode: geolocated.postcode,
        lat: geolocated.lat,
        lon: geolocated.lon,
        total_listings: listings.length,
        search_radius_meters:
            maxRadius ?? max(listings.map((l) => l.distance_meters!))!,
        agents: agentSummary,
        listings: withListings ? (listings as any) : undefined,
    };
}
