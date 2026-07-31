import { readFileSync } from "fs";
import { Knex } from "knex";
import { resolve } from "path";

export async function up(knex: Knex): Promise<void> {
    let schema = readFileSync(
        resolve(process.cwd(), "./migrations/2021-2025-condensed.sql"),
        "utf-8"
    );
    for (let query of schema.split(";")) {
        if (!query.startsWith("--")) await knex.raw(query);
    }
}

export async function down(knex: Knex): Promise<void> {}
