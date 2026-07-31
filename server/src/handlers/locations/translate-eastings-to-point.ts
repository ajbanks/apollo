import { Point } from "./geo.type";
import proj4 from "proj4";

/**
 * @description [NORTHING, EASTING]
 * @returns [lon, lat]
 * */
export function convertEastingsNorthingToLonLat(point: Point) {
    return proj4(
        "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +datum=OSGB36 +units=m +no_defs",
        "EPSG:4269",
        point
    );
}
