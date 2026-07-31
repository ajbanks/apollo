#!/bin/bash

mkdir -p ./geojson

for input in "./gml"/*.gml
do
    output="./geojson/$(basename -- "$input" .gml).geojson"

    if [ -f $output ]; then
        continue
    fi

    echo "Converting $input to $output..."
    ogr2ogr -f "GeoJSON" $output $input
    echo "Converting $input to $output... done!"
    printf "\n"
done
