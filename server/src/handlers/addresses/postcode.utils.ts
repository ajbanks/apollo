import { ExpectationFailed } from "@bahatron/utils/lib/error";

export const POSTCODE_REGEX = /^(GIR 0AA|[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2})$/;

export function normalisePostcode(str: String) {
    return str.toLowerCase().replace(/\s/g, "");
}

export function getPostcodeSector(postcode: string) {
    /** @todo: improve regex check */
    if (!postcode.includes(" ")) {
        throw ExpectationFailed("INVALID_POSTCODE_FORMAT");
    }

    let split = postcode.split(" ");

    return `${split[0]} ${split[1][0]}`;
}
