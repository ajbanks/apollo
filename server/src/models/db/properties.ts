import { $schema, Static } from "../../utils/json-schema";
import { $pg } from "../../services/postgres";
import { PropertyTypes } from "../../handlers/properties/property-type.values";

export type Property = Static<typeof PropertySchema>;
export const PropertySchema = $schema.Object({
    uprn: $schema.String(),
    lat: $schema.Nullable($schema.Number()),
    lon: $schema.Nullable($schema.Number()),
    postcode: $schema.String(),
    h3_7: $schema.Nullable($schema.String()),
    h3_9: $schema.Nullable($schema.String()),
    h3_11: $schema.Nullable($schema.String()),
    h3_13: $schema.Nullable($schema.String()),
    h3_15: $schema.Nullable($schema.String()),
    address: $schema.String(),
    epc: $schema.Nullable($schema.String()),
    ownership_type: $schema.Nullable($schema.String()),
    property_type: $schema.Nullable($schema.Enum(PropertyTypes)),
    total_floor_area: $schema.Nullable($schema.Number()),
    num_habitable_rooms: $schema.Nullable($schema.Number()),
    bedrooms: $schema.Nullable($schema.Number()),
    bathrooms: $schema.Nullable($schema.Number()),
    last_epc_certificate_date: $schema.Nullable($schema.DateExtended()),
    last_transaction_date: $schema.Nullable($schema.DateExtended()),
    last_transaction_price: $schema.Nullable($schema.Number()),
    flood_risk: $schema.Nullable($schema.String()),
    extensions: $schema.Nullable($schema.Integer()),
    potential_epc: $schema.Nullable($schema.String()),
    type: $schema.Nullable($schema.String()),

    new_build: $schema.Nullable($schema.Boolean()),

    floor_level: $schema.Nullable($schema.String()),
    flat_storey_count: $schema.Nullable($schema.String()),
    occupation_type: $schema.Nullable($schema.String()),
    last_transaction_id: $schema.Nullable($schema.String()),
    last_epc_certificate_id: $schema.Nullable($schema.String()),
    council_tax_band: $schema.Nullable($schema.String()),

    year_built_normalised: $schema.Nullable($schema.Number()),
    floor_height: $schema.Nullable($schema.Number()),
    epc_rating: $schema.Nullable($schema.Number()),
    epc_potential_rating: $schema.Nullable($schema.Number()),
    inspire_id: $schema.Nullable($schema.String()),
});

export const $properties = {
    TABLE_NAME: "properties",
    knex: (session = $pg) => {
        return session.table<Property>($properties.TABLE_NAME);
    },
};
