#!/bin/bash

clickhouse-client -q "
    CREATE TABLE census_2021_data
    ENGINE = MergeTree()
    ORDER BY id AS
    SELECT *
    FROM postgresql(
        '${POSTGRES_HOST}',
        '${POSTGRES_DB}',
        'census_2021_data',
        '${POSTGRES_USER}',
        '${POSTGRES_PASSWORD}'
    );
"