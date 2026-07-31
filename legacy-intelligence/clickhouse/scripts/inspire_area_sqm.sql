CREATE TABLE inspire_area_sqm
ENGINE = MergeTree()
ORDER BY (INSPIREID, plot_area_sqm)
AS
select INSPIREID, count(*)*h3HexAreaM2(15) plot_area_sqm from inspire_h3 group by INSPIREID
settings max_memory_usage = 400000000000, max_bytes_before_external_group_by = 200000000000, max_bytes_before_external_sort = 200000000000
