import { XMLParser } from "fast-xml-parser";

export const $xml = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
});
