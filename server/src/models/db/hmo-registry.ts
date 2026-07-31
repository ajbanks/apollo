import { $schema, Static } from "../../utils/json-schema";
import { $pg } from "../../services/postgres";

export type HmoRegistryProperty = Static<typeof HmoRegistryProperty>;
export const HmoRegistryProperty = $schema.Object({
    id: $schema.String(),
    date_start: $schema.Nullable($schema.DateExtended()),
    date_end: $schema.DateExtended(),
    uprn: $schema.Nullable($schema.String()),
    address: $schema.String(),
    postcode: $schema.String(),
    license_holder: $schema.Nullable($schema.String()),
    license_holder_address: $schema.Nullable($schema.String()),
    storyes: $schema.Nullable($schema.Integer()),
    bedrooms: $schema.Integer(),
    bathrooms: $schema.Nullable($schema.Integer()),
    living_rooms: $schema.Nullable($schema.Integer()),
    max_households: $schema.Nullable($schema.Integer()),
    max_occupiers: $schema.Integer(),
});

export const $hmoRegistryProperties = {
    knex: (session = $pg) => {
        return session.table<HmoRegistryProperty>("hmo_registry_properties");
    },
};

export const $hmoRegistryLog = {
    knex: (session = $pg) => {
        return session.table<{
            location_code: string;
            process_date: Date | string;
        }>("hmo_registry_log");
    },
};
