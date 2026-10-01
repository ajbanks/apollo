import { ExpectationFailed } from "@bahatron/utils/lib/error";
import { BedToHabitableRoomsMap } from "./bed-bath-correlation/bed-to-habitable-rooms-map";
import { geolocatePostcode } from "../addresses/geolocate-postcode";

import { $h3 } from "../../utils/h3";
import { $properties, PropertySchema } from "../../models/db/properties";
import moment from "moment";
import { PropertyTypeNeighbors } from "./property-type.values";
import { distance } from "@turf/turf";
import { orderBy } from "lodash";
import { $schema } from "../../utils/json-schema";

export const ComparablePropertiesResponseSchema = $schema.Composite([
    $schema.Pick(PropertySchema, [
        "uprn",
        "lat",
        "lon",
        "address",
        "postcode",
        "total_floor_area",
        "property_type",
        "new_build",
        "bedrooms",
        "num_habitable_rooms",
        "last_epc_certificate_date",
        "epc_rating",
        "epc_potential_rating",
        "last_transaction_price",
        "last_transaction_date",
    ]),
    $schema.Object({
        distance: $schema.Number(),
    }),
]);

export async function getComparableProperties({
    bedrooms,
    propertyType,
    newBuild = null as boolean | null,
    floorArea = null as number | null,
    postcode = null as string | null,
    lat = null as number | null,
    lon = null as number | null,
}) {
    lat = lat == null ? null : Number(lat);
    lon = lon == null ? null : Number(lon);

    let habitableRooms =
        BedToHabitableRoomsMap[propertyType]?.[bedrooms] ?? null;

    if (!lat || !lon) {
        if (!postcode) {
            throw ExpectationFailed(
                "Either lat/lon or postcode must be provided"
            );
        }

        let geoPostcode = await geolocatePostcode(postcode);
        if (!geoPostcode) {
            throw ExpectationFailed({ postcode }, "Postcode not found");
        }

        lat = Number(lat || geoPostcode.lat);
        lon = Number(lon || geoPostcode.lon);
    }

    const RESULT_LIMIT = 25;
    const H3_RING_SIZES = [7, 15, 25];

    let properties: any[] = [];

    for (let ringSize of H3_RING_SIZES) {
        let h3Ring = $h3
            .gridDiskDistances($h3.latLngToCell(lat, lon, 9), ringSize)
            .flat();

        let propertyQuery = $properties
            .knex()
            .select(
                "uprn",
                "lat",
                "lon",
                "address",
                "postcode",
                "total_floor_area",
                "property_type",
                "new_build",
                "bedrooms",
                "num_habitable_rooms",
                "last_epc_certificate_date",
                "epc_rating",
                "epc_potential_rating",
                "last_transaction_price",
                "last_transaction_date",
                "year_built_normalised"
            )
            .where("type", "domestic")
            .whereIn("property_type", PropertyTypeNeighbors[propertyType])
            .whereIn("h3_9", h3Ring)
            .where(function () {
                if (habitableRooms) {
                    this.whereBetween("num_habitable_rooms", [
                        habitableRooms - 1,
                        habitableRooms + 1,
                    ]).orWhere("bedrooms", bedrooms);
                } else {
                    this.where("bedrooms", bedrooms);
                }
            })
            .where(
                "last_transaction_date",
                ">=",
                moment().subtract(2, "years").toDate()
            );

        if (floorArea) {
            propertyQuery.whereBetween("total_floor_area", [
                Number(floorArea) * 0.8,
                Number(floorArea) * 1.2,
            ]);
        }

        if (newBuild !== null) {
            propertyQuery.where({ new_build: newBuild });
        }

        properties = (await propertyQuery).map((item) => {
            return {
                ...item,
                distance: Math.round(
                    distance(
                        [Number(lon), Number(lat)],
                        [Number(item.lon), Number(item.lat)],
                        { units: "meters" }
                    )
                ),
                bedrooms:
                    item.bedrooms ||
                    Number(
                        Object.entries(
                            BedToHabitableRoomsMap[item.property_type!] ?? {}
                        ).find(([bedroomCount, habitableRoomCount]) => {
                            return (
                                Number(habitableRoomCount) ===
                                item.num_habitable_rooms
                            );
                        })?.[0]
                    ),
            };
        });

        if (properties.length >= RESULT_LIMIT) break;
    }

    return orderBy(properties, ["distance"], ["asc"]).slice(0, RESULT_LIMIT);
}
