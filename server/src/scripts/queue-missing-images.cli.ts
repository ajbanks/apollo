import { CliCommand } from "../app/cli-command";
import { ProcessRmImage } from "../handlers/properties/process-property-image.queue";
import { $imageMap } from "../models/db/image-map";
import { $propertyListings } from "../models/db/property-listings";
import { $logger } from "../utils/logger";

export const QueueMissingImagesCmd = CliCommand({
    name: "queue-missing-images",
    handler: queueMissingImages,
});

export async function queueMissingImages() {
    let stream = await $propertyListings.knex().select("id", "data").stream();

    for await (let listing of stream) {
        let map: Record<string, string> = {};

        (listing.data?.details?.floorplans ?? []).map((item: any) => {
            map[item.url] = "floor_plan";
        });

        (listing.data?.details?.images ?? []).map((item: any) => {
            map[item.url] = "property";
        });

        let images = await $imageMap
            .knex()
            .select("original_url")
            .whereIn("original_url", Object.keys(map));

        let imageMap = images.reduce((map, img) => {
            map[img.original_url] = true;

            return map;
        }, {} as Record<string, true>);

        let missing = Object.fromEntries(
            Object.entries(map).filter(([url]) => !imageMap[url])
        );

        $logger.debug({ map, imageMap, missing });

        await Promise.all(
            Object.entries(missing).map(async ([url, type]) => {
                await ProcessRmImage.add(
                    { original_url: url },
                    { jobId: `image_${url}` }
                );

                $logger.info({ url, type }, `queued property image`);
            })
        );
    }
}
