import { sleep } from "@bahatron/utils/lib/helpers";
import { $session } from "../../app/session.service";
import { $bull } from "../../services/bull";
import axios from "axios";
import { $logger } from "../../utils/logger";

async function processDownloadTitleDocumentHandler({
    reference,
    webhook,
    ttl = 0,
}) {
    $logger.info(`testing download title document ${reference} ${ttl}`);

    await sleep(5000);

    if (++ttl >= 3) {
        $logger.info(`reference ${reference} ttl exceeded, exiting...`);
        await axios({
            url: webhook,
            method: "post",
            data: {
                reference,
            },
        }).catch($logger.warn);
    } else {
        $logger.info(`reference ${reference} ttl ${ttl} - requesting again...`);

        ProcessTitleDocumentDownloadQueue.add({
            reference,
            webhook,
            ttl,
        });
    }
}

export const ProcessTitleDocumentDownloadQueue = $bull.Queue<{
    reference: string;
    webhook: string;
    ttl?: number;
}>("title_process_document_download", async (job) => {
    await $session.run({ process: "title_process_document_download" }, () =>
        processDownloadTitleDocumentHandler(job.data)
    );
});
