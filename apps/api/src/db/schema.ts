/**
 * The schema aggregator — and nothing else.
 *
 * ATEM-old declared its 21 tables in a 780-line file mixing six domains. Each
 * table was sound; it is their cohabitation that let three modules write into
 * the catalogue tables, each with its own logic, none knowing the other two.
 *
 * There is nothing to write here: each module owns its tables, this file only
 * gathers them for drizzle-kit. It cannot grow.
 */
export * from "../modules/identity/schema.js";
export * from "../modules/referential/schema.js";
export * from "../modules/collection/schema.js";
export * from "../modules/scanlist/schema.js";
export * from "../modules/deck/schema.js";
export * from "../modules/social/schema.js";
export * from "../modules/inbox/schema.js";
export * from "../modules/duel/schema.js";
