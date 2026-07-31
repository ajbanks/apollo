import { $clickhouse } from "../services/clickhouse";
import { $schema, Static } from "../utils/json-schema";

export type ChRmListingEvents = Static<typeof ChRmListingEventsSchema>;
export const ChRmListingEventsSchema = $schema.Object({
    id: $schema.String(),
    url: $schema.String({ format: "uri" }),
    postcode: $schema.String(),
    lat: $schema.Nullable($schema.Number()),
    lon: $schema.Nullable($schema.Number()),
    point_type: $schema.String(),
    udprn: $schema.String(),
    price: $schema.Number(),
    bedrooms: $schema.Nullable($schema.Number()),
    bathrooms: $schema.Nullable($schema.Number()),
    property_type: $schema.String(),
    property_subtype: $schema.String(),
    channel: $schema.String(),
    display_status: $schema.String(),
    agent_name: $schema.String(),
    commercial: $schema.Boolean(),
    development: $schema.Boolean(),
    residential: $schema.Boolean(),
    students: $schema.Boolean(),
    auction: $schema.Boolean(),
    ownership: $schema.String(),
    let_type: $schema.String(),
    furnish_type: $schema.String(),
    council_tax_band: $schema.String(),
    first_visible_date: $schema.DateExtended(),
    listing_update_time: $schema.DateExtended(),
    listing_update_reason: $schema.String(),
    summary: $schema.String(),
    description: $schema.String(),
    features: $schema.Array($schema.String()),
    rooms: $schema.Array($schema.String()),
    event_timestamp: $schema.DateExtended(),
    event_type: $schema.Array($schema.String()),
});

export async function chCreateRmListingEventsTable(
    tableName = $clickhouse.RM_LISTING_EVENTS as string
) {
    let statements = [
        `DROP TABLE IF EXISTS ${tableName} SYNC`,
        `CREATE TABLE IF NOT EXISTS ${tableName}
        (
            id String DEFAULT '' NOT NULL,
            url String DEFAULT '' NOT NULL,
            
            postcode String DEFAULT '' NOT NULL,
            lat Nullable(Float64),
            lon Nullable(Float64),
            point_type String DEFAULT '' NOT NULL,

            udprn String DEFAULT '' NOT NULL,

            price Int32 DEFAULT 0 NOT NULL,
            bedrooms Nullable(UInt64),
            bathrooms Nullable(UInt64),
            
            property_type String DEFAULT '' NOT NULL,
            property_subtype String DEFAULT '' NOT NULL,
            channel String DEFAULT '' NOT NULL,
            display_status String DEFAULT '' NOT NULL,
            agent_name String DEFAULT '' NOT NULL,
            
            commercial Bool DEFAULT false NOT NULL,
            development Bool DEFAULT false NOT NULL,
            residential Bool DEFAULT false NOT NULL,
            students Bool DEFAULT false NOT NULL,
            auction Bool DEFAULT false NOT NULL,
            
            ownership String DEFAULT '' NOT NULL,
            let_type String DEFAULT '' NOT NULL,
            furnish_type String DEFAULT '' NOT NULL,
            council_tax_band String DEFAULT '' NOT NULL,

            first_visible_date DateTime64(3, ['UTC']) NOT NULL,
            listing_update_time DateTime64(3, ['UTC']) NOT NULL,
            listing_update_reason String DEFAULT '' NOT NULL,

            summary  String DEFAULT '' NOT NULL,
            description String DEFAULT '' NOT NULL,
            features  Array(String) DEFAULT [] NOT NULL,
            rooms  Array(String) DEFAULT [] NOT NULL,
            
            event_type Array(String) DEFAULT [] NOT NULL,
            event_timestamp DateTime64(3, ['UTC']) NOT NULL,
        ) ENGINE = MergeTree()
        ORDER BY (property_type, property_subtype, id)
        SETTINGS index_granularity = 8192`,
        ...[
            "postcode",
            "lat",
            "lon",
            "udprn",
            "price",
            "bedrooms",
            "bathrooms",
            "property_type",
            "property_subtype",
            "channel",
            "display_status",
            "agent_name",
        ].map((column) => {
            return `CREATE INDEX ${tableName}_${column}_index ON ${tableName} (${column}) TYPE minmax GRANULARITY 1`;
        }),
    ];

    for (let statement of statements) {
        await $clickhouse.client
            .command({
                query: statement,
            })
            .catch((err) => {
                if (err.message.includes("already exists")) return;

                throw err;
            });
    }
}
