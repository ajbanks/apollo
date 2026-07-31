import { PropertyTypes } from "../../handlers/properties/property-type.values";
import { $pg } from "../../services/postgres";
import { $schema, Static } from "../../utils/json-schema";

const PROPERTY_VIEW_TABLE = "property_listings";

export type PropertyListing = Static<typeof PropertyListingSchema>;
export const PropertyListingSchema = $schema.Object({
    // data: $schema.Object({
    //     api: $schema.Any(),
    //     details: $schema.Any(),
    // }),
    id: $schema.String(),
    active: $schema.Optional($schema.Boolean()),
    udprn: $schema.Nullable($schema.String()),
    postcode: $schema.Nullable($schema.String()),
    channel: $schema.Nullable($schema.String()),
    price: $schema.Nullable($schema.Number()),
    first_visible_at: $schema.DateExtended(),
    first_crawled_at: $schema.DateExtended(),
    last_crawled_at: $schema.DateExtended(),
    exit_at: $schema.Nullable($schema.DateExtended()),
    display_status: $schema.String(),
    property_subtype: $schema.Nullable($schema.String()),
    property_type: $schema.Nullable($schema.Enum(PropertyTypes)),
    commercial: $schema.Nullable($schema.Boolean()),
    development: $schema.Nullable($schema.Boolean()),
    residential: $schema.Nullable($schema.Boolean()),
    students: $schema.Nullable($schema.Boolean()),
    auction: $schema.Nullable($schema.Boolean()),
    bedrooms: $schema.Nullable($schema.Number()),
    bathrooms: $schema.Nullable($schema.Number()),
    lat: $schema.Nullable($schema.Number()),
    lon: $schema.Nullable($schema.Number()),
    display_size: $schema.Nullable($schema.String()),
    ownership: $schema.Nullable($schema.String()),
    epc_rating: $schema.Nullable($schema.String()),
    uprn: $schema.Nullable($schema.String()),
    last_price_update_at: $schema.Nullable($schema.DateExtended()),
    last_added_at: $schema.Nullable($schema.DateExtended()),
    furnish_type: $schema.Nullable($schema.String()),
    council_tax_band: $schema.Nullable($schema.String()),
    url: $schema.String({ format: "uri" }),
    agent_id: $schema.Nullable($schema.String()),
    let_type: $schema.String(),
    h3_7: $schema.Nullable($schema.String()),
    h3_9: $schema.Nullable($schema.String()),
    h3_11: $schema.Nullable($schema.String()),
    events: $schema.Nullable(
        $schema.Array(
            $schema.Object({
                event: $schema.StringEnum([
                    "listing_added",
                    "price_change",
                    "status_change",
                ] as const),
                event_timestamp: $schema.DateExtended(),
                display_status: $schema.String(),
                price: $schema.Nullable($schema.Number()),
            })
        )
    ),
    images: $schema.Nullable(
        $schema.Record(
            $schema.String(),
            $schema.Array($schema.String({ format: "uri" }))
        )
    ),
    description: $schema.Nullable($schema.String()),
    features: $schema.Array($schema.String()),
});

export const $propertyListings = {
    TABLE_NAME: PROPERTY_VIEW_TABLE,
    knex: () => $pg.table<PropertyListing>(PROPERTY_VIEW_TABLE),
};
