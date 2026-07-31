import { ExpectationFailed } from "@bahatron/utils/lib/error";
import { GeoFeature, Polygon, Ring } from "./geo.type";
import { convertEastingsNorthingToLonLat } from "./translate-eastings-to-point";
import rewind from "@mapbox/geojson-rewind";

/**
 * @todo use GeoFeature type from library
 */
export function parseGeoFeature(
    feature: Pick<GeoFeature, "geometry">
): GeoFeature {
    return rewind({
        type: "Feature",
        properties: {},
        geometry: {
            type: "MultiPolygon",
            coordinates: parseGeometry(feature.geometry),
        },
    });
}

/** @todo: make this code readable */
function parseGeometry(geometry: GeoFeature["geometry"]): Polygon[] {
    if (geometry.type === "Polygon") {
        let parsedSet: Ring[] = [];

        for (let points of geometry.coordinates) {
            parsedSet.push(processPoints(points));
        }

        return [parsedSet];
    } else if (geometry.type === "MultiPolygon") {
        let parsedPolygons: Ring[][] = [];

        for (let set of geometry.coordinates) {
            let parsedSet: Ring[] = [];

            for (let points of set) {
                parsedSet.push(processPoints(points));
            }

            parsedPolygons.push(parsedSet);
        }

        return parsedPolygons;
    } else {
        throw ExpectationFailed("INVALID_GEOMETRY_TYPE");
    }
}

function processPoints(points: Ring) {
    let parsedPoints: Ring = [];

    for (let point of points) {
        let tuple = point.slice(0, 2) as [number, number];

        if (tuple[0] > 100) {
            parsedPoints.push(convertEastingsNorthingToLonLat(tuple));
        } else {
            parsedPoints.push(tuple);
        }
    }

    return parsedPoints;
}
