import { $session } from "../../../app/session.service";
import { $rmAgentLogos } from "../../../models/db/rm-agent-logos";
import { $bull } from "../../../services/bull";
import { $proxyV2 } from "../../../services/proxy";
import { $logger } from "../../../utils/logger";
import { getRmCustomerData } from "./fill-rm-agent-table.cli";

export async function queueAgentLogoProcessing(agentId) {
    await ProcessRmAgentLogoQueue.add(
        { agent_id: agentId },
        { jobId: `rm_agent_logo_${agentId}` }
    );

    $logger.debug(`queued logo processing for agent ${agentId}`);
}

export const ProcessRmAgentLogoQueue = $bull.Queue<{
    agent_id: string | number;
}>("process-rm-agent-logo", async (job) => {
    let {
        data: { agent_id },
    } = job;

    await $session.run({ process: `process-rm-agent-logo:${agent_id}` }, () => {
        return downloadRmAgentLogo(agent_id);
    });
});

export async function downloadRmAgentLogo(agent_id) {
    let { logoPath } = await getRmCustomerData(agent_id);

    if (!logoPath) return;

    let record = await $rmAgentLogos
        .knex()
        .where({ agent_id: agent_id })
        .first();

    if (record && record.data) {
        $logger.debug(`logo for agent ${agent_id} already exists, skipping...`);
    }

    let { data, headers } = await $proxyV2({
        url: logoPath,
        responseType: "arraybuffer",
    });

    let contentType = headers["content-type"];

    if (!contentType.includes("image")) {
        $logger.warn({ headers }, `proxy image has unexpected content type`);
        return;
    }

    let base64 = Buffer.from(data).toString("base64");

    await $rmAgentLogos
        .knex()
        .insert({
            agent_id: agent_id,
            content_type: contentType,
            data: base64,
        })
        .onConflict("agent_id")
        .merge();

    $logger.info(`stored logo for agent ${agent_id}`);
}
