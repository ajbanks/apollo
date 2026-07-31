import { CliCommand } from "../../app/cli-command";
import { $rmAgentStatistics } from "../../models/db/rm-agent-statistics";
import { $csv } from "../../utils/csv";
import { dumpFile } from "../../utils/dump-file";
import { $logger } from "../../utils/logger";
import { quantile } from "../../utils/quantile";

export const AchievedPriceReportCmd = CliCommand({
    name: "hoa-achieved-price-report",
    handler: async () => {
        await achievedPriceReport();
    },
});

async function achievedPriceReport() {
    let stats = await $rmAgentStatistics.knex().where({}).stream();

    let report: any[] = [];
    for await (let agent of stats) {
        let saleSats = agent.statistics["RES_BUY"];

        if (!saleSats) continue;

        let sample = agent.sample.filter((s) => s.channel === "RES_BUY");

        $logger.debug({ sample: sample[0] });

        let exited = sample.filter((s) => Boolean(s.achieved_price));

        let withTransaction = sample.filter((s) => s.sale_transaction != null);

        report.push({
            agent_id: agent.agent_id,
            sample_size: sample.length,
            exited_size: exited.length,
            with_transaction_size: withTransaction.length,
            exited_to_rate: exited.length / sample.length,
            transaction_to_exit_rate: withTransaction.length / exited.length,
            achieved_price_median: saleSats.median_achieved_price,
        });
    }

    await dumpFile("agent-achieved-price-test.csv", $csv.jsonToCsv(report));

    await $logger.info({
        median_exited_to_rate: quantile(
            report.map((r) => r.exited_to_rate),
            50
        ),
        median_transaction_to_exit_rate: quantile(
            report.map((r) => r.transaction_to_exit_rate),
            50
        ),
        median_achieved_price: quantile(
            report.map((r) => r.achieved_price_median),
            50
        ),
    });
}
