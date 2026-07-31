import { $pg } from "../../services/postgres";

export interface LhaRates {
    location_name: string;
    year: string;
    location_code: string;
    cat_a: number;
    cat_b: number;
    cat_c: number;
    cat_d: number;
    cat_e: number;
}

export const $lhaRates = {
    knex: (session = $pg) => {
        return session.table<LhaRates>("lha_rates");
    },
};
