import { $pg } from "../../services/postgres";

export interface TitleUprnMap {
    title: string;
    uprn: string;
}

export const $titleUprnMap = {
    TABLE_NAME: "title_uprn_map",
    knex: (session = $pg) => {
        return session.table<TitleUprnMap>($titleUprnMap.TABLE_NAME);
    },
};
