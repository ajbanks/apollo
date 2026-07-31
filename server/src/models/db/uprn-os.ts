import { $schema, Static } from "../../utils/json-schema";
import { $pg } from "../../services/postgres";

export type UprnOS = Static<typeof UprnMetadataSchema>;

export const UprnMetadataSchema = $schema.Object({
    uprn: $schema.String(),
    lat: $schema.Number(),
    lon: $schema.Number(),
    parent_uprn: $schema.Nullable($schema.String()),
});

export const $uprnOs = {
    knex: (session = $pg) => {
        return session.table<UprnOS>(`uprn_metadata`);
    },
};
