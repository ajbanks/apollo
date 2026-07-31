import { $pg } from "../../services/postgres";
import { $schema, Static } from "../../utils/json-schema";
import { LandRegistryRecord } from "./land-registry-england";
import { PropertyListingSchema } from "./property-listings";

export type AgentStatisticsV2 = Static<typeof AgentStatisticsV2Schema>;
export const AgentStatisticsV2Schema = $schema.Object({
    sample_size: $schema.Number(),

    mean_asking_price: $schema.Number(),
    median_asking_price: $schema.Number(),

    mean_asking_price_per_bedroom: $schema.Number(),
    median_asking_price_per_bedroom: $schema.Number(),

    success_rate: $schema.Number(),
    property_type_distribution: $schema.Record(
        $schema.String(),
        $schema.Number()
    ),

    mean_achieved_price: $schema.Number(),
    median_achieved_price: $schema.Number(),

    mean_time_on_market: $schema.Number(),
    median_time_on_market: $schema.Number(),
});

export const AgentStatsDatapoints = [
    "id",
    "uprn",
    "price",
    "first_visible_at",
    "exit_at",
    "display_status",
    "price",
    "bedrooms",
    "bathrooms",
    "events",
    "channel",
    "property_type",
] as const;

export type AgentStatisticsRecord = Static<typeof AgentStatisticsRecordSchema>;
export const AgentStatisticsRecordSchema = $schema.Object({
    agent_id: $schema.String(),
    timestamp: $schema.DateExtended(),
    statistics: $schema.Record($schema.String(), AgentStatisticsV2Schema),
    sample: $schema.Array(
        $schema.Composite([
            $schema.Pick(PropertyListingSchema, AgentStatsDatapoints),
            $schema.Object({
                time_on_market_v1: $schema.Nullable($schema.Number()),
                time_on_market_v2: $schema.Nullable($schema.Number()),
                achieved_price: $schema.Nullable($schema.Number()),
                sale_transaction: $schema.Nullable(
                    $schema.Pick(LandRegistryRecord, [
                        "transaction_id",
                        "uprn",
                        "price",
                        "date",
                    ])
                ),
            }),
        ])
    ),
});

export const $rmAgentStatistics = {
    TABLE_NAME: "rm_agent_statistics",
    knex: () => $pg.table<AgentStatisticsRecord>($rmAgentStatistics.TABLE_NAME),
};
