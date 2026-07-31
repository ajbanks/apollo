import { execute } from "@bahatron/utils/lib/helpers";
import { $proxyV2 } from "../../services/proxy";
import { $logger } from "../../utils/logger";
import axios from "axios";

let headers = {
    Accept: "*",
    "User-Agent": "Mediapartners-Google",
};

async function getZooplaDetails() {
    return $proxyV2({
        url: "https://www.zoopla.co.uk/for-sale/details/58857610/",
        headers,
    })
        .then((response) => {
            $logger.info(response.data);
        })
        .catch($logger.warning);
}

async function getZoopleSitemap() {
    return $proxyV2({
        url: "https://www.zoopla.co.uk/xmlsitemap/sitemap/index.xml.gz",
        headers,
    })
        .then((response) => $logger.info(response.data))
        .catch($logger.warning);
}

async function getPropertyPalFalse() {
    return $proxyV2({
        url: "https://www.propertypal.com/site-map-towns/z",
        headers,
    })
        .then((response) => $logger.info(response.data))
        .catch($logger.warning);
}

async function getPropertyPalTrue() {
    return $proxyV2({
        url: "https://www.propertypal.com/site-map-towns/y",
        headers,
    })
        .then((response) => $logger.warning(response.data))
        .catch($logger.warning);
}

execute(async () => {
    // await getSitemap();
    // await getDetails();
    await getPropertyPalFalse();
    await getPropertyPalTrue();
});
