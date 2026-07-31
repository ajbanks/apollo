import { $pg } from "../../services/postgres";

export interface ApiKey {
    key: string;
    client_id: string;
    enabled: boolean;
    permissions: string[];
}

export const $apiKeys = {
    TABLE_NAME: "api_keys",
    knex: (session = $pg) => {
        return session.table<ApiKey>($apiKeys.TABLE_NAME);
    },
};
