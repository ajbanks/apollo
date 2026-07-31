#!/bin/bash

# Copy the 'best known information' about a property table into ClickHouse, making some transformations

# make sure script works from everywhere
cd "$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
./run_ch_sql.sh properties_simon.sql
