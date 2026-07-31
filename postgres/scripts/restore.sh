#!/bin/sh

pg_restore -d ${POSTGRES_DB} -U ${POSTGRES_USER} /dumps/${DUMP_PATH:-seed.sql}