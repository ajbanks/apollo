drop table if exists tmp_rm_listings;
create table tmp_rm_listings
engine = MergeTree
order by (channel, bedrooms, property_type, uprn, h3_11, lat, lon, total_floor_area)
settings allow_nullable_key = 1
as
select u.uprn uprn, w.property_type property_type, w.* except (lat, lon, uprn), u.* except (lat, lon, uprn), if(u.lat is null, w.lat, u.lat) as lat, if(u.lon is null, w.lon, u.lon) as lon, geoToH3(lon, lat, 11) h3_11, e.* except (uprn) from vw_rm_listing_events_with_uprns w
inner join (
    select id, any(event_timestamp) event_timestamp from
    (select * from rm_listing_events order by event_timestamp desc)
    group by id
) r on r.id = w.id and r.event_timestamp = w.event_timestamp
left join uprn_os u on u.uprn = w.uprn
left any join (
    select * from epc_data_england t
    inner join (
        select any(id) id, any(lodgement_date) lodgement_date, uprn from
            (
                select id, uprn, lodgement_date from epc_data_england 
                order by lodgement_date desc
            )
        where uprn > 0
        group by uprn
    ) k on k.id = t.id
    where true
    and epc_type = 'domestic'
    and uprn > 0
) e on e.uprn = w.uprn
-- really this should be an asof join so we only get the most recent EPC per property
-- where qualifying_residential = true
-- 250 seconds


-- example comparable usage
select channel, price, lat, lon, uprn, total_floor_area from tmp_rm_listings
where true
and property_type = 'flat'
and bedrooms between 1 and 5
and uprn != 87812378
and channel in ('RES_LET', 'RES_BUY')
and h3ToParent(h3_11,9) in h3kRing(geoToH3(0.0, 51.9, 9), 7)
and (total_floor_area between 20 and 50)
--and ((total_floor_area between 20 and 50) or (total_floor_area is null))
