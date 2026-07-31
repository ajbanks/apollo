import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable("property_listings", (table) => {
        table.dropColumns("data", "images", "features");
    });
}

export async function down(knex: Knex): Promise<void> {}
