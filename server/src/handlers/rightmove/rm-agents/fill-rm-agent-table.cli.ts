import { parallelize } from "@bahatron/utils/lib/helpers";
import { CliCommand } from "../../../app/cli-command";
import { $propertyListings } from "../../../models/db/property-listings";
import { foldStream } from "../fold-rm-stream";
import { processAgentData } from "../upsert-rm-listing.handler";
import { queueAgentLogoProcessing } from "./process-agent-logo.queue";

export const FillRmAgentTableCmd = CliCommand({
    name: "fill-rm-agent-table",
    handler: async () => {
        let agentIds = await $propertyListings
            .knex()
            .distinct("agent_id")
            .select("agent_id")
            .pluck("agent_id");

        await parallelize({
            workers: 10,
            queue: agentIds,
            handler: async (agentId) => {
                await queueAgentLogoProcessing(agentId);

                let customer = await getRmCustomerData(agentId!);
                if (!customer) return;

                await processAgentData(customer);
            },
        });
    },
});

export async function getRmCustomerData(agentId: string) {
    let listing = await $propertyListings
        .knex()
        .select("id")
        .where({ agent_id: agentId })
        .orderBy("last_added_at", "desc")
        .first();

    let fold = await foldStream(listing!.id.split("rm.").pop()!);

    let customerData = fold.data?.details?.customer;

    return customerData;
}
