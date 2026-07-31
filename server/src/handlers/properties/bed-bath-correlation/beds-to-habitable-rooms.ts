import { groupBy } from "lodash";
import { $properties } from "../../../models/db/properties";
import { $logger } from "../../../utils/logger";
import { quantile } from "../../../utils/quantile";
import { dumpFile } from "../../../utils/dump-file";
import { jsonStringify } from "@bahatron/utils/lib/helpers";

export async function bedToHabitableRoomsCorrelation() {
    let properties = await $properties
        .knex()
        .select("num_habitable_rooms", "bedrooms", "property_type")
        .whereNotNull("num_habitable_rooms")
        .whereNotNull("bedrooms")
        .whereNotNull("property_type");

    let byPropertyType = groupBy(properties, "property_type");

    let map = Object.entries(byPropertyType).reduce(
        (_map, [propertyType, props]) => {
            let byBedrooms = groupBy(props, "bedrooms");

            _map[propertyType] = Object.entries(byBedrooms).reduce(
                (fold, [bedrooms, properties]) => {
                    fold[bedrooms.toString()] = quantile(
                        properties
                            .filter(
                                (p) => p.bedrooms! <= p.num_habitable_rooms!
                            )
                            .map((p) => p.num_habitable_rooms!),
                        50
                    );

                    return fold;
                },
                {} as Record<string, number>
            );

            return _map;
        },
        {} as Record<string, Record<string, number>>
    );

    await dumpFile(
        "bed-to-habitable-rooms-correlation.json",
        jsonStringify(map, null, 4)
    );

    return map;
}
