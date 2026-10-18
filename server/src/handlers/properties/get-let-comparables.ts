import { ExpectationFailed } from "@bahatron/utils/lib/error";
import { geolocatePostcode } from "../addresses/geolocate-postcode";

import { $h3 } from "../../utils/h3";
import moment from "moment";
import { PropertyTypeNeighbors } from "./property-type.values";
import { distance } from "@turf/turf";
import { orderBy } from "lodash";
import { $schema } from "../../utils/json-schema";
import { $propertyListings } from "../../models/db/property-listings";

export const LetComparablePropertiesResponseSchema = $schema.Object({
    id: $schema.String(),
    url: $schema.String(),
    postcode: $schema.Nullable($schema.String()),
    street: $schema.Nullable($schema.String()),
    lat: $schema.Nullable($schema.Number()),
    lon: $schema.Nullable($schema.Number()),
    channel: $schema.Nullable($schema.String()),
    price_pcm: $schema.Nullable($schema.Number()),
    bedrooms: $schema.Nullable($schema.Number()),
    bathrooms: $schema.Nullable($schema.Number()),
    property_type: $schema.Nullable($schema.String()),
    property_subtype: $schema.Nullable($schema.String()),
    display_status: $schema.String(),
    display_size: $schema.Nullable($schema.String()),
    let_type: $schema.String(),
    furnish_type: $schema.Nullable($schema.String()),
    epc_rating: $schema.Nullable($schema.String()),
    agent_id: $schema.Nullable($schema.String()),
    first_visible_at: $schema.DateExtended(),
    last_crawled_at: $schema.DateExtended(),
    distance: $schema.Number(),
});

const LETTING_CHANNELS = ["RES_LET", "STU_LET"];

export async function getLetComparableProperties({
    bedrooms,
    propertyType,
    propertySubType = null as string | null,
    letType = null as string | null,
    status = null as string | null,
    months = 12 as number,
    floorArea = null as number | null,
    postcode = null as string | null,
    lat = null as number | null,
    lon = null as number | null,
    ringSize = null as number | null,
    limit = 25 as number,
}) {
    lat = lat == null ? null : Number(lat);
    lon = lon == null ? null : Number(lon);

    if (!lat || !lon) {
        if (!postcode) {
            throw ExpectationFailed(
                "Either lat/lon or postcode must be provided"
            );
        }

        let geoPostcode = await geolocatePostcode(postcode);
        if (!geoPostcode) {
            throw ExpectationFailed({ postcode }, "Postcode not found");
        }

        lat = Number(lat || geoPostcode.lat);
        lon = Number(lon || geoPostcode.lon);
    }

    const RESULT_LIMIT = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const H3_RING_SIZES = ringSize
        ? [Number(ringSize)]
        : [5, 10, 20];

    let listings: any[] = [];

    for (let ring of H3_RING_SIZES) {
        let h3Ring = $h3
            .gridDiskDistances($h3.latLngToCell(lat, lon, 9), ring)
            .flat();

        let query = $propertyListings
            .knex()
            .select(
                "id",
                "url",
                "postcode",
                "street",
                "lat",
                "lon",
                "channel",
                "price",
                "bedrooms",
                "bathrooms",
                "property_type",
                "property_subtype",
                "display_status",
                "display_size",
                "let_type",
                "furnish_type",
                "epc_rating",
                "agent_id",
                "first_visible_at",
                "last_crawled_at"
            )
            .whereIn("channel", LETTING_CHANNELS)
            .whereIn("h3_9", h3Ring)
            .where(
                "first_visible_at",
                ">=",
                moment().subtract(Number(months) || 12, "months").toDate()
            );

        if (bedrooms != null) {
            query.where("bedrooms", Number(bedrooms));
        }

        if (propertyType) {
            query.whereIn(
                "property_type",
                PropertyTypeNeighbors[propertyType]
            );
        }

        if (propertySubType) {
            query.where("property_subtype", propertySubType);
        }

        if (letType) {
            query.where("let_type", letType);
        }

        if (status) {
            query.where("display_status", status);
        }

        listings = (await query).map((item) => {
            return {
                ...item,
                price_pcm: item.price,
                distance: Math.round(
                    distance(
                        [Number(lon), Number(lat)],
                        [Number(item.lon), Number(item.lat)],
                        { units: "meters" }
                    )
                ),
            };
        });

        if (listings.length >= RESULT_LIMIT) break;
    }

    return orderBy(listings, ["distance"], ["asc"]).slice(0, RESULT_LIMIT);
}
