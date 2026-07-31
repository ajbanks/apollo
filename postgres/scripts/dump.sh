#!/bin/sh

pg_dump -O -x -Fc -U ${POSTGRES_USER} ${POSTGRES_DB} > "/dumps/$(date '+%Y-%m-%d')"
echo "dump complete"
