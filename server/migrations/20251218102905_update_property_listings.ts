import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable("property_listings", (table) => {
        table.dropColumn("let_available_date");
        table.dropColumn("agent_branch_name");
        table.jsonb("features");
        table.jsonb("images");
    });
}

export async function down(knex: Knex): Promise<void> {}
