import { $pg } from "../../services/postgres";

export interface PropertyTypeMap {
    uprn: string;
    property_types_raw: string[];
    property_types_clean: string;
    hash: string;
}

export const $propertyTypeMap = {
    TABLE_NAME: "property_type_map",
    knex: (session = $pg) => {
        return session.table($propertyTypeMap.TABLE_NAME);
    },
};
