#!/bin/julia

using DataFrames, Dates, Statistics, ThreadsX, CSV
include((@__DIR__) * "/../lib.jl")

CLUSTER_H3_RESOLUTION = 11
# whole country
df = select_df(con(), "
    select construction_age_band, geoToH3(lon, lat, $CLUSTER_H3_RESOLUTION) as index_t from epc_data_england epc
    left join uprn_os uo on epc.uprn = uo.uprn
    where construction_age_band != ''
    and uprn > 0
")
df.age = ThreadsX.map(construction_age_band_wrangler, df.construction_age_band)
df.age2 = replace(df.age, nothing => missing)
dropmissing!(df)

dfg = combine(groupby(df, :index_t), :age2 => median => :age)
# dfg.index = string.(dfg.index_t, base=16)
# dfg.value = dfg.age
# CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", dfg[!, [:index, :value]])

# using CSV, JSON
# CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", dfg[!, [:index, :value, :age]])
#write("$(homedir())/projects/H3-MON/www/data/meta.json", JSON.json(Dict("scale" => Dict(zip([0, 0.2, 0.4, 0.6, 0.8, 1], quantile.(Ref(dfg.age), [0.0001, 0.2, 0.4, 0.6, 0.8, 0.9999]))))))


# pick h3 not in any cluster at random
#   get all neighbours of that h3 not in any clusters # label: 1
#       add all neighbours matching criteria to cluster
#           for each of those neighbours, goto: label 1

# there's some issue with 1900-1900 and 1900-1910 clusters not merging, not clear why

import H3.API: kRing, geoToH3, GeoCoord, h3ToParent
age_dict = Dict(zip(dfg.index_t, dfg.age))
unclustered = Set(keys(age_dict)) # delete!(set, key); push!(set, key)
clusters = []
done = false
i = 0
TOLERANCE = 10.1

function check_neighbours!(start, this_cluster)
    age = get(age_dict, start, 0)
    neighbours = intersect(kRing(start, 2), unclustered) # do we allow gaps or not? 1: no gaps, 2: small gaps
    this_ring = Set()
    # n = neighbours[1]
    for n in neighbours
        if (age - TOLERANCE <= get(age_dict, n, 0) <= age + TOLERANCE)
            push!(this_cluster, n)
            push!(this_ring, n)
            delete!(unclustered, n)
        end
    end
    for n in this_ring
        check_neighbours!(n, this_cluster)
    end
    return this_cluster
end

using ProgressMeter
n = length(unclustered)
p = Progress(n, dt=1)
while length(unclustered) > 0
    start = pop!(unclustered, rand(unclustered))
    this_cluster = Set(start)
    check_neighbours!(start, this_cluster)
    push!(clusters, this_cluster)
    update!(p, n-length(unclustered))
end



d = DataFrame(enumerate(clusters))
d.l = rand(size(d,1))
d = flatten(d, :2)
rename!(d, :1 => :code, :2 => :h3)
# d = combine(groupby(d, :h3), :code => minimum => :code, :l => minimum => :l) # no duplicates :)
transform!(groupby(d, :code), nrow)
# leftjoin!(d, dfg[!, [:code, :age]], on=:index_t)
# addquantiles!(d, :cluster)
d.index = string.(d.h3, base=16)
d.value = d.code
d.res .= CLUSTER_H3_RESOLUTION

# trim small clusters
dsmall = @view d[d.nrow .> 30, :]


CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", dsmall[!, [:index, :value]])
#write("$(homedir())/projects/H3-MON/www/data/meta.json", JSON.json(Dict("scale" => Dict(zip([0, 0.2, 0.4, 0.6, 0.8, 1], quantile.(Ref(dfg.age), [0.0001, 0.2, 0.4, 0.6, 0.8, 0.9999]))))))

# make the location table
clusters2upload = @view d[d.nrow .> 2, [:code, :h3]]
execute(con(),
    """
        CREATE TABLE IF NOT EXISTS development_cluster_locations
        $(tablespec(sort(enumerate(chtypes(clusters2upload))|>collect, by=x->x[2][1]) .|> x->x[2])) -- sort column names
        ENGINE = MergeTree()
        ORDER BY (h3, code) 
    """
)
insert(con(), "development_cluster_locations",[df2dict(clusters2upload)]) 

# df = select_df(con(),"select * from pristine.development_cluster_locations")
# df.index = string.(df.h3, base=16)
# df.value = df.code
# transform!(groupby(df, :code), nrow)
# dsmall = @view df[df.nrow .> 30, :]
# CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", dsmall[!, [:index, :value]])

execute(con(), """
    create table public_median_development_price
    engine MergeTree()
    order by (lon, lat, price)
    as
    select price, p.latitude lat, p.longitude lon from (
        select median(price) price, arrayJoin(groupArray(h3ToGeo(h3))) p from development_cluster_locations dcl
        left join (select price, geoToH3(lon, lat, 11) h3 from tmp_rm_listings where channel = 'RES_BUY') rm on dcl.h3 = rm.h3
        group by code
        having price > 0
    )
""")
