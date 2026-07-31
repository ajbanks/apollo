require("ts-node").register();
const { config } = require("./src/services/postgres.ts");
module.exports = config;
