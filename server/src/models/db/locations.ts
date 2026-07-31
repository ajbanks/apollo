import { Static } from "@sinclair/typebox";
import { $pg } from "../../services/postgres";
import { $schema } from "../../utils/json-schema";

export enum LocationLevels {
    oa21,
    lsoa21,
    msoa21,
    ward,
    fuas,
    pcon,
    ttwa,
    lad23,
    county,
    region,
    country,
}

export type Location = Static<typeof LocationSchema>;
export const LocationSchema = $schema.Object({
    display_name: $schema.String(),
    type: $schema.String(),
    code: $schema.String(),
    meta: $schema.Nullable($schema.Any()),
    geometry: $schema.Nullable($schema.Any()),
    h3_9: $schema.Nullable($schema.Array($schema.String())),
    h3_7: $schema.Nullable($schema.Array($schema.String())),
    h3_11: $schema.Nullable($schema.Array($schema.String())),
    h3_13: $schema.Nullable($schema.Array($schema.String())),
    date_start: $schema.Nullable($schema.DateExtended()),
    date_end: $schema.Nullable($schema.DateExtended()),
});

export const $locations = {
    TABLE_NAME: "locations",
    knex: (session = $pg) => session.table<Location>($locations.TABLE_NAME),
};
