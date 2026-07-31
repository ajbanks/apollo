import { ExpectationFailed } from "@bahatron/utils/lib/error";
import { $axios } from "../utils/axios";
import { $env } from "../utils/env";
import { $logger } from "../utils/logger";

export interface GeocodeResult {
    address_components: {
        long_name: string;
        short_name: string;
        types: AddressComponentType[];
    }[];
    formatted_address: string;
    geometry: {
        location: Point;
        location_type: string;
        viewport: {
            northeast: Point;
            southwest: Point;
        };
    };
    navigation_points: {
        location: {
            latitude: number;
            longitude: number;
        };
        restricted_travel_modes: ("WALK" | "DRIVE")[];
    }[];
    place_id: string;
    plus_code: {
        compound_code: string;
        global_code: string;
    };
    types: string[];
}

type AddressComponentType =
    | "street_number"
    | "route"
    | "postal_town"
    | "administrative_area_level_1"
    | "administrative_area_level_2"
    | "political"
    | "country"
    | "postal_code";

interface Point {
    lat: number;
    lng: number;
}

export const $googleMaps = {
    async geocode({ address }: { address: string }) {
        let { data, headers } = await $axios({
            url: `https://maps.googleapis.com/maps/api/geocode/json`,
            params: {
                address,
                key: $env.GOOGLE_MAPS_API_KEY,
            },
        });

        $logger.debug({ headers }, "google maps geocode response headers");

        if (data.status !== "OK") {
            $logger.warn(data, "google maps geocode failed");
            throw ExpectationFailed(data, "GOOGLE_MAPS_GEOCODE_FAILED");
        }

        return data.results as GeocodeResult[];
    },
};
