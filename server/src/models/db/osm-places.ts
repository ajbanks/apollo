import { $pg } from "../../services/postgres";

export interface OsmPlace {
    id: string;
    lat: string;
    lon: string;
    data: any;
    osm_type: string;
    type: string;
    category: string;
}

export const $osmPlaces = {
    knex: (session = $pg) => session.table<OsmPlace>("osm_places"),
};
