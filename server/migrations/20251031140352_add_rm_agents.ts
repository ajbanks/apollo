import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable("rm_agents", (table) => {
        table.string(`id`).primary();
        table
            .dateTime(`last_updated`, { useTz: true })
            .notNullable()
            .defaultTo(knex.fn.now());
        table.jsonb(`raw`).notNullable();
        table.string(`branch_name`).index();
        table.string(`display_name`).index();
        table.string(`company_name`).index();
        table.string(`trading_name`).index();
        table.string(`address`);
        table.string("postcode").index();
    });

    await knex.schema.alterTable("property_listings", (table) => {
        table.string("agent_id").index().alter();
    });

    await knex.schema.createTable(`rm_agent_statistics`, (table) => {
        table.string(`agent_id`).primary();
        table
            .datetime(`timestamp`, { useTz: true })
            .notNullable()
            .defaultTo(knex.fn.now());
        table.jsonb(`statistics`).notNullable();
        table.jsonb(`sample`).notNullable();
    });
}

export async function down(knex: Knex): Promise<void> {}
