#!/bin/bash

clickhouse-client -q "
   DROP TABLE IF EXISTS lrew_property_type_map;
    CREATE TABLE lrew_property_type_map (
        property_type String,
        lrew_type Nullable(String),
    )
    ENGINE = MergeTree()
    ORDER BY (property_type);
"