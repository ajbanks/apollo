import moment from "moment";
import { $logger } from "./logger";
import { performance } from "perf_hooks";

export async function time<T = any>(name: string, handler: T) {
    let start = performance.now();

    let result = await handler;

    $logger.info(
        {
            time: `${Number(
                (performance.now() - start).toFixed(1)
            ).toLocaleString()} ms`,
        },
        `time taken for ${name}`
    );

    return result;
}
