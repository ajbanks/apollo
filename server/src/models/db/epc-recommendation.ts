import { Static } from "@bahatron/utils/lib/json-schema";
import { $schema } from "../../utils/json-schema";
import { $pg } from "../../services/postgres";

export type EpcRecommendation = Static<typeof EpcRecommendationSchema>;
export const EpcRecommendationSchema = $schema.Object({
    certificate_id: $schema.String(),
    item: $schema.Integer(),
    recommendation: $schema.Nullable($schema.String()),
    indicative_cost: $schema.Nullable($schema.String()),
    indicative_roi: $schema.Nullable($schema.String()),
    co2_impact: $schema.Nullable($schema.String()),
});

export const $epcEnglandRecommendations = {
    knex: (session = $pg) => {
        return session.table<EpcRecommendation>(`epc_recommendations_england`);
    },
};
