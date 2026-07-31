import { execute } from "@bahatron/utils/lib/helpers";
import axios from "axios";
import { $proxyV2 } from "../../services/proxy";
import { $logger } from "../../utils/logger";

let $axios = axios.create({});

const ZOOPLA_URL = "https://api-graphql-lambda.prod.zoopla.co.uk/graphql";

execute(async () => {
    let [properties, listings] = await Promise.all([
        $proxyV2({
            url: ZOOPLA_URL,
            headers: {
                Accept: "*/*",
                Cookie: "cookie: zooplapsid=eb43ad9757e04e756a28e0aa6115151f; zooplasid=6c5281cd33ec47d794f15475c839c23c; _ga=GA1.3.1994087872.1651707278; _gid=GA1.3.1795871879.1651707278; ajs_anonymous_id=2bcff173-fb6f-4f32-8ae3-d61cf636d830",
            },
            data: {
                operationName: "similarProperties",
                variables: { uprn: "200103045" },
                query: "query similarProperties($uprnOs: String) {\n  property(uprn: $uprnOs) {\n    uprn\n    similarProperties {\n      uprn\n      address {\n        fullAddress\n        longitude\n        latitude\n        __typename\n      }\n      attributes {\n        bathrooms\n        bedrooms\n        livingRooms\n        __typename\n      }\n      history {\n        historicSales {\n          date\n          price\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n",
            },
        }),

        $proxyV2({
            url: ZOOPLA_URL,
            headers: {
                Accept: "*/*",
                Cookie: "cookie: zooplapsid=eb43ad9757e04e756a28e0aa6115151f; zooplasid=6c5281cd33ec47d794f15475c839c23c; _ga=GA1.3.1994087872.1651707278; _gid=GA1.3.1795871879.1651707278; ajs_anonymous_id=2bcff173-fb6f-4f32-8ae3-d61cf636d830",
            },
            data: {
                operationName: "similarListings",
                variables: { uprn: "200103045" },
                query: "query similarListings($uprnOs: String) {\n  property(uprn: $uprnOs) {\n    uprn\n    similarListings {\n      listingId\n      title\n      branch {\n        name\n        logoUrl\n        __typename\n      }\n      features {\n        content\n        iconId\n        __typename\n      }\n      image {\n        src\n        caption\n        responsiveImgList {\n          width\n          src\n          __typename\n        }\n        __typename\n      }\n      flag\n      priceTitle\n      price\n      shortPriceTitle\n      address\n      tags {\n        content\n        __typename\n      }\n      listingUris {\n        detail\n        __typename\n      }\n      location {\n        coordinates {\n          latitude\n          longitude\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n",
            },
        }),
    ]).catch((err) => {
        $logger.error(err);
        return [];
    });

    $logger.info({
        properties: properties?.data,
        listings: listings?.data,
    });
});
