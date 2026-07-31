import { $pg } from "../../services/postgres";

export interface RmAgentLogos {
    agent_id: string;
    content_type: string;
    data: string;
}

export const $rmAgentLogos = {
    knex: (session = $pg) => session.table<RmAgentLogos>("rm_agent_logos"),
};
