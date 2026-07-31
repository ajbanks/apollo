import { $schema, Static } from "../../utils/json-schema";
import { $pg } from "../../services/postgres";

export type PopulationProjection = Static<typeof PopulationProjectionSchema>;
export const PopulationProjectionSchema = $schema.Object({
    code: $schema.String(),
    prediction_2018: $schema.Number(),
    prediction_2023: $schema.Number(),
    prediction_2028: $schema.Number(),
    prediction_2033: $schema.Number(),
    prediction_2038: $schema.Number(),
    prediction_2043: $schema.Number(),
    total_change: $schema.Number(),
    total_percentage_change: $schema.Number(),
    average_annual_change: $schema.Number(),
});

export const $populationProjections = {
    knex: (session = $pg) => {
        return session.table<PopulationProjection>("population_projections");
    },
};
