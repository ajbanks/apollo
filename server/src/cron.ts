import cron from "node-cron";
import { $logger } from "./utils/logger";
import { ingestProbateFeed } from "./handlers/gov-data/probate-gazette/ingest-probate-gazette-feed.cli";
import { loadRmEventsToCH } from "./handlers/rightmove/rm-events-to-ch";
import { scanContractsFromContractFinders } from "./handlers/gov-contracts/scan-contract-finders-csv";
import { calculateAllAgentsStatistics } from "./handlers/rightmove/rm-agents/calculate-agent-statistics.cli";
import { $slack } from "./services/slack";

// every day at 1am
cron.schedule("0 1 * * *", async () => {
    await Promise.all([ingestProbateFeed()]);
});

// every saturday 1am
cron.schedule("0 1 * * 6", loadRmEventsToCH);

//every day at 9am
cron.schedule("0 9 * * *", scanContractsFromContractFinders);

// every month on the 1st at 2am
cron.schedule("0 2 1 * *", async () => {
    await calculateAllAgentsStatistics();
});

$logger.info(`cron scheduler activated`);
