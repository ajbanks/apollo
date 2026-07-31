import { $bull } from "../../services/bull";
import { $session } from "../../app/session.service";
import { upsertRmPropertyListing } from "./upsert-rm-listing.handler";
import { randomUUID } from "crypto";

export const UpdateListingViewQueue = $bull.Queue<{
    id: string;
    active?: boolean;
}>("rm_update_listing_view", async (job) => {
    await $session.run({ process: `rm_update_listing_view` }, () => {
        return upsertRmPropertyListing(job.data.id, job.data.active);
    });
});
