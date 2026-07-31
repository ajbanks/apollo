#!/bin/bash

clickhouse-client -q "
    CREATE TABLE address_map
    ENGINE = MergeTree()
    ORDER BY (uprn) AS
    SELECT uprn, lat, lon, postcode, address
    FROM postgresql(
        '${POSTGRES_HOST}',
        '${POSTGRES_DB}',
        'properties',
        '${POSTGRES_USER}',
        '${POSTGRES_PASSWORD}'
    );
"