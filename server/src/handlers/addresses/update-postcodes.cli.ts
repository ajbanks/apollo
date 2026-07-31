import { parallelize } from "@bahatron/utils/lib/helpers";
import { geolocatePostcode } from "./geolocate-postcode";
import { $propertyListings } from "../../models/db/property-listings";
import { $logger } from "../../utils/logger";
import { CliCommand } from "../../app/cli-command";

export const UpdatePostcodesCommand = CliCommand({
    name: "update-postcodes",
    handler: updatePostcodes,
});

export async function updatePostcodes() {
    let postcodes = await $propertyListings
        .knex()
        .select("postcode")
        .distinct("postcode")
        .whereNotNull("postcode");

    $logger.info(`updating ${postcodes.length} postcodes...`);

    await parallelize({
        workers: 5,
        queue: postcodes,
        handler: async ({ postcode }) => {
            try {
                if (!postcode) return;

                await geolocatePostcode(postcode, true);
            } catch (err: any) {
                $logger.warning(err.message);
            }
        },
    });
}
