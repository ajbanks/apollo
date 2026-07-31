import Shapefile from "shapefile";
import { GeoFeature } from "./geo.type";
const shapefile = require("shapefile") as typeof Shapefile;

/**
 * @todo instead of using a cb parameter, return an async iterator
 * @description make sure there's both a .dbf and a .shp file. The base path should not contain an extension
 */
export async function parseShapeFile(
    filePath: string,
    cb: (item: GeoFeature) => any
): Promise<void> {
    let file = await shapefile.open(filePath, filePath);

    // Feature<Geometry, GeoJsonProperties>
    while (true) {
        let shape = await file.read();

        if (shape.done) break;

        await cb(shape.value as any);
    }
}
