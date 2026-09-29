// LinkPulse - Live Data Analytics
// This migration adds an `analytics_events` table that stores one row per
// recorded click (as opposed to the existing `visits` table, which stores
// hourly-aggregated counters). The extra per-event table powers:
//   - the "Clicks today" / "clicks over time" overview metrics
//   - the live "Recent activity" feed on the dashboard
//   - device (desktop/mobile/tablet) breakdown, which the aggregated
//     `visits` table does not track
//
// The existing `visits` aggregate table is left untouched so nothing that
// already depends on it (the /stats page, /api/links/:id/stats) breaks.

const env = require("../env");

const isMySQL = env.DB_CLIENT === "mysql" || env.DB_CLIENT === "mysql2";

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function up(knex) {
  const hasTable = await knex.schema.hasTable("analytics_events");

  if (!hasTable) {
    await knex.schema.createTable("analytics_events", (table) => {
      table.increments("id").primary();

      table.integer("link_id").unsigned().notNullable();
      table
        .foreign("link_id")
        .references("id")
        .inTable("links")
        .onDelete("CASCADE")
        .withKeyName("analytics_events_link_id_foreign");

      table.integer("user_id").unsigned();
      table
        .foreign("user_id")
        .references("id")
        .inTable("users")
        .onDelete("CASCADE")
        .withKeyName("analytics_events_user_id_foreign");

      // short, non-identifying fields only - no raw IP address is ever stored
      table.string("browser", 32).notNullable().defaultTo("other");
      table.string("os", 32).notNullable().defaultTo("other");
      table.string("device", 16).notNullable().defaultTo("desktop");
      table.string("country", 2).notNullable().defaultTo("unknown");
      table.string("referrer", 255).notNullable().defaultTo("direct");

      table.dateTime("created_at").notNullable().defaultTo(knex.fn.now());
    });
  }

  const ifNotExists = isMySQL ? "" : "IF NOT EXISTS";

  await Promise.all([
    knex.raw(`CREATE INDEX ${ifNotExists} analytics_events_link_id_index ON analytics_events (link_id);`),
    knex.raw(`CREATE INDEX ${ifNotExists} analytics_events_user_id_index ON analytics_events (user_id);`),
    knex.raw(`CREATE INDEX ${ifNotExists} analytics_events_created_at_index ON analytics_events (created_at);`),
  ]);
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function down(knex) {
  await knex.schema.dropTableIfExists("analytics_events");
}

module.exports = {
  up,
  down,
};
