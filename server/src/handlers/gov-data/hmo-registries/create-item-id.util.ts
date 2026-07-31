import { jsonStringify } from "@bahatron/utils/lib/helpers";
import { createHash } from "crypto";

export function createItemId(params: {
    district: string;
    address: string;
    date: string;
}) {
    return createHash(`sha1`)
        .update(`${params.district}-${params.address}-${params.date}`)
        .digest("hex");
}
