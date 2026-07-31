import { $logger } from "./logger";

export function parseCookies(cookieString?: string): Record<string, string> {
    if (!cookieString) return {};

    let cookies = cookieString.split(`;`).reduce((cookies, item) => {
        let value = item.split(`=`);
        cookies[value[0].trim()] = value[1];
        return cookies;
    }, {} as Record<string, string>);

    $logger.debug(cookies, `parsed cookies`);

    return cookies;
}
