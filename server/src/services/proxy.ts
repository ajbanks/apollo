import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { $env } from "../utils/env";
import { $logger } from "../utils/logger";
import { retry } from "@bahatron/utils/lib/helpers";
import { SocksProxyAgent } from "socks-proxy-agent";
import { Agent } from "agent-base";
import { SocksClient, SocksClientOptions } from "socks";
import tls from "tls";

const KNOWN_ERRORS = [
    "Socks5 proxy rejected connection",
    "Client network socket disconnected before secure TLS connection was established",
    "Proxy connection timed out",
    "aborted",
    "socket hang up",
    "Socket closed",
    "getaddrinfo ENOTFOUND",
    "connect ECONNREFUSED",
    "request timeout",
];

/** @deprecated */
export const $proxy = Proxy();
function Proxy(): (options: AxiosRequestConfig) => Promise<AxiosResponse> {
    if (!$env.PROXY_HOST || !$env.PROXY_PORT) {
        return async (options) => undefined as any;
    }

    const socksAgent = new SocksProxyAgent(
        `socks5://${$env.PROXY_HOST}:${$env.PROXY_PORT}`
    );

    const proxyClient = axios.create({
        httpAgent: socksAgent,
        httpsAgent: socksAgent,
        proxy: false,
        headers: {
            "User-Agent":
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.41 Safari/537.36",
        },
    });

    return async (options) => {
        let timer = 45000;

        let handler = async () => {
            let res = await new Promise<AxiosResponse>((resolve, reject) => {
                let timeout = setTimeout(() => {
                    reject(
                        new Error(
                            `request timeout after ${timer}ms - ${options.url}`
                        )
                    );
                }, timer);

                proxyClient(options)
                    .then((response) => {
                        resolve(response);
                    })
                    .catch((err) => {
                        $logger.warn(
                            { url: options.url },
                            `proxy error: ${err.message}`
                        );
                        reject(err);
                    })
                    .finally(() => {
                        clearTimeout(timeout);
                    });
            });

            return res;
        };

        try {
            return await handler();
        } catch (err: any) {
            if (KNOWN_ERRORS.some((msg) => err.message.includes(msg))) {
                return retry(handler, { tries: 5 });
            }

            throw err;
        }
    };
}

export const $proxyV2 = ProxyV2();
function ProxyV2() {
    class ProxyAgent extends Agent {
        connect(req, opts) {
            return SocksClient.createConnection({
                proxy: {
                    type: 5,
                    port: Number($env.PROXY_PORT),
                    host: $env.PROXY_HOST,
                },
                destination: { host: opts.host, port: Number(opts.port) },
                command: "connect",
            }).then(({ socket }) => {
                return tls.connect({
                    socket,
                    servername: opts.servername || opts.host, // force SNI :contentReference[oaicite:0]{index=0}
                    minVersion: "TLSv1.2",
                    maxVersion: "TLSv1.2",
                    // ecdhCurve: "secp384r1",
                    ecdhCurve: "auto",
                    ALPNProtocols: ["http/1.1"],
                });
            });
        }
    }

    let socksAgent = new ProxyAgent();

    let client = axios.create({
        httpAgent: socksAgent,
        httpsAgent: socksAgent,
        proxy: false,
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br, zstd",
            "sec-ch-ua":
                '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
        },
    });

    return async (options) => {
        let timer = 45000;

        let handler = async () => {
            let res = await new Promise<AxiosResponse>((resolve, reject) => {
                let timeout = setTimeout(() => {
                    reject(
                        new Error(
                            `request timeout after ${timer}ms - ${options.url}`
                        )
                    );
                }, timer);

                client(options)
                    .then((response) => {
                        resolve(response);
                    })
                    .catch((err) => {
                        $logger.warn(
                            { url: options.url },
                            `proxy error: ${err.message}`
                        );
                        reject(err);
                    })
                    .finally(() => {
                        clearTimeout(timeout);
                    });
            });

            return res;
        };

        try {
            return await handler();
        } catch (err: any) {
            if (KNOWN_ERRORS.some((msg) => err.message.includes(msg))) {
                return retry(handler, { tries: 5 });
            }

            throw err;
        }
    };
}
