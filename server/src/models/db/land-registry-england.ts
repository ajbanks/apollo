import { $schema, Static } from "../../utils/json-schema";
import { $pg } from "../../services/postgres";

export const PROPERTY_TYPE_MAP = {
    D: "DETACHED",
    S: "SEMI_DETACHED",
    T: "TERRACED",
    F: "FLAT",
    O: "OTHER",
} as const;

export const DURATION_MAP = {
    F: "FREEHOLD",
    L: "LEASEHOLD",
} as const;

export const PPD_MAP = {
    A: "STANDARD",
    B: "ADDITIONAL_PRICE_PAID",
} as const;

export const RECORD_STATUS_MAP = {
    A: "ADDITION",
    C: "CHANGE",
    D: "DELETE",
} as const;

export const NEW_BUILD_MAP = {
    Y: true,
    N: false,
} as const;

export type LandRegistryRecord = Static<typeof LandRegistryRecord>;
export const LandRegistryRecord = $schema.Object({
    transaction_id: $schema.String(),
    price: $schema.Number(),
    date: $schema.Date(),
    new_build: $schema.Boolean(),
    duration: $schema.String(),
    ppd: $schema.String(),
    record_status: $schema.String(),
    property_type: $schema.StringEnum(Object.values(PROPERTY_TYPE_MAP)),
    paon: $schema.Union([$schema.String(), $schema.Null()]),
    saon: $schema.Union([$schema.String(), $schema.Null()]),
    street: $schema.Union([$schema.String(), $schema.Null()]),
    postcode: $schema.String(),
    locality: $schema.Union([$schema.String(), $schema.Null()]),
    town_or_city: $schema.Union([$schema.String(), $schema.Null()]),
    district: $schema.Union([$schema.String(), $schema.Null()]),
    county: $schema.Union([$schema.String(), $schema.Null()]),
    uprn: $schema.Union([$schema.String(), $schema.Null()]),
    publish_date: $schema.Date(),
});

export const $landRegistryEngland = {
    knex: (session = $pg) => {
        return session.table<LandRegistryRecord>("land_registry_england");
    },
};
