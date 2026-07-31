import h3 from "h3-js";
import geojson from "geojson2h3";

export const $h3 = {
    ...geojson,
    ...h3,
    h3HexagonToNumber(h3Index: string) {
        return BigInt(`0x${h3Index}`).toString();
    },
    h3NumberToHexagon(h3: bigint | string) {
        return BigInt(h3).toString(16);
    },
};
