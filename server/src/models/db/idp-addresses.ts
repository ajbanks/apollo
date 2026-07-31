import { FullAddress } from "../../services/ideal-postcodes";
import { $pg } from "../../services/postgres";

export type IdpAddress = {
    id: string;
    timestamp: Date;
    postcode: string;
    uprn?: string | null;
    udprn?: string | null;
    data: FullAddress;
};

export const $idpAddresses = {
    knex: (session = $pg) => {
        return session.table<IdpAddress>("idp_addresses");
    },
};
