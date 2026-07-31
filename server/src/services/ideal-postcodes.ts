import axios from "axios";
import { $env } from "../utils/env";
import { $logger } from "../utils/logger";
import { pick } from "lodash";
import { ExpectationFailed } from "@bahatron/utils/lib/error";

export interface Suggestion {
    id: string;
    suggestion: string;
}

export interface FullAddress {
    postcode: string;
    postcode_inward: string;
    postcode_outward: string;
    post_town: string;
    dependant_locality: string;
    double_dependant_locality: string;
    thoroughfare: string;
    dependant_thoroughfare: string;
    building_number: string;
    building_name: string;
    sub_building_name: string;
    po_box: string;
    department_name: string;
    organisation_name: string;
    udprn: number;
    postcode_type: string;
    su_organisation_indicator: string;
    delivery_point_suffix: string;
    line_1: string;
    line_2: string;
    line_3: string;
    premise: string;
    longitude: number;
    latitude: number;
    eastings: number;
    northings: number;
    country: string;
    traditional_county: string;
    administrative_county: string;
    postal_county: string;
    county: string;
    district: string;
    ward: string;
    uprn: string;
    id: string;
    country_iso: string;
    country_iso_2: string;
    county_code: string;
    language: string;
    umprn: string;
    dataset: string;
}

const client = axios.create({
    baseURL: "https://api.ideal-postcodes.co.uk/v1",
});

export const $idealPostcodes = {
    async autoComplete(slug: string): Promise<Suggestion[]> {
        $logger.info({ slug }, "fetching autocomplete from ideal postcodes");

        let response = await client({
            method: "get",
            url: `/autocomplete/addresses`,
            params: {
                query: slug,
                api_key: $env.IDEAL_POSTCODES_API_KEY,
                context: "GBR",
            },
        });

        $logger.debug(
            {
                ...response,
                request: pick(response.request, ["path", "method", "headers"]),
            },
            "got response from ideal postcodes autocomplete"
        );

        return response.data.result.hits
            .map((i) => {
                return pick(i, ["id", "suggestion"]);
            })
            .filter((item) => {
                return !item.suggestion.toLowerCase().includes("po box");
            });
    },

    async fetchAddressByUPRN(uprn: string): Promise<FullAddress> {
        let { data: response } = await client({
            method: "get",
            url: `/addresses`,
            params: {
                uprn,
                api_key: $env.IDEAL_POSTCODES_API_KEY,
                context: "GBR",
            },
        });

        let address = response.result.hits[0];

        if (!address) throw ExpectationFailed({ uprn }, "Address not found");

        return address;
    },

    async fetchAddressById(id: string): Promise<FullAddress> {
        let { data } = await client({
            method: "get",
            url: `/autocomplete/addresses/${id}/gbr`,
            params: {
                api_key: $env.IDEAL_POSTCODES_API_KEY,
            },
        });

        $logger.info(data, "ideal postcode address lookup successful");

        return data.result;
    },

    async fetchByUDPRN(udprn: string): Promise<FullAddress> {
        $logger.debug({ udprn }, "fetching udprn from ideal postcodes");

        let { data } = await client({
            method: "get",
            url: `/udprn/${udprn}`,
            params: {
                api_key: $env.IDEAL_POSTCODES_API_KEY,
            },
        });

        $logger.debug(data, "result from fetching UPRN");

        return data.result;
    },
};
