import { $schema, Static } from "../../utils/json-schema";
import { $pg } from "../../services/postgres";

export type Census2021 = Static<typeof Census2021Schema>;
export const Census2021Schema = $schema.Object({
    location_code: $schema.String(),
    location_type: $schema.String(),
    file_code: $schema.String(),
    key: $schema.String(),
    display_name: $schema.String(),
    value: $schema.Integer(),
});

export const $census2021 = {
    knex: (session = $pg) => {
        return session.table<Census2021>("census_2021_data");
    },
};
