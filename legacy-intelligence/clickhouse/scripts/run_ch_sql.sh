#!/bin/bash

# run a SQL script using all the crazy environment variables we might need
clickhouse-client ${CLICKHOUSE_HOST:+--host ${CLICKHOUSE_HOST}} ${CLICKHOUSE_NATIVE_PORT:+--port ${CLICKHOUSE_NATIVE_PORT}} ${CLICKHOUSE_USER:+--user ${CLICKHOUSE_USER}} ${CLICKHOUSE_PASSWORD:+--password ${CLICKHOUSE_PASSWORD}} --param_POSTGRES_HOST=${POSTGRES_HOST} --param_POSTGRES_DB=${POSTGRES_DB} --param_POSTGRES_USER=${POSTGRES_USER} --param_POSTGRES_PASSWORD=${POSTGRES_PASSWORD} --queries-file=$1
