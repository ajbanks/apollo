-- generate geojson (~10 mins) with
-- ls **.gml | parallel -j12 --bar --eta 'ogr2ogr -oo XSD=/dev/null -f "GeoJSON" -s_srs EPSG:27700 -t_srs EPSG:4326 {//}.geojson {}'
-- generate arrow files using geojson2h3 (~7 hours) with e.g.
-- ls $HOME/projects/inspire/data/*.geojson | parallel -j3 --bar --eta 'julia +1.9.4 --threads=2 --project=. geojson2h3.jl -r15 --compact -k"INSPIREID" --keytype="UInt32" {} out/{/.}.arrow &> /dev/null'
-- import using this script (~10 mins from HDD)
DROP TABLE IF EXISTS inspire_compact;
CREATE TABLE inspire_compact
ENGINE = MergeTree
ORDER BY (h3, INSPIREID)
AS SELECT assumeNotNull(h3) h3, assumeNotNull(INSPIREID) INSPIREID
FROM file('oliver_inspire_compact_apr2025/*.arrow');
