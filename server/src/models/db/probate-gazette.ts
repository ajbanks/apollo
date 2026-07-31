import { $schema, Static } from "../../utils/json-schema";
import { $pg } from "../../services/postgres";

export type ProbateGazette = Static<typeof ProbateGazetteSchema>;
export const ProbateGazetteSchema = $schema.Object({
    id: $schema.String(),
    published_at: $schema.Date(),
    updated_at: $schema.Date(),
    feed: $schema.Nullable($schema.Any({})),
    data: $schema.Nullable($schema.Any({})),
});

export const $probateGazette = {
    knex: (session = $pg) => {
        return session.table<ProbateGazette>("probate_gazette");
    },
};
