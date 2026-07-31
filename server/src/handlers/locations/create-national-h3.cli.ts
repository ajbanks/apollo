import { $locations } from "../../models/db/locations";
import { $logger } from "../../utils/logger";
import { CliCommand } from "../../app/cli-command";
import rewind from "@mapbox/geojson-rewind";
import { $h3 } from "../../utils/h3";

const NATIONAL = "K02000001";

export const CreateNationalGeoJsonCommand = CliCommand({
    name: "create-national-geojson",
    handler: createNationalGeoJson,
});

export async function createNationalGeoJson() {
    let codes = ["N92000002", "W92000004", "S92000003", "E92000001"];

    let data = await $locations
        .knex()
        .select("geometry")
        .whereIn("code", codes);

    let indices = Array.from(
        new Set(
            data.reduce((fold, location) => {
                return fold.concat(
                    $h3.featureToH3Set(location.geometry, 7, {
                        ensureOutput: true,
                    })
                );
            }, [] as string[])
        )
    );

    let geo = rewind($h3.h3SetToMultiPolygonFeature(indices));

    await $locations.knex().where({ code: NATIONAL }).update({
        h3_7: indices,
        geometry: geo,
    });

    $logger.info(`created national h3 index`);
}
