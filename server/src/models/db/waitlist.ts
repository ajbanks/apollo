import { $pg } from "../../services/postgres";
import { $schema, Static } from "../../utils/json-schema";

export type Waitlist = Static<typeof WaitlistSchema>;

export const WaitlistSchema = $schema.Object({
    email: $schema.String({ format: `email` }),
    created_at: $schema.DateExtended(),
    updated_at: $schema.DateExtended(),
});

export const $waitlist = {
    knex: (session = $pg) => {
        return session.table<Waitlist>(`waitlist`);
    },
};
