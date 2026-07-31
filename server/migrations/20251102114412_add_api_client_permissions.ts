import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable("api_keys", (table) => {
        table
            .specificType("permissions", "text[]")
            .notNullable()
            .defaultTo("{}");
    });
}

export async function down(knex: Knex): Promise<void> {}
