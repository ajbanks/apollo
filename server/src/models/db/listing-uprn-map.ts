import { $schema, Static } from "../../utils/json-schema";
import { $pg } from "../../services/postgres";

export type ListingUprnMap = Static<typeof ListingUprnMap>;
export const ListingUprnMap = $schema.Object({
    listing_id: $schema.String(),
    uprn: $schema.String(),
    inspire_id: $schema.Nullable($schema.String()),
});

const TABLE_NAME = "listing_uprn_map";

export const $listingUprnMap = {
    knex: (session = $pg) => {
        return session.table<ListingUprnMap>(TABLE_NAME);
    },
};
