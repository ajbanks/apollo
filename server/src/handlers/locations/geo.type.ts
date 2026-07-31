export type Point = [number, number] | [number, number, number];
export type Ring = Point[];
export type Polygon = Ring[];

export interface GeoFeature {
    type: "Feature";
    properties: Record<string, any>;
    geometry:
        | {
              type: "MultiPolygon";
              coordinates: Ring[][];
          }
        | {
              type: "Polygon";
              coordinates: Ring[];
          };
}
