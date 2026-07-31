import { $pg } from "../../services/postgres";
import { $schema, Static } from "../../utils/json-schema";

export type PostcodeMap = Static<typeof PostcodesMapSchema>;
export const PostcodesMapSchema = $schema.Object({
    postcode: $schema.String(),
    slug: $schema.String(),
    lat: $schema.Number(),
    lon: $schema.Number(),
    h3_9: $schema.Nullable($schema.String()),
    country: $schema.Nullable($schema.String()),
    country_name: $schema.Nullable($schema.String()),
    region: $schema.Nullable($schema.String()),
    region_name: $schema.Nullable($schema.String()),
    county: $schema.Nullable($schema.String()),
    county_name: $schema.Nullable($schema.String()),
    district: $schema.Nullable($schema.String()),
    district_name: $schema.Nullable($schema.String()),
    msoa21: $schema.Nullable($schema.String()),
    msoa21_name: $schema.Nullable($schema.String()),
    ttwa: $schema.Nullable($schema.String()),
    ttwa_name: $schema.Nullable($schema.String()),
    ward: $schema.Nullable($schema.String()),
    ward_name: $schema.Nullable($schema.String()),
    urban_type_code: $schema.Nullable($schema.String()),
    urban_type_description: $schema.Nullable($schema.String()),
    area_type_code: $schema.Nullable($schema.String()),
    area_type_group: $schema.Nullable($schema.String()),
    area_type_subgroup: $schema.Nullable($schema.String()),
    area_type_supergroup: $schema.Nullable($schema.String()),
});

export const $postcodeMap = {
    knex: (session = $pg) => session.table<PostcodeMap>("postcode_map"),
};
