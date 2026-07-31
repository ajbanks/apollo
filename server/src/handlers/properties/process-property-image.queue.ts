import { $session } from "../../app/session.service";
import { $imageMap, ImageMap } from "../../models/db/image-map";
import { $bull } from "../../services/bull";
import { $logger } from "../../utils/logger";
import { $proxyV2 } from "../../services/proxy";
import { ulid } from "ulidx";
import { retry } from "@bahatron/utils/lib/helpers";
import { $imageBucket } from "../../services/image-bucket";

export const ProcessRmImage = $bull.Queue<Pick<ImageMap, "original_url">>(
    "rm_process_image",
    async (job) => {
        await $session.run({ process: "rm_process_image" }, async () => {
            let { original_url } = job.data;

            return retry(() => downloadAndMapImage(original_url), {
                timeout: 500,
            });
        });
    }
);

export async function downloadAndMapImage(url: string) {
    $logger.debug({ url }, "downloading image...");

    let map = await $imageMap.knex().where({ original_url: url }).first();

    if (map) return $logger.warn({ url }, `url already mapped`);

    let response = await $proxyV2({
        url,
        responseType: "arraybuffer",
    });

    let contentType = response.headers["content-type"];

    if (!contentType.includes("image")) {
        $logger.warning(
            {
                url,
                headers: response.headers,
            },
            `proxy image has unexpected content type`
        );

        return;
    }

    let key = ulid();

    await $imageBucket.insert({
        data: response.data,
        type: contentType,
        key,
    });

    await $imageMap.knex().insert({
        id: key,
        original_url: url,
        content_type: contentType,
    });

    $logger.info({ key }, "created image map");
}
