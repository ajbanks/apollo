-- sanity check for improving UPRN matches from building reference number
-- with: 1.8% domestic, 32% commercial
select avg(greatest(uprn_t, uprn) = 0), count(), epc_type from (
    select ede.uprn, ede2.uprn_t, ede.epc_type from epc_data_england ede
    left join (select max(uprn) uprn_t, building_reference_number, epc_type from epc_data_england
    group by all
    having count() > 1 and count(distinct if(uprn != 0, uprn, NULL)) <= 1
    ) ede2 on ede.building_reference_number = ede2.building_reference_number
)
group by all

-- without: 3.5% domestic, 36% commercial
select avg(uprn = 0), count(), epc_type from epc_data_england
group by all

select avg(uprn_t = 0), count(), epc_type from (
    select max(uprn) uprn_t, building_reference_number, epc_type from epc_data_england
    group by all
    having count() > 1 and count(distinct if(uprn != 0, uprn, NULL)) <= 1 and min(uprn) = 0
)
group by all