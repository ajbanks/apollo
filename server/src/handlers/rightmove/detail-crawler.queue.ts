import { $bull } from "../../services/bull";
import { crawlPropertyDetails } from "./crawl-details";
import { $session } from "../../app/session.service";

export const CrawlDetailsQueue = $bull.Queue<{
    id: string;
}>("rm_detail_crawler", async (job) => {
    await $session.run({ process: "rm_detail_crawler" }, () => {
        return crawlPropertyDetails(job.data.id);
    });
});
