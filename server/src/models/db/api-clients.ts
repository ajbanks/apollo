import { $pg } from "../../services/postgres";

interface ApiClients {
    id: string;
    name: string;
}

export const $apiClients = {
    TABLE_NAME: "api_clients",
    knex: (session = $pg) => {
        return session.table<ApiClients>($apiClients.TABLE_NAME);
    },
};
