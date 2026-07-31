import https from "https";
import axios from "axios";
import { readFileSync } from "fs";
import { resolve } from "path";
import { $logger } from "../../utils/logger";

$logger.debug(`CWD: ${process.cwd()}`);

export const $hmlr = axios.create({
    httpsAgent: new https.Agent({
        ca: readFileSync(
            resolve(process.cwd(), `./resources/hmlr/prod/hmlr_bundle.prod.cert`)
        ),
        key: readFileSync(
            resolve(process.cwd(), `./resources/hmlr/prod/propexum.prod.key`)
        ),
        cert: readFileSync(
            resolve(process.cwd(), `./resources/hmlr/prod/propexum.prod.pem`)
        ),
    }),
});
