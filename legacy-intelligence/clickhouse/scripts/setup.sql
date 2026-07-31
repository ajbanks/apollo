-- run with clickhouse-client ...

-- not perfect because we assume "one market" for the uk, could improve with big H3s
-- todo: switch to rolling year (copy logic from old KPI code)
DROP TABLE IF EXISTS tmp_lr_price_index;
CREATE TABLE tmp_lr_price_index
ENGINE = MergeTree
ORDER BY date
AS
SELECT
    YYYYMMDDToDate((toYear(date)*100 + 1)*100 + 1) AS date, -- this seems dumb, surely there is another way to floor it
    median(price) AS price,
    price/first_value(price) over (order by date desc) AS price_index
FROM land_registry_england
GROUP BY date
order by date desc;

-- ten seconds
DROP TABLE IF EXISTS tmp_median_lr_price;
CREATE TABLE tmp_median_lr_price
ENGINE = MergeTree
ORDER BY h3
AS
select median(lr.price/ind.price_index) AS price_median, geoToH3(lon, lat, 10) as h3 from (select price, date, uprn, true dummy from land_registry_england) lr -- h3_11 is probably too high res, not enough properties, h3_10 is approx 10
left any join uprn_os using (uprn)
asof left join (select *, true dummy from tmp_lr_price_index) ind on lr.dummy = ind.dummy and lr.date >= ind.date
where uprn != 0
group by h3;
-- sometimes this is too small and returns zero


-- takes 20 seconds
DROP TABLE IF EXISTS tmp_comparables_intrinsic;
CREATE TABLE tmp_comparables_intrinsic
ENGINE = MergeTree
ORDER BY (h3, bedrooms, uprn)
AS
WITH latest AS (
    SELECT
        uprn,
        /* latest per channel via conditional argMaxIf */
        argMaxIf(price,           event_timestamp, channel = 'RES_LET') AS price_let,
        argMaxIf(event_timestamp, event_timestamp, channel = 'RES_LET') AS let_time,
        argMaxIf(price,           event_timestamp, channel = 'STU_LET') AS price_stu,
        argMaxIf(event_timestamp, event_timestamp, channel = 'STU_LET') AS stu_time,
        argMaxIf(price,           event_timestamp, channel = 'RES_BUY') AS price_buy,
        argMaxIf(event_timestamp, event_timestamp, channel = 'RES_BUY') AS buy_time,

        /* bedrooms at the latest event per channel, default 0 */
        ifNull(argMaxIf(bedrooms, event_timestamp, channel = 'RES_LET'), 0) AS bd_let,
        ifNull(argMaxIf(bedrooms, event_timestamp, channel = 'STU_LET'), 0) AS bd_stu,
        ifNull(argMaxIf(bedrooms, event_timestamp, channel = 'RES_BUY'), 0) AS bd_buy
    FROM vw_rm_listing_events_with_uprns
    WHERE uprn != 0
      AND channel IN ('RES_LET','STU_LET','RES_BUY')
    GROUP BY uprn
)
SELECT
    ifNull(l.uprn, 0) AS uprn,
    uo.lat,
    uo.lon,
    ifNull(geoToH3(uo.lon, uo.lat, 11),0) AS h3,
    l.price_let,
    l.let_time,
    l.price_stu,
    l.stu_time,
    l.price_buy,
    l.buy_time,
    lr.price_latest as price_sold,
    lr.date_latest as date_sold,
    tp.pop_in_60 as public_transport_population_within_1h,
    percent_rank() OVER (ORDER BY tp.pop_in_60 DESC) AS public_transport_population_rank,
    ml.price_median AS median_lr_price,
    percent_rank() OVER (ORDER BY ml.price_median DESC) AS median_lr_price_rank,
    p.population as population,
    percent_rank() OVER (ORDER BY p.population DESC) AS population_rank,
    epc.total_floor_area as total_floor_area,
    percent_rank() OVER (ORDER BY epc.total_floor_area DESC) AS total_floor_area_rank,
    ifNull(greatest(l.bd_let, greatest(l.bd_stu, l.bd_buy)), -1) AS bedrooms
FROM latest l
LEFT ANY JOIN uprn_os uo USING (uprn)
LEFT ANY JOIN (
    select uprn, argMax(price, date) price_latest, argMax(date, date) date_latest from land_registry_england where uprn != 0 group by uprn
) lr USING (uprn)
LEFT ANY JOIN transitous_pop_within_60 tp on tp.h3 = h3ToParent(h3, 10)
LEFT ANY JOIN population_h3_11 p on p.h3 = h3 -- todo: add smoothing, this is too high resolution really. iirc arrayjoin(h3kring(h3)) neighbour, h3, avg(pop) group by neighbour works
LEFT ANY JOIN property_vector_search_poc aiembed on aiembed.uprn = l.uprn;
