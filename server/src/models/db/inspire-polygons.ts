import { $schema, Static } from "../../utils/json-schema";
import { $pg } from "../../services/postgres";

export type InspirePolygon = Static<typeof InspirePolygonSchema>;
export const InspirePolygonSchema = $schema.Object({
    id: $schema.String(),
    valid_from: $schema.DateExtended(),
    geometry: $schema.Any(),
    h3_15: $schema.Nullable($schema.Array($schema.String())),
});

export const $inspirePolygons = {
    knex(session = $pg) {
        return session.table<InspirePolygon>(`inspire_polygons`);
    },
};
