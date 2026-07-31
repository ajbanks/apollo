import { stringify } from "@bahatron/utils/lib/helpers";
import { writeFile } from "fs/promises";
import { resolve } from "path";

/**
 * @description must include filename and extension
 */
export function dumpPath(subpath: string) {
    return resolve(process.cwd(), `.dumps/${subpath}`);
}

export async function dumpFile(fileName: string, data: any) {
    await writeFile(resolve(process.cwd(), `.dumps/${fileName}`), data);
}

/**
 * @description resolved path from package.json
 */
export function basePath(subpath: string) {
    return resolve(process.cwd(), subpath);
}
