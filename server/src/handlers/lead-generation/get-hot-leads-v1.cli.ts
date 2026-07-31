import { omit } from "lodash";
import { CliCommand } from "../../app/cli-command";
import { dumpFile } from "../../utils/dump-file";
import { $csv } from "../../utils/csv";
import { $clickhouse } from "../../services/clickhouse";
import moment from "moment";
import { $axios } from "../../utils/axios";
import { $env } from "../../utils/env";
import { $logger } from "../../utils/logger";

export const BuildHotLeadsFileV1Cmd = CliCommand({
    name: "hot-leads-v1",
    options: {
        generate: {
            type: "boolean",
            default: false,
        },
    },
    handler: getHotLeadsV1,
});

export async function getHotLeadsV1({ generate }: { generate: boolean }) {
    if (generate) {
        await $axios({
            method: "get",
            url: `${$env.JULIA_SERVICE_URL}/updateleads`,
        });

        $logger.info("hot leads updated successfully.");
    }

    let { data: leads }: any = await $clickhouse.client
        .query({
            query: `SELECT * FROM hot_leads`,
        })
        .then((res) => res.json());

    await dumpFile(
        `${moment().format("YYYY-MM-DD")}-hot-leads.csv`,
        $csv.jsonToCsv(
            leads.map((item) => {
                return {
                    url: `https://propexum.com/property/${item.uprn}`,
                    ...omit(item, [
                        "lat",
                        "lon",
                        "event_timestamp",
                        "date_calculated",
                        "channel",
                        "url",
                    ]),
                };
            })
        )
    );
}
