import axios from "axios";
import { $logger } from "../utils/logger";

let client = axios.create({ baseURL: `https://api.postcodes.io/postcodes` });

export const $postcodesIO = {
    async postcodeLookup(postcode: string) {
        let response = await client.get(`/${postcode}`);

        return response.data?.result;
    },

    async nearestPostcodes(
        lat: string | number,
        lon: string | number
    ): Promise<any[]> {
        let response = await client.get(`/`, {
            params: {
                lat,
                lon,
            },
        });

        return response.data?.result;
    },

    async autocomplete(partial: string) {
        let { data } = await client.get(`/${partial}/autocomplete`);

        let result = data?.result;

        $logger.debug(result, "result from postcodes API");

        return result;
    },
};
