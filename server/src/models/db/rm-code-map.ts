import { $pg } from "../../services/postgres";
import { $logger } from "../../utils/logger";

const RM_CODE_MAP_TABLE = "rm_code_map";

export interface RmCodeMap {
    code: string;
}

export const $rmCodes = {
    TABLE_NAME: RM_CODE_MAP_TABLE,
    knex: (session = $pg) => session.table<RmCodeMap>(RM_CODE_MAP_TABLE),
};
