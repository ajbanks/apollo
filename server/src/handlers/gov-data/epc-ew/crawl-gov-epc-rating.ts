import * as cheerio from "cheerio";
import { $axios } from "../../../utils/axios";
import { $logger } from "../../../utils/logger";

export const EPC_RATINGS = {
    A: 92,
    B: 81,
    C: 69,
    D: 55,
    E: 39,
    F: 21,
    G: 0,
};

export async function parseEPCfromGovHtml(url: string) {
    let { data: html } = await $axios({
        url,
    });

    let page = cheerio.load(html);

    let address = (page(".epc-address.govuk-body").html() ?? "")
        .split("<br>")
        .map((text) => text.trim());

    let rating = page(".epc-rating-result").text().replaceAll("\n", "").trim();

    let result = {
        address: address.length ? address : null,
        rating,
    };

    $logger.debug(result, "parsed EPC from government website");

    return result;
}
