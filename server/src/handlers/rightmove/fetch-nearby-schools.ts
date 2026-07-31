import { $proxyV2 } from "../../services/proxy";

export async function fetchNearbySchools(lat, lon) {
    return $proxyV2({
        method: "get",
        url: `https://www.rightmove.co.uk/properties/api/schools/${lat}/${lon}`,
    });
}
