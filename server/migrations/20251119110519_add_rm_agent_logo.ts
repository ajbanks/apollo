import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable("rm_agent_logos", (table) => {
        table.string("agent_id").primary();
        table.string("content_type");
        table.text("data");
    });
}

export async function down(knex: Knex): Promise<void> {}
