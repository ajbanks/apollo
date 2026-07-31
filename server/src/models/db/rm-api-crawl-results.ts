import { $pg } from "../../services/postgres";
import { $logger } from "../../utils/logger";

const RM_API_RESULT_TABLE = "rm_api_crawl_runs";

export interface RmApiCrawlResult {
    id: number;
    timestamp: string;
    result: string[];
}

export const $rmApiCrawlResults = {
    knex: (session = $pg) => {
        return session.table<RmApiCrawlResult>(RM_API_RESULT_TABLE);
    },

    async add({ result, timestamp }: { result: string; timestamp: string }) {
        let response = await $rmApiCrawlResults
            .knex()
            .insert({
                timestamp,
                result: result as any,
            })
            .returning("id");

        $logger.debug(response);

        return response[0];
    },

    async fetch(id: number) {
        return $rmApiCrawlResults.knex().where({ id }).first();
    },

    async latest(): Promise<RmApiCrawlResult> {
        let result = await $pg.raw(`
            SELECT * 
            from ${RM_API_RESULT_TABLE} 
            where 
                id = (SELECT max(id) from ${RM_API_RESULT_TABLE})
        `);

        return result.rows?.shift();
    },
};
