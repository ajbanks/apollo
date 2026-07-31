#!/bin/bash

max_jobs=20  # Set the max number of parallel jobs
job_count=0

mkdir -p ./geojson

for input in "./gml"/*.gml
do
    output="./geojson/$(basename -- "$input" .gml).geojson"

    if [ -f "$output" ]; then
        continue
    fi

    echo "Converting $input to $output..."
    ogr2ogr -oo XSD=/dev/null -f "GeoJSON" "$output" "$input" &

    # Control the number of concurrent jobs
    job_count=$((job_count + 1))
    if [ "$job_count" -ge "$max_jobs" ]; then
        wait  # Wait for the current batch of jobs to finish
        job_count=0  # Reset job counter
    fi
done

# Wait for remaining background processes to complete
wait

echo "All conversions done!"