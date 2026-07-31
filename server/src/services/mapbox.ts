import { $axios } from "../utils/axios";
import { $env } from "../utils/env";

export const $mapbox = {
    async geocode({
        query,
        country = "gb",
    }: {
        query: string;
        country?: string;
    }) {
        let { data } = await $axios({
            method: "GET",
            url: `https://api.mapbox.com/search/geocode/v6/forward`,
            params: {
                access_token: $env.MAPBOX_API_KEY,
                q: query,
                country,
            },
        });

        return data;
    },
};
