import { $logger } from "./logger";

export function parseDatabaseUrl(url: string) {
    const { protocol, username, password, hostname, port, pathname } = new URL(
        url
    );

    $logger.debug({
        protocol,
        username,
        password: password ? "****" : null,
        hostname,
        port,
        pathname,
    });

    return {
        host: hostname,
        port: port || "5432",
        db: pathname.slice(1), // remove leading "/"
        user: username,
        password,
    };
}
