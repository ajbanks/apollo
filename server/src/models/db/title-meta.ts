import { TitleNumber } from "../../handlers/hmlr/get-title-number.request";
import { $pg } from "../../services/postgres";

export interface TitleMeta {
    id: string;
    title: string;
    tenure: string;
    postcode: string;
    date: Date;
    meta: TitleNumber;
    availability: {
        register: {
            type: "register";
            type_code: "REGISTER";
            availability: "string";
            availability_code: "UNAVAILABLE" | "IMMEDIATE";
            backdated: boolean;
        };
        title_plan: {
            type: "plan";
            type_code: "TITLEPLAN";
            availability: "string";
            availability_code: "UNAVAILABLE" | "IMMEDIATE";
            backdated: boolean;
        };
    };
}

export const $titleMeta = {
    TABLE_NAME: "title_metadata",
    knex: (session = $pg) => {
        return session.table<TitleMeta>($titleMeta.TABLE_NAME);
    },
};
