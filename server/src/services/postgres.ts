import knex, { Knex } from "knex";
import { resolve } from "path";
import { $env } from "../utils/env";
import { types } from "pg";
import { jsonParse } from "@bahatron/utils/lib/helpers";

// data parsing
types.setTypeParser(types.builtins.INT8, parseInt);
types.setTypeParser(types.builtins.INT4, parseInt);
types.setTypeParser(types.builtins.FLOAT8, parseFloat);
types.setTypeParser(types.builtins.NUMERIC, parseFloat);
types.setTypeParser(types.builtins.JSON, jsonParse);
types.setTypeParser(types.builtins.JSONB, jsonParse);
types.setTypeParser(types.builtins.TIMESTAMPTZ, (val) => new Date(val));
types.setTypeParser(types.builtins.DATE, (val) => new Date(val));

export const config: Knex.Config = {
    client: "pg",
    connection: $env.DATABASE_URL,
    pool: {
        min: 0,
        max: 50,
        acquireTimeoutMillis: 1000 * 5,
    },
    migrations: {
        extension: "ts",
        directory: resolve(process.cwd(), "./migrations"),
    },
};

export const $pg = knex(config);
