import { pick } from "lodash";
import axios from "axios";
import { $proxyV2 } from "../../services/proxy";
import { $logger } from "../../utils/logger";

export async function testCall() {
    // let response = await $proxyV2({
    //     url: "https://www.rightmove.co.uk/api/_search?locationIdentifier=REGION^8536&numberOfPropertiesPerPage=24&radius=0.0&sortType=2&index=0&includeSSTC=true&viewType=LIST&channel=BUY&areaSizeUnit=sqft&currencyCode=GBP&isFetching=false",
    // });

    let response = await $proxyV2({
        url: `https://www.onthemarket.com/async/search/properties-v2/?search-type=for-sale&location-id=bristol&view=map-list&bounding-box=_mjyHporMvcUlze%40`,
    });

    // let response = await $proxyV2({
    //     url: `https://www.zoopla.co.uk/for-sale/details/69298967/`,
    // });

    $logger.info(pick(response, ["data", "headers"]));
}
