#!/bin/julia

using DataFrames, Dates, Statistics, ThreadsX, H3
include((@__DIR__) * "/../lib.jl")

# age bands
CLUSTER_H3_RESOLUTION = 11
age_bands = select_df(con(), "
    select construction_age_band, geoToH3(lon, lat, $CLUSTER_H3_RESOLUTION) as h3 from raw.epc_location_indexed
    where construction_age_band != ''
")
age_bands.age = ThreadsX.map(construction_age_band_wrangler, age_bands.construction_age_band)
age_bands.age = replace(age_bands.age, nothing => missing)
dropmissing!(age_bands)

cluster_membership = select_df(con(), "select h3, code from pristine.development_cluster_locations")
leftjoin!(age_bands, cluster_membership, on=:h3)
dropmissing!(age_bands)
age_bands_clustered =combine(groupby(age_bands, :code), :age => (x->[quantile(x, [0.25,0.5,0.75])]) => :age_quartiles)

cluster_sizes = combine(groupby(cluster_membership, :code), nrow)
cluster_sizes.area = cluster_sizes.nrow .* H3.API.hexAreaKm2(CLUSTER_H3_RESOLUTION)

# todo: put the processed age bands on the server
epc_data = select_df(con(),"""
    select 
    count(*) number_epc_properties,
    quantiles(0.25,0.5,0.75)(current_energy_efficiency) energy_efficiency_quartiles,
    quantiles(0.25,0.5,0.75)(number_habitable_rooms) habitable_rooms_quartiles,
    quantiles(0.25,0.5,0.75)(toFloat32(total_floor_area)) floor_area_quartiles,
    quantiles(0.25,0.5,0.75)(toFloat32OrNull(floor_height)) floor_height_quartiles,
    quantiles(0.25,0.5,0.75)(toFloat32OrNull(photo_supply)) photo_supply_quartiles,
    quantiles(0.25,0.5,0.75)(toFloat32OrNull(flat_storey_count)) flat_storey_count_quartiles,
    topK(2)(built_form) built_form_most_common,
    code
    from (select distinct on (uprn) geoToH3(lon, lat, 11) h3, * from raw.epc_location_indexed where epc_type = 'domestic') epc left join pristine.development_cluster_locations dcl on epc.h3 = dcl.h3 group by code having code > 0 -- code == 0 is null
""")

buy_data = select_df(con(),"""
    select 
    count(*) number_buy_properties,
    quantiles(0.25,0.5,0.75)(price) price_buy_quartiles,
    code
    from (
        -- at most two years old
        select * from pristine.properties_collapsed_test where toInt16(ceil((toDate(date) - today()) / 365)) >= -1
        and price > 0
        and channel = 'RES_BUY'
    ) rm left join pristine.development_cluster_locations dcl on rm.h3_11 = dcl.h3 group by code having code > 0 -- code == 0 is null
""")

rent_data = select_df(con(),"""
    select 
    count(*) number_rent_properties,
    quantiles(0.25,0.5,0.75)(price) price_let_quartiles,
    code
    from (
        -- at most two years old
        select * from pristine.properties_collapsed_test where toInt16(ceil((toDate(date) - today()) / 365)) >= -1
        and price > 0
        and channel = 'RES_LET'
    ) rm left join pristine.development_cluster_locations dcl on rm.h3_11 = dcl.h3 group by code having code > 0 -- code == 0 is null
""")

# this is ugly but i couldn't get it to work nicely with a fold
# (i am thinking that it was a different bug now)
oj(l,r) = outerjoin(l,r,on=:code)
oj(l) = (r -> oj(l,r))
cluster_stats = oj(cluster_sizes, epc_data) |> oj(rent_data) |> oj(buy_data)
"$(tablespec(sort(enumerate(chtypes(cluster_stats))|>collect, by=x->x[2][1]) .|> x->x[2])) -- sort column names"
# todo: fix ERROR: ClickHouseServerException(43, "DB::Exception", "DB::Exception: Nested type Array(String) cannot be inside Nullable type")
# can either replace missing with [] or something cleverer
execute(con(),
    """
        CREATE TABLE IF NOT EXISTS pristine.development_cluster_statistics
        $(tablespec(sort(enumerate(chtypes(cluster_stats))|>collect, by=x->x[2][1]) .|> x->x[2])) -- sort column names
        ENGINE = MergeTree()
        ORDER BY (code, h3) 
    """
)
insert(con(), "pristine.development_cluster_locations",[df2dict(clusters2upload)]) 





# testing, viewing on map
test_qs = cluster_stats[.!ismissing.(cluster_stats.price_let_quartiles), [:code, :price_let_quartiles]]
test_qs.value = getindex.(test_qs.price_let_quartiles,2)

clusters2write = dropmissing!(leftjoin(cluster_membership, test_qs[!, [:code, :value]], on=:code))
clusters2write.index = string.(clusters2write.h3, base=16)
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", clusters2write[!, [:index, :value]])

# nowhere has a reasonable number so might as well cut this out?
test_qs = cluster_stats[.!ismissing.(cluster_stats.photo_supply_quartiles), [:code, :photo_supply_quartiles]]
test_qs.value = getindex.(test_qs.photo_supply_quartiles,2)

clusters2write = dropmissing!(leftjoin(cluster_membership, test_qs[!, [:code, :value]], on=:code))
clusters2write = clusters2write[.!isnan.(clusters2write.value), :]
clusters2write = clusters2write[clusters2write.value .> 0.01, :]
clusters2write.index = string.(clusters2write.h3, base=16)
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", clusters2write[!, [:index, :value]])
