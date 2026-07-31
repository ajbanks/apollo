import axios from "axios";
import { $logger } from "../utils/logger";
import { $proxyV2 } from "./proxy";
import { GeoFeature } from "../handlers/locations/geo.type";

let client = axios.create({ baseURL: "https://findthatpostcode.uk" });

export interface PostcodeResponse {
    data: {
        id: string;
        attributes: {
            lat: string;
            lon: string;
            ctry: string;
            ctry_name: string;
            rgn: string;
            rgn_name: string;
            cty: string;
            cty_name: string;
            laua: string;
            laua_name: string;
            msoa21: string;
            msoa21_name: string;
            ttwa: string;
            ttwa_name: string;
            pcds: string;
            location: {
                lat: number;
                lon: number;
            };
            ru11ind: {
                code: string;
                description: string;
            };
            oac11: {
                code: string;
                group: string;
                subgroup: string;
                supergroup: string;
            };
            ward: string;
            ward_name: string;
            [key: string]: any;
        };
        links: {
            [key: string]: string;
        };
        relationships: {
            areas: {
                data: [
                    {
                        id: string;
                    }
                ];
            };
            nearest_places: {
                data: [
                    {
                        id: string;
                    }
                ];
            };
        };
    };
    included: [
        {
            [key: string]: any;
        }
    ];
    links: {
        [key: string]: string;
    };
}

export interface GeoFeatureCollection {
    features: GeoFeature[];
    type: "FeatureCollection";
}

export const $findThatPostcode = {
    async postcode(postcode: string): Promise<PostcodeResponse> {
        let { data } = await client.get(`/postcodes/${postcode}.json`);

        return data;
    },

    async areaGeometry(code: string): Promise<GeoFeatureCollection> {
        let { data } = await client.get(`/areas/${code}.geojson`);

        return data;
    },

    async areaMeta(code: string): Promise<any> {
        let { data } = await client.get(`/areas/${code}.json`);

        return data;
    },

    async mapItGeometry(code: string): Promise<GeoFeature> {
        let { data } = await $proxyV2({
            method: "get",
            url: `https://mapit.mysociety.org/area/${code}.geojson`,
        });

        $logger.debug(data, "map it response");

        return {
            type: "Feature",
            geometry: data,
            properties: {},
        };
    },
};
