import { $schema, Static } from "../../utils/json-schema";
import { $pg } from "../../services/postgres";

export type FloodRisk = Static<typeof FloodRiskSchema>;
export const FloodRiskSchema = $schema.Object({
    id: $schema.String(),
    flood_risk: $schema.String(),
    suitability: $schema.String(),
    date: $schema.DateExtended(),
    geometry: $schema.Any(),
    h3_9: $schema.Nullable($schema.Array($schema.String())),
    h3_11: $schema.Nullable($schema.Array($schema.String())),
});

export const $floodRisk = {
    knex: (session = $pg) => {
        return session.table<FloodRisk>("flood_risk_areas");
    },
};
