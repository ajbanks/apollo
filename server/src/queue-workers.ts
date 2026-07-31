import { initProcess } from "./utils/init-process";
import { $session } from "./app/session.service";
import { globSync } from "fs";
import { $bull } from "./services/bull";

/** @todo auto load queues with glob */
// export const QUEUES = [
//     UpdateListingViewQueue,
//     CrawlDetailsQueue,
//     PostRmCrawlRunQueue,
//     ProcessRmImage,
//     ProcessTitleDocumentDownloadQueue,
//     ProcessRmAgentLogoQueue,
// ];

let fileNames = globSync(__dirname + "/handlers/**/*.queue.*");

export const QUEUES: any[] = [];
for (let file of fileNames) {
    try {
        let module = require(file);

        Object.entries(module).forEach(([name, module]) => {
            if ($bull.isValidQueue(module)) {
                QUEUES.push(module);
            }
        });
    } catch (err: any) {
        // ignore
    }
}

if (require.main === module) {
    $session.run({}, async () => {
        initProcess();

        await Promise.all(
            QUEUES.map(async (entry) => {
                return entry.start();
            })
        );
    });
}
