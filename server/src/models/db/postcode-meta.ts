import { $schema, Static } from "../../utils/json-schema";
import { $pg } from "../../services/postgres";

export type PostcodeMeta = Static<typeof PostcodeMetaSchema>;
export const PostcodeMetaSchema = $schema.Object({
    postcode: $schema.String(),
    updated_at: $schema.DateExtended(),
    created_at: $schema.DateExtended(),
    metadata: $schema.Any(),
});

export const $postcodeMeta = {
    knex: (session = $pg) => session.table<PostcodeMeta>("postcode_meta"),
};
