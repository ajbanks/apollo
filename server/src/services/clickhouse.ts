import { createClient } from "@clickhouse/client";
import { $env } from "../utils/env";
import moment from "moment";
import { $logger } from "../utils/logger";

/** @deprecated this felt into disrepair */
export enum ClickhouseTables {
    LAND_REGISTRY_ENGLAND = "land_registry_england",
    EPC_DATA_ENGLAND = "epc_data_england",
    UPRN_META = "uprn_os",

    LISTING_UPRN_MAP = "listing_uprn_map",
    RM_LISTING_EVENTS = "rm_listing_events",

    LOCATION_H3 = "location_h3",
    INSPIRE_H3 = "inspire_h3",
    LOCATION_KPIS = "location_kpis_V3_3",

    // vector search POC
    LISTING_EMBEDDINGS = "listing_embeddings",
}

export const ClickhouseMappers = {
    dateTime(date: string | Date) {
        let time = moment(date);

        if (!time.isValid()) return null;

        return time.format("YYYY-MM-DD HH:mm:ss.SSS");
    },
};

export enum ClickhouseDatabases {
    DEFAULT = "default",
    PRISTINE = "pristine",
}

export const $clickhouse = {
    ...ClickhouseTables,
    ...ClickhouseMappers,
    client: createClient({
        url: $env.CLICKHOUSE_URL,
        request_timeout: 3_600 * 1_000,
        keep_alive: {
            enabled: true,
            idle_socket_ttl: 90_000,
        },
    }),
};
