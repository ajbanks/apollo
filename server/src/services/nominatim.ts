import { $logger } from "../utils/logger";
import { $proxyV2 } from "./proxy";

const BASE_URL = "https://nominatim.openstreetmap.org";

export interface NominatimResult {
    lat: string;
    lon: string;
    osm_id: string;
    osm_type: string;
    type: string;
    category: string;
    [x: string]: any;
}

export const $nominatim = {
    async reverse(point: {
        lat: string | number;
        lon: string | number;
    }): Promise<NominatimResult | null> {
        try {
            let { data } = await $proxyV2({
                method: "get",
                url: `${BASE_URL}/reverse`,
                params: {
                    format: "jsonv2",
                    namedetails: 1,
                    countrycodes: "gb",
                    ...point,
                },
            });

            if (data.error) {
                $logger.warn(data, "no OSM result found");
                return null;
            }

            return data;
        } catch (err: any) {
            $logger.warn(err, "nominatim reverse error");

            if (err.message.includes("404")) return null;

            return $nominatim.reverse(point);
        }
    },

    async search({
        query,
        street,
        postalCode,
    }: {
        query?: string;
        street?: string;
        postalCode?: string;
    }): Promise<NominatimResult[]> {
        let payload = {};

        if (query) {
            payload["q"] = query;
        } else if (street && postalCode) {
            payload["street"] = street;
            payload["postcalcode"] = postalCode;
        }

        let { data } = await $proxyV2({
            method: "get",
            url: `${BASE_URL}/search`,
            params: {
                format: "jsonv2",
                namedetails: 1,
                addressdetails: 1,
                countrycodes: "gb",
                ...payload,
            },
        });

        return data;
    },
};
