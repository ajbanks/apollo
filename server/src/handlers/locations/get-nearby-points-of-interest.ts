import { omit, pick } from "lodash";
import { $axios } from "../../utils/axios";
import { $logger } from "../../utils/logger";
import { $schema, Static } from "../../utils/json-schema";
import moment from "moment";

export type PointOfInterest = Static<typeof PointOfInterestSchema>;
export const PointOfInterestSchema = $schema.Object({
    id: $schema.String(),
    node_type: $schema.String(),
    type: $schema.String(),
    name: $schema.String(),
    position: $schema.Object({
        lat: $schema.String(),
        lon: $schema.String(),
    }),
});

export async function getNearbyPointsOfInterest({
    lat,
    lon,
}): Promise<PointOfInterest[]> {
    /** @description in meters */
    let radius = 1600;

    let start = moment();

    let query = `
        [out:json];
        (
        // Education amenities
        node["amenity"="kindergarten"](around:${radius}, ${lat}, ${lon});
        node["amenity"="school"](around:${radius}, ${lat}, ${lon});
        node["amenity"="college"](around:${radius}, ${lat}, ${lon});
        node["amenity"="university"](around:${radius}, ${lat}, ${lon});
        
        // Health amenities
        node["amenity"="hospital"](around:${radius}, ${lat}, ${lon});
        node["amenity"="clinic"](around:${radius}, ${lat}, ${lon});
        node["amenity"="pharmacy"](around:${radius}, ${lat}, ${lon});
        node["amenity"="doctors"](around:${radius}, ${lat}, ${lon});
        
        // Sustenance amenities
        node["amenity"="restaurant"](around:${radius}, ${lat}, ${lon});
        node["amenity"="cafe"](around:${radius}, ${lat}, ${lon});
        node["amenity"="fast_food"](around:${radius}, ${lat}, ${lon});
        node["amenity"="bar"](around:${radius}, ${lat}, ${lon});
        node["amenity"="pub"](around:${radius}, ${lat}, ${lon});
        
        // Public services and banks
        node["amenity"="library"](around:${radius}, ${lat}, ${lon});
        node["amenity"="police"](around:${radius}, ${lat}, ${lon});
        node["amenity"="fire_station"](around:${radius}, ${lat}, ${lon});
        node["amenity"="bank"](around:${radius}, ${lat}, ${lon});
        node["amenity"="prison"](around:${radius}, ${lat}, ${lon});
        
        // Leisure (entertainment and parks)
        node["leisure"="park"](around:${radius}, ${lat}, ${lon});
        node["leisure"="cinema"](around:${radius}, ${lat}, ${lon});
        node["leisure"="theatre"](around:${radius}, ${lat}, ${lon});
        node["leisure"="nightclub"](around:${radius}, ${lat}, ${lon});
        node["leisure"="arts_centre"](around:${radius}, ${lat}, ${lon});
        
        // Railway stations
        node["railway"="station"](around:${radius}, ${lat}, ${lon});
        );
        out center;
    `;

    let url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(
        query
    )}`;

    let response = await $axios({ method: "get", url });

    $logger.info(
        {
            time: `${moment().diff(start, "seconds").toFixed(3)}s`,
        },
        `fetched overpass query`
    );

    let result = response.data.elements.map((item) => {
        return {
            id: item.id,
            node_type: item.tags?.amenity
                ? "amenity"
                : item.tags?.leisure
                ? "leisure"
                : item.tags?.railway
                ? "railway"
                : item.tags?.shop
                ? "shop"
                : null,
            type:
                item.tags?.amenity ??
                item.tags?.leisure ??
                item.tags?.railway ??
                null,
            name: item.tags?.name ?? item.tags,
            position: item.center
                ? { ...item.center }
                : { lat: item.lat, lon: item.lon },
        };
    });

    $logger.debug(
        { meta: omit(response.data, "elements"), result },
        "overpass response"
    );

    return result;
}
