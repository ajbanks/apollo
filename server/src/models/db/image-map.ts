import { $schema, Static } from "../../utils/json-schema";
import { $pg } from "../../services/postgres";

export type ImageMap = Static<typeof ImageMapSchema>;
export const ImageMapSchema = $schema.Object({
    id: $schema.String(),
    original_url: $schema.String(),
    content_type: $schema.String(),
});

export const $imageMap = {
    knex: (session = $pg) => {
        return session.table<ImageMap>("image_map");
    },
};
