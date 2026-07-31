-- update dt=date, then grab files first with:
/*
cd /mnt/chungus/clickhouse_files/foursquare_os_places/places/
uvx --from awscli aws s3 cp --no-sign s3://fsq-os-places-us-east-1/release/dt=2025-04-08/places/parquet . --recursive
cd /mnt/chungus/clickhouse_files/foursquare_os_places/categories/
uvx --from awscli aws s3 cp --no-sign s3://fsq-os-places-us-east-1/release/dt=2025-04-08/categories/parquet . --recursive
*/
DROP TABLE IF EXISTS foursquare_os_categories;
CREATE TABLE foursquare_os_categories
ENGINE = MergeTree
ORDER BY (category_level, category_id, category_name)
SETTINGS allow_nullable_key = 1
AS SELECT *
FROM file('foursquare_os_places/categories/categories.zstd.parquet');

DROP TABLE IF EXISTS foursquare_os_places;
CREATE TABLE foursquare_os_places
ENGINE = MergeTree
ORDER BY (country, fsq_category_ids, fsq_category_labels, date_closed, h3_15)
SETTINGS allow_nullable_key = 1
AS SELECT *, geoToH3(longitude, latitude, 15) AS h3_15
FROM file ('foursquare_os_places/places/places-*.zstd.parquet');
