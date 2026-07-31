import { jsonStringify } from "@bahatron/utils/lib/helpers";
import { createHash } from "crypto";

export function createHashKey(data: any): string {
    return createHash(`sha1`)
        .update(typeof data === "string" ? data : jsonStringify(data))
        .digest("hex");
}
