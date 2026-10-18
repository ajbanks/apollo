import { $propertyListings } from "../../models/db/property-listings";
import { $logger } from "../../utils/logger";
import { CliCommand } from "../../app/cli-command";
import { CrawlDetailsQueue } from "./detail-crawler.queue";

/**
 * Backfill `street` (Rightmove displayAddress) on lettings listings that were
 * stored before the field existed. Street isn't recoverable from the markdown
 * a Tavily-style fetch returns — it lives in the page's window.PAGE_MODEL
 * JSON, so the fix is to re-crawl the detail page and let the upsert handler
 * populate it.
 *
 * Enqueues rm_detail_crawler jobs rather than crawling inline — the workers
 * already rate-limit and route through the proxy.
 */
export const BackfillListingStreetsCmd = CliCommand({
    name: "rm-backfill-listing-streets",
    options: {
        outcodes: {
            type: "string",
            description:
                "comma-separated outcodes to restrict the backfill to (e.g. LU1,LU2,W5); default all",
        },
        limit: {
            type: "number",
            description: "max listings to enqueue (default 5000)",
        },
    },
    handler: async (args: any) => {
        const outcodes = String(args?.outcodes ?? "")
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean);
        const limit = Number(args?.limit) || 5000;

        let query = $propertyListings
            .knex()
            .select("id", "postcode")
            .whereNull("street")
            .whereIn("channel", ["RES_LET", "STU_LET"])
            .orderBy("last_crawled_at", "desc")
            .limit(limit);

        for (const outcode of outcodes) {
            query.where("postcode", "ilike", `${outcode} %`).orWhere("postcode", "=", outcode);
        }

        const rows = await query;
        $logger.info({ count: rows.length, outcodes }, "enqueuing street backfill detail crawls");

        let queued = 0;
        for (const row of rows) {
            const id = String(row.id).replace(/^rm\./, "");
            try {
                // jobId dedupes rows already queued by the live crawler.
                await CrawlDetailsQueue.add({ id }, { jobId: `rm_details_${id}` });
                queued++;
            } catch (e: any) {
                $logger.warn({ id: row.id, error: e?.message }, "failed to enqueue detail crawl");
            }
        }

        $logger.info({ queued }, "street backfill enqueued");
        return { queued };
    },
});
