import { $pg } from "../../services/postgres";

export interface RmAgent {
    id;
    last_updated;
    raw;
    branch_name;
    display_name;
    company_name;
    trading_name;
    address;
    postcode;
}
export const $rmAgents = {
    TABLE_NAME: `rm_agents`,
    knex: () => $pg.table<RmAgent>($rmAgents.TABLE_NAME),
};
