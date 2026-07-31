#!/bin/julia

using DataFrames, Dates, Statistics, ThreadsX
include((@__DIR__) * "/../lib.jl")
con2() = connect("proto.propexum.com", CLICKHOUSE_NATIVE_PORT; database="default", username=CLICKHOUSE_USER, password = CLICKHOUSE_PASSWORD)



## old code from kpis.jl

# some used to be for calculating KPIs, others are for making random graphs etc.



# hard coded because i got fed up of waiting ~2-3 mins each time
loc_h3_stats = DataFrame(
    optimal_h3_res = UInt8[0x0b, 0x09, 0x0b, 0x09, 0x09, 0x0d, 0x09, 0x07, 0x0b, 0x07, 0x09],
    type = ["lsoa21", "ttwa", "msoa21", "fuas", "county", "oa21", "pcon", "region", "ward", "country", "district"],
)

## todo: switch table_query to use cube, restack month, week, quarter in julia(?)
# SELECT count(*), median(price), channel, property_type, bedrooms, toYear(date) AS y, toMonth(date) AS m, toWeek(date) AS w, toQuarter(date) AS q FROM pristine.properties_collapsed_test pct
# GROUP BY CUBE(property_type, bedrooms, y, m, w, q, channel)
# HAVING y IS not NULL -- bit silly because we GROUP BY y AND THEN discard it, but doing GROUPING SETS explicitly would be annoying
# AND channel IS NOT NULL 
# AND (((m IS NOT NULL) + (w IS NOT NULL) + (q IS NOT NULL)) <= 1) -- ensure ONLY one OF m, w, q IS NOT null
# SETTINGS group_by_use_nulls = 1 -- 100k ROWS BEFORE we've even looked AT locations

KEYS_FOR_CHANGES = "agreed floor_area_sqm price price_per_sqm entry_to_agreed_days entry_to_cleared_days" |> split #.|> Symbol
function get_kpis(inner_query, res, type, tres)
    # to accept lists of h3 we need to override table_query to be `pristine ... pc where h3_7 in [big h3_7 array] group by h3_7` and then select h3_7 instead of code, name in all the three queries below
    table_query = "pristine.properties_collapsed_test pc $(type == "this_used_to_be_h3_7_but_i_decided_it_was_a_bad_idea" ? "where h3_7 in $inner_query" : "left outer join ($inner_query) lm on pc.h3_$res = lm.h3") group by code, channel, year, part_of_year"
    # market exit data

    n_quantiles = 1:19 # end+1 should divide 100 nicely
    v_quantiles = n_quantiles ./ (1+length(n_quantiles))
    str_quantiles = v_quantiles |> x -> join(string.(x), ",")
    array_names = join(["percentiles[$n] as price_percentile_$(v*100 |> round |> Int)" for (n,v) in zip(n_quantiles, v_quantiles)], ",")

    # rolling_years: part_of_year = floor((today() - toDate(date)) / 365) as year, floor((today() - toDate(date)) / 365) as year
    time_grouping(tres,dstr="date") = if (tres == "rolling_year")
        "toInt16(ceil((toDate($dstr) - today()) / 365)) as part_of_year, toInt16(ceil((toDate($dstr) - today()) / 365)) as year"
    else
        "to$(uppercasefirst(tres))($dstr) as part_of_year, toYear($dstr) as year"
    end

    exits = reduce(vcat, map(beds -> select_df(con(), """
        select 
        median(price) as price_t, median(if(time_in_market >= 1, time_in_market, null)) as tim,
        min(date) as date_start,
        max(date) as date_end,
        count(price) as price_sample_size,
        sum(if(time_in_market >= 0, price, 0)) as nsales_total_value,
        quantiles($str_quantiles)(price) as percentiles, $array_names,
        median(if(total_floor_area > 0, total_floor_area, null)) as total_floor_area,
        median(if(price_per_sqm > 0, price_per_sqm, null)) as price_per_sqm,
        count(if(time_in_market >= 0, 1, null)) as nsales, -- nb: = 0 is used for land registry
        $(type == "this_used_to_be_h3_7_but_i_decided_it_was_a_bad_idea" ? "h3_7 as" : "") code, $(time_grouping(tres)), $(type == "this_used_to_be_h3_7_but_i_decided_it_was_a_bad_idea" ? "h3_7 as name" : "any(name) as name"), channel, $(beds ? "" : "-1 as ") bedrooms
        from $table_query $(beds ? ", bedrooms having bedrooms > -1" : "")
    """), [true, false])) # TODO: switch to cube, grouping by bedrooms + property_type
    rename!(exits, :price_t => :price) # get rid of temporary name
    exits = exits[!, Not(:percentiles)] # drop ugly array

    # market entry data
    entries = reduce(vcat, map(beds -> select_df(con(), """
        select count(*) as nlisted, $(beds ? "" : "-1 as ") bedrooms, $(type == "this_used_to_be_h3_7_but_i_decided_it_was_a_bad_idea" ? "h3_7 as" : "") code, channel, $(time_grouping(tres, "listed_date")) from $table_query $(beds ? ", bedrooms having bedrooms > -1" : "")
    """), [true, false]))

    # land registry exits
    lre_clears = reduce(vcat, map(beds -> select_df(con(), """
        select 
        median(if(time_to_clear > 0, time_to_clear, null)) as ttc,
        count(if(time_to_clear > 0, 1, null)) as ncleared,
        $(beds ? "" : "-1 as ") bedrooms, $(type == "this_used_to_be_h3_7_but_i_decided_it_was_a_bad_idea" ? "h3_7 as" : "") code, channel, $(time_grouping(tres, "clear_date")) from $table_query $(beds ? ", bedrooms having bedrooms > -1" : "")
    """), [true, false]))

    kpis = leftjoin(exits, entries, on=[:year, :part_of_year, :code, :channel, :bedrooms])
    leftjoin!(kpis, lre_clears, on=[:year, :part_of_year, :code, :channel, :bedrooms])
    sort!(kpis, [:code, :channel, :bedrooms, :year, :part_of_year])
    kpis.nsales .= Float64.(kpis.nsales)

    rename!(kpis, 
        :nlisted => :new_entries,
        :nsales => :agreed,
        :nsales_total_value => :agreed_total_value,
        :ttc => :entry_to_cleared_days,
        :tim => :entry_to_agreed_days,
        :ncleared => :cleared,
        :total_floor_area => :floor_area_sqm,
    ) # clean up bad names

    # should probably rename type, name, code to "location_type" etc?

    # get mom/qoq change
    k = combine(groupby(kpis, [:code, :channel, :bedrooms]), :part_of_year => (x->mod.(x,12)) ∘ diff => :diff, map(x -> Symbol(x) => diff => Symbol(x*"_change"), KEYS_FOR_CHANGES)..., :part_of_year => (m -> m[2:end]) => :part_of_year, :year => (y -> y[2:end]) => :year)
    for key in KEYS_FOR_CHANGES
        k[!, Symbol(key*"_change")] .= k[!, Symbol(key*"_change")] ./ k.diff
    end

    leftjoin!(kpis, k[!, Not(:diff)], on=[:code, :channel, :bedrooms, :part_of_year, :year])

    # nb: for resolution = year, _change_yoy should be the same as _change, but instead it is null
    y = combine(groupby(kpis, [:code, :channel, :bedrooms, :part_of_year]), :year => diff => :diff, map(x -> Symbol(x) => diff => Symbol(x*"_change_yoy"), KEYS_FOR_CHANGES)..., :part_of_year => (m -> m[2:end]) => :part_of_year, :year => (y -> y[2:end]) => :year)
    for key in KEYS_FOR_CHANGES
        y[!, Symbol(key*"_change_yoy")] .= y[!, Symbol(key*"_change_yoy")] ./ y.diff
    end

    leftjoin!(kpis, y[!, Not(:diff)], on=[:code, :channel, :bedrooms, :part_of_year, :year])

    kpis.type .= type
    kpis.part_of_year_resolution .= tres
    kpis.part_of_year = Int16.(kpis.part_of_year) # wide enough to include e.g. 2020 and -3

    kpis
end

# It's really tempting to multithread this
# DON'T
#
# ClickHouse will run out of memory and cry about it
kpis_table = "pristine.location_kpis_not_cursed" # original KPI table is cursed, do not upload to it directly but instead change rename to it
execute(con(), "drop table if exists $kpis_table sync") # this should usually be commented out so that you get an error if the columns change
# ERROR: InexactError: trunc(UInt8, 2021) # clickhouse doesn't like the year stats, they have to go first
for tres in ["rolling_year", "year", "month", "quarter"] # week works but I don't think anyone cares and it's slow
    for (res,type) in eachrow(loc_h3_stats)
        type in ["lsoa21", "oa21", "county", "ttwa", "msoa21"] && continue # county and ttwa broken
        @info "starting $type $tres"
        # res = 7 # 
        # tres = "rolling_year"
        # type = "fuas"
        #
        # consider grouping by property type
        
        inner_query = "select * from raw.location_h3_indexed where type = '$type' and res = $res"
        # inner_query = "select distinct(h3_9) as h3, h3 as code, h3 as name from pristine.properties_collapsed_test"
        # inner_query = "select arrayJoin([0x087195a10affffff, 0x087195aa21ffffff, 0x087195e0a6ffffff, 0x0871958692ffffff, 0x0871973263ffffff, 0x0871973351ffffff, 0x0871973262ffffff, 0x087197330dffffff, 0x0871973205ffffff, 0x0871973201ffffff]) as h3, h3 as code, h3 as name" # little hack
        # kpis = get_kpis(inner_query, 9, "h3_9", "rolling_year") # 1 million rows for h3_7 vs 30k for fuas; 5 million for h3_9
        kpis = get_kpis(inner_query, res, type, tres)
        # test_h3s = [0x087195a10affffff, 0x087195aa21ffffff, 0x087195e0a6ffffff, 0x0871958692ffffff, 0x0871973263ffffff, 0x0871973351ffffff, 0x0871973262ffffff, 0x087197330dffffff, 0x0871973205ffffff, 0x0871973201ffffff]
        # select_df(con(), "select median(price), h3_7 from pristine.properties_collapsed_test where h3_7 in $(string(test_h3s)[7:end]) group by h3_7") # 7:end cuts out UInt64 # basically instant
        # kpis = get_kpis(string(test_h3s)[7:end], 7, "h3_7", "rolling_year") # takes ~3 seconds for 1000 h3s (before table optimisation). after optimisation ... 3 seconds. so probably too slow, better to instead stick them all on the database

        kpis.date_calculated .= Dates.now()

        # ugly _change_yoy hack for rolling_year
        if tres == "rolling_year"
            for k in KEYS_FOR_CHANGES
                kpis[!, Symbol(k*"_change_yoy")] = kpis[!, Symbol(k*"_change")]
            end
        end

        # any(name) String wtf?
        # if we're unlucky we'll miss some nullable stuff here
        # workaround: do not be unlucky
        execute(con(), """
        CREATE TABLE IF NOT EXISTS $kpis_table
        $(tablespec(sort(enumerate(chtypes(kpis))|>collect, by=x->x[2][1]) .|> x->x[2])) -- sort column names
        ENGINE = MergeTree()
        ORDER BY (year, part_of_year, channel, code) 
        """)
        @info "uploading $type"
        insert(con(), "$kpis_table",[df2dict(kpis)]) 
        @info "finished $type"
    end
end

# h3s
inner_query = "select distinct(h3_7) as h3, h3 as code, h3 as name from pristine.properties_collapsed_test"
kpis = get_kpis(inner_query, 7, "h3_7", "rolling_year") # 1 million rows for h3_7 vs 30k for fuas; 5 million for h3_7
kpis.date_calculated .= Dates.now()
kpis.code = string.(kpis.code, base=16)
kpis.name = string.(kpis.name, base=16)
kpis_table = "pristine.location_kpis_not_cursed" # original KPI table is cursed, do not upload to it directly but instead change rename to it
insert(con(), "pristine.location_kpis_not_cursed",[df2dict(kpis)]) 


inner_query = "select distinct(h3_9) as h3, h3 as code, h3 as name from pristine.properties_collapsed_test"
kpis = get_kpis(inner_query, 9, "h3_9", "rolling_year") # 1 million rows for h3_7 vs 30k for fuas; 5 million for h3_9
kpis.date_calculated .= Dates.now()
kpis.code = string.(kpis.code, base=16)
kpis.name = string.(kpis.name, base=16)
insert(con(), "$kpis_table",[df2dict(kpis)]) 
execute(con(), "drop table if exists pristine.location_kpis sync") # this should usually be commented out so that you get an error if the columns change
execute(con(), "RENAME $kpis_table TO pristine.location_kpis")

# drop in for k-ring kpis
tres = "year"
type = "user_range"
res = 11
#rangestr = "arrayMap(x->toUInt64(round(pow(1.7,x))), range(0,15+1))" # don't need a +1 -1 hack because there's no zero
rangestr = "arrayMap(x->toUInt64(round(pow(1.7,x))), range(0,13+1))" # don't need a +1 -1 hack because there's no zero
# range 1.7^15 gets kind of slow (~3000); maybe it would be better to look at h3_9 instead?

# TODO: POLISH THIS
# but basically it's done?
h3_to_check = "626444984270835711" # 626445768346591231 # manchester # 626446299264925695 # bournemouth
inner_query = """
        select x.1 as code, 'user_range' as name, 'user_range' as type, arrayJoin(x.2) as h3 from (select arrayJoin(arrayZip($rangestr, arrayMap(x -> h3kRing($h3_to_check, x), $rangestr))) as x) -- manchester
"""
kpis = get_kpis(inner_query, res, type, tres) # you can do yearly if u want
kpis = kpis[kpis.code .> 0, :] # bin nonsense ranges
kpis.distance_km .= kpis.code .* select_df(con(), "select h3EdgeLengthKm($res)*2 as diameter_km")[1, :diameter_km]
kpis[(kpis.bedrooms .== 3) .&& (kpis.channel .== "LREW_BUY") .&& (kpis.nsales .>= 5), [:bedrooms, :distance_km, :price, :year, :part_of_year, :nsales, :nsales_total_value]]
kpis

# rule of thumb: want 5 on each side of each percentile, so for median, we want 10, for quartile we want 40, for decile we want 100
kpis[(kpis.bedrooms .== -1) .&& (kpis.channel .== "RES_BUY") .&& (kpis.nsales .>= 40), [:bedrooms, :distance_km, :price, :price_percentile_25, :year, :part_of_year, :nsales]]

# need to find the best k ring size
k = sort(combine(groupby(kpis, [:code, :channel, :bedrooms]), :nlisted => headinsand(median) => :mlisted), [:channel, :code, :bedrooms])
dropmissing!(k)
combine(groupby(k[k.mlisted .> 30, :], [:channel, :bedrooms]), row -> first(row))

# channel types -> 
# copy bid/ask/clear from stock markets: bid = what someone wants to pay; ask = what someone is willing to sell at; clear = what something actually sold for
# ask_let, ask_buy, ask_hmo (rm)
# clear_buy (lr)?
#
# todo: need to add total volume, sum(price) for all channels

# the location ring stuff: want all channels exactly like the database, only change is that it's for one location; fixed bedroom and property type

# at the moment, dividing by studio let price, but really for rent-to-hmo we need hmo room let price
# some are listed as hmos
plot()
area = "London"
beds = select_df(con(), "select median(nsales), median(price), median(price_per_sqm) as psqm, median(price/(bedrooms+1)) as pbed, bedrooms, channel from pristine.test_table_please_ignore ttpi where name = '$area' and bedrooms < 7 and bedrooms > -1 and channel = 'RES_LET' group by bedrooms, channel order by channel, bedrooms")
stu = select_df(con(), "select median(nsales), median(price), median(price_per_sqm) as psqm, median(price/(bedrooms+1)) as pbed, bedrooms, channel from pristine.test_table_please_ignore ttpi where name = '$area' and bedrooms < 7 and bedrooms > -1 and channel = 'STU_LET' group by bedrooms, channel order by channel, bedrooms")
buys = select_df(con(), "select median(nsales), median(price), median(price_per_sqm) as psqm, median(price/(bedrooms+1)) as pbed, bedrooms, channel from pristine.test_table_please_ignore ttpi where name = '$area' and bedrooms < 7 and bedrooms > -1 and channel = 'RES_BUY' group by bedrooms, channel order by channel, bedrooms")
#plot!( beds.bedrooms, beds.psqm./beds.psqm[1], label="$area per sqm")
# plot!( beds.bedrooms, 10 .* 12 .* beds.pbed./buys.pbed, label="$area yield buy-to-rent")
# plot!( beds.bedrooms, 10 .*12 .* beds.pbed[1] ./buys.pbed, label="$area yield buy-to-hmo")
plot!( beds.bedrooms, stu.pbed[1]./beds.pbed, label="$area yield rent-to-hmo")
beds_lr = select_df(con(), "select median(nsales) as ns, median(price), median(price_per_sqm) as psqm, channel, makeDate(year, month, 1) as date from pristine.test_table_please_ignore ttpi where name = '$area' and bedrooms = -1 and channel = 'LREW_BUY' group by bedrooms, channel, year, month order by date")
beds_rm = select_df(con(), "select median(nsales) as ns, median(price), median(price_per_sqm) as psqm, channel, makeDate(year, month, 1) as date from pristine.test_table_please_ignore ttpi where name = '$area' and bedrooms = -1 and channel = 'RES_BUY' group by bedrooms, channel, year, month order by date")
plot!( beds_lr.date, beds_lr.ns, label="$area lr")
plot!( beds_rm.date, beds_rm.ns, label="$area rm") # looks fine?
#plot!( buys.bedrooms, buys.pbed./buys.pbed[1], label="Buy: $area per bed")
#
#in data cleaning: need to take property_subtype field over to new table
#can classify HMOs by property_subtype, only top 1% is nonsense of mislisted properties
# for HMOs:
# House Share
# Flat Share
# House of Multiple Occupation

# lr stuff

# julia> select_df(con(), "select distinct name from raw.location_h3_indexed where
#  type = 'fuas'")
sort!(dropmissing(combine(groupby(exits[(exits.channel .== "RES_BUY") .&& (exits.name .== "England"), :], [:bedrooms, :code]), :ttc => headinsand(median), :ncleared => median)), [:bedrooms, :code])

# leaderboard for time to clear (actual sale)
beds = select_df(con(), "select name, median(if(ttc > 0, ttc, null)) as ttc, bedrooms from pristine.test_table_please_ignore ttpi where type = 'ttwa' and bedrooms < 7 and bedrooms > -1 and channel = 'RES_BUY' group by bedrooms, name order by (bedrooms, ttc)")

print(beds)

exits = select_df(con(), "select * from pristine.test_table_please_ignore ttpi where type = 'fuas' and bedrooms = -1")

sort(exits[(exits.channel .== "LREW_BUY") .&& (exits.bedrooms .== -1) .&& (exits.name .== "Portsmouth"), :], [:year, :month]) # there's not enough data here compared to https://otta.property
(exits[(exits.channel .== "LREW_BUY") .&& (exits.bedrooms .== -1) .&& (exits.name .== "Portsmouth"), :nsales] .|> Int32) |> sum  # still a factor of 10 out >:(

sort(exits[(exits.channel .== "LREW_BUY") .&& (exits.bedrooms .== -1) .&& (exits.name .== "London"), :], [:year, :month]) # there's not enough data here compared to https://otta.property

# NB!!!! h3kRing isn't a ring, it includes all the h3s at radius smaller than it, including its own
# also h3kRing(y,0) == [y]
#
channel = "RES_BUY"
#ks2test = Int.(round.(1.7 .^(1:10)))
# h3kRing stuff
k = reduce(vcat,ThreadsX.map(x -> select_df(con(), """
    select median(count) as median_monthly_count, $x as radius from (
        select count(*) as count from pristine.properties_collapsed_test where h3_11 in h3kRing(626446299264925695, $x) and channel = '$channel' group by month, year
    )
"""), 1:max_range))

max_range = 300 # 1000 makes clickhouse sad
select_df(con(), """
    -- select median(count) as median_monthly_count, radius from (
    select count(*) as count, median(price), range_tmp - 1 as radius, year, month from pristine.properties_collapsed_test pct
        left join (
            select x.1 as range_tmp, arrayJoin(x.2) as h3_ring from (select arrayJoin(arrayZip(range(0+1,$max_range+2), arrayMap(x -> h3kRing(626446299264925695, x), range(0,$max_range+1)))) as x)
        ) h3rings on pct.h3_11 = h3rings.h3_ring
        where channel = 'RES_BUY'
        group by range_tmp, year, month
        having range_tmp > 0 -- 0 is default, i.e. nonsense
        order by radius, year, month
    -- ) group by radius
    -- order by radius
""")

select_df(con(), "select arrayJoin(h3kRing(626446299264925695, 5)) as as h3_11")



# location ring stuff continued:
#
# code re-use sketch:
#
# kpi(inner_query) -> kpi table
#
# for database, upload straight to DB
#
# for k-rings, pick best radius, only keep that, and return via web interface


# may 2nd priorities
#
# finalise column names / interface
#
# work on rings
#
# grouping by bedrooms & property type (and not)
# 
# maybe automate
area = "England"
beds = select_df(con(), "select median(nsales), median(price), median(price_per_sqm) as psqm, median(price/(bedrooms+1)) as pbed, median(tim), bedrooms, channel, year, month from pristine.test_table_please_ignore ttpi where name = '$area' and bedrooms = -1 and channel = 'RES_LET' group by bedrooms, channel, year, month order by channel, bedrooms, year, month")
beds = select_df(con(), "select nsales, price, price_per_sqm as psqm, tim, bedrooms, channel, year, month from pristine.test_table_please_ignore ttpi where name = '$area' and bedrooms = -1 and channel = 'RES_LET' order by channel, bedrooms, year, month")

# if we do > 0 for time we somehow get median tim as 44 for res_let which is bonkers
# also nsales/nlisted are very very low for feb/mar compared to all other previous months
kpis[(kpis.name .== "England") .&& (kpis.channel .== "RES_LET") .&& (kpis.bedrooms .== -1), [:year, :month, :price, :nsales, :nlisted, :tim]]

using StatsPlots
plot()
tres = "quarter"
bedrooms = 3
name = "London"
type = "ttwa"
kpis = select_df(con(), "select price, year, part_of_year as $tres from pristine.test_table_please_ignore where part_of_year_resolution = '$tres' and name = '$name' and channel = 'RES_LET' and bedrooms = $bedrooms and type = '$type' order by year, part_of_year")
# plot(kpis.quarter .+ (kpis.year .- 2021) .* 4, round.(kpis.price, sigdigits=3))
# plot(kpis.month .+ (kpis.year .- 2021) .* 12, round.(kpis.price, sigdigits=3))
# plot(kpis.week .+ (kpis.year .- 2021) .* 52, round.(kpis.price, sigdigits=3))
kpis2 = select_df(con(), "select price, year, part_of_year as $tres from pristine.test_table_please_ignore where part_of_year_resolution = '$tres' and name = '$name' and channel = 'RES_BUY' and bedrooms = $bedrooms and type = '$type' order by year, part_of_year")
# plot!(kpis2.quarter .+ (kpis2.year .- 2021) .* 4, round.(kpis2.price, sigdigits=3))
# plot!(kpis2.month .+ (kpis2.year .- 2021) .* 12, round.(kpis2.price, sigdigits=3))
# plot!(kpis2.week .+ (kpis2.year .- 2021) .* 52, round.(kpis2.price, sigdigits=3))

# plot(kpis.quarter .+ (kpis.year .- 2021) .* 4, round.(kpis.price./kpis2.price, sigdigits=3))
# plot(kpis.month .+ (kpis.year .- 2021) .* 12, round.(kpis.price./kpis2.price, sigdigits=3))
# plot(kpis.week .+ (kpis.year .- 2021) .* 52, round.(kpis.price./kpis2.price, sigdigits=3), label=name)
leftjoin!(kpis, kpis2[!, [:year, Symbol(tres), :price]], on=[:year, Symbol(tres)], makeunique=true)
dropmissing!(kpis)
plot!(kpis.week .+ (kpis.year .- 2021) .* 52, round.(kpis.price./kpis.price_1, sigdigits=3), label="$name $bedrooms beds")
plot!(kpis.quarter .+ (kpis.year .- 2021) .* 4, round.(kpis.price./kpis.price_1, sigdigits=3), label="$name $bedrooms beds")


# yields seem to be higher for LREW_BUY vs RES_BUY -> probably because LREW_BUY prices are ~180 days "out of date" (sales close 180 days after RM listing. approx)


# ecological fallacy in manchester, maybe: 1 beds for rent are in fancy towers and are not for sale. 1 beds for sale are ... not as nice? maybe


# instead should compare rent with modelled price of property

@time pc = select_df(con(), "select distinct(postcode) from pristine.properties_collapsed_test")
import CSV
CSV.write("postcode.csv", pc)

select_df(con(), "select avg(if(bathrooms > 0, 1, 0)) from pristine.properties_collapsed_test where channel = 'RES_BUY'")
select_df(con(), "select avg(if(property_type = '' or bathrooms < 1, 1, 0)) from pristine.properties_collapsed_test where channel = 'RES_BUY'")
select_df(con(), "select avg(if(property_type = '', 1, 0)) from pristine.properties_collapsed_test where channel = 'RES_BUY'")
select_df(con(), "select avg(if(bathrooms > 0, 1, 0)) from raw.rm_listing_events where channel = 'RES_BUY'")
select_df(con(), "select avg(if(number_habitable_rooms > 0, 1, 0)) from raw.epc_data_england")
select_df(con(), "select avg(if(uprn == 0, 1, 0)) from pristine.properties_collapsed_test where channel = 'RES_BUY'")

using VegaLite, JSON, XLSX

df = select_df(con(), "select median(price) as price, bedrooms, name from pristine.location_kpis where channel = 'RES_LET' and part_of_year_resolution = 'month' and type = 'ttwa' and name in ('London', 'Manchester', 'Bristol') group by bedrooms, name")

k = df[(0 .<= df.bedrooms .<= 5), :] |> @vlplot(:line, x=:price, y=:bedrooms, color=:name)

l = VegaLite.Vega.getparams(k)
JSON.json(l, 2) |> clipboard # somehow the axis goes upside down and the numbers aren't rounded...

s = XLSX.readxlsx("household_income_msoa_2020.xlsx") # from https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/earningsandworkinghours/datasets/smallareaincomeestimatesformiddlelayersuperoutputareasenglandandwales 2020 dataset
incomes_messy = DataFrame(XLSX.gettable(s["Net income before housing costs"], first_row = 5)) # get first row with your eyes
incomes = incomes_messy[!, Symbol.(["MSOA code", "Net annual income before housing costs (£)"])]
rename!(incomes, Symbol("MSOA code") => :code, Symbol("Net annual income before housing costs (£)") => :income)
incomes.type .= "msoa21"
incomes.year .= 2021
incomes

df = select_df(con(), "select lk.*,  from (select median(price) as price, bedrooms, name, code from pristine.location_kpis where channel = 'RES_LET' and part_of_year_resolution = 'month' and type = 'msoa21' group by bedrooms, name, code) lk left join (select distinct(code), h3 from raw.location_h3_indexed where res = 11) mh on lk.code = mh.code limit 10") # this is not remotely what was actually running

msoa_locs = select_df(con(), "select lh.* from (select distinct on (code) code, untuple(h3ToGeo(h3)) as p from raw.location_h3 where h3GetResolution(h3) = 11) lh left join raw.location_meta lm on lm.code = lh.code where lm.type = 'msoa21'")
rename!(msoa_locs, Symbol("p.latitude") => :latitude, Symbol("p.longitude") => :longitude)

df = leftjoin(df, incomes[!, [:code, :income]], on=:code)
df = leftjoin(df, msoa_locs, on=:code)

df.ratio = 12 .*df.price ./ df.income
df.bad = df.ratio .> 0.3
dfs = dropmissing(df[df.bedrooms .== -1, :])
dfs.badness = map(x-> x < 0.3 ? "ok" : x < 0.45 ? "unaffordable" : "extreme stress", dfs.ratio)
sort!(dfs,:ratio, rev=:true)
median(dfs.ratio)
mean(dfs.ratio .> 0.30)

dfs |> @vlplot(
    :circle,
    width=1000,
    height=1000,
    longitude=:longitude,
    latitude=:latitude,
    color={:ratio, scale={domainMid=0.3, scheme=:redblue}},
    # opacity={:ratio, scale={domainMid=0.3, scheme=:redblue}},
    size=:ratio,
    tooltip=[:name, :ratio],
)

dfs |> @vlplot(
    :circle,
    width=1000,
    height=1000,
    longitude=:longitude,
    latitude=:latitude,
    color={:bad, scale={domainMid=0.5, scheme=:redblue, reverse=true}},
    # opacity={:ratio, scale={domainMid=0.3, scheme=:redblue}},
    size=:ratio,
    tooltip=[:name, :ratio],
)

land_10m = readlines("land-10m.json") |> join

@vlplot(
    width=1350,
    height=1350,
    layer = [{
        mark={:geoshape, fill=:none, stroke=:black},
        data={values=land_10m, format={type=:topojson, feature=:land}},
        projection={
            type=:mercator,
            scale=1600*2,
            translate=[1200,4500],
        },
    }, {
        mark={:circle, opacity=0.2},
        data=dfs,
        projection={
            type=:mercator,
            scale=1600*2,
            translate=[1200,4500],
        },
        longitude=:longitude,
        latitude=:latitude,
        color={:badness, scale={range=["red", "green", "darkorange"]}},
        tooltip=[:name, :badness, :ratio],
    }]
)

## for cat


land_10m = readlines("land-10m.json") |> join
msoa_locs = select_df(con(), "select lh.* from (select distinct on (code) code, untuple(h3ToGeo(h3)) as p from raw.location_h3 where h3GetResolution(h3) = 11) lh left join raw.location_meta lm on lm.code = lh.code where lm.type = 'district'")
rename!(msoa_locs, Symbol("p.latitude") => :latitude, Symbol("p.longitude") => :longitude)

df = select_df(con(), "select median(price) as price, bedrooms, code, name, sum(price_sample_size) as price_sample_size from pristine.location_kpis where channel = 'RES_LET' and type = 'district' and part_of_year_resolution = 'year' and part_of_year = 2024 group by bedrooms, code, name")
df = leftjoin(df, msoa_locs, on=:code)
df.ratio = 12 .*df.price ./ 28_000
df.bad = df.ratio .> 0.3
dfs = dropmissing(df[(df.bedrooms .== 1) .&& (df.price_sample_size .> 100), :])
dfs.badness = map(x-> x < 0.3 ? "ok" : x < 0.45 ? "unaffordable" : "extreme stress", dfs.ratio)
sort!(dfs,:ratio, rev=:true)
median(dfs.ratio)
mean(dfs.ratio .> 0.30)


@vlplot(
    width=1350,
    height=1350,
    layer = [{
        mark={:geoshape, fill=:none, stroke=:black},
        data={values=land_10m, format={type=:topojson, feature=:land}},
        projection={
            type=:mercator,
            scale=1600*2,
            translate=[1200,4500],
        },
    }, {
        mark={:circle, opacity=0.7, size=150},
        data=dfs,
        projection={
            type=:mercator,
            scale=1600*2,
            translate=[1200,4500],
        },
        longitude=:longitude,
        latitude=:latitude,
        color={:badness, scale={range=["red", "green", "darkorange"]}},
        tooltip=[:name, :badness, :ratio],
    }]
)

#julia> df[df.name .== "Tower Hamlets", :]
# this is saying tower hamlets is cheap, which could be true, but only for flat shares ... which shouldn't show up in our data, right? are they mislabelled? i don't see them on properties_collapsed_test


df = select_df(con(), "select price, price_percentile_10, price_percentile_90, entry_to_agreed_days, name, code, date_start, bedrooms, price_sample_size from pristine.location_kpis where type = 'country' and part_of_year_resolution = 'month' and channel = 'RES_BUY' and date_end < '2024-05-01' and date_start > '2023-07-30' order by year, part_of_year")

df = combine(groupby(df, [:name, :code, :bedrooms]), g -> begin
        g.price_percentile_10n .= g.price_percentile_10 ./ g.price_percentile_10[1]
        g.price_percentile_90n .= g.price_percentile_90 ./ g.price_percentile_90[1]
        return g
end)

# df2 = stack(df, [:price_percentile_90n, :price_percentile_10n]) # variable, value column

# dropmissing(df2[(df2.name .== "United Kingdom") .& (df2.bedrooms .== -1), :]) |> @vlplot(
#     width=300,
#     height=300,
#     :line,
#     y=:value,
#     x=:date_start,
#     tooltip=[:date_start, :value],
#     color=:variable,
# )

## take home: vega is kind of annoying? ... maybe plotly is better

using Plots, Plots.Measures # also need PlotlyBase ... wait, i think that's a lie, plotly() works fine without it
plotly()

df3 = df[(df.bedrooms .== -1), :]
pme(name, percentile) = plot!(df3[df3.name.==name, :date_start], df3[df3.name.==name, Symbol("price_percentile_$(percentile)n")], label="$name $percentile")
pme("London", 90)
pme("London", 10)
pme("Manchester", 10)
pme("Manchester", 90)
pme("United Kingdom", 10)
plot!(df3.date_start, df3.price_percentile_10n)

df3 = df[(df.bedrooms .== -1), :]
pme(percentile, label) = plot!(df3[df3.name.=="United Kingdom", :date_start], df3[df3.name.=="United Kingdom", Symbol("price_percentile_$(percentile)n")].*100, label=label; ylabel="Asking prices, rebased (Aug '23 = 100)", title="Propexum: UK residential asking price trends")
plot(;legend=:topleft, margin=5Plots.mm)
pme(90, "Prime (90th percentile)")
pme(10, "Sub-prime (10th percentile)")
histogram(rand(df.price,100))

using CSV
h3s = select_df(con(), "select h3_9 as index_int, median(price/bedrooms) as value from (select * from pristine.properties_collapsed_test where channel = 'RES_LET' and bedrooms < 3 and date > '2023-12-30') group by h3_9 having count(*) > 5")
h3s.index = string.(h3s.index_int, base=16)

CSV.write("test_h3.csv", h3s[!, [:index, :value]])


# todo: make groupby h3 kpis

using Plots

# rental yield vs capital growth
cap = select_df(con(), "select median(price/(price-price_change_yoy)) as capital_growth, code, median(price) as price_t from pristine.location_kpis where channel = 'RES_BUY' and type = 'msoa21' group by code")
lets = select_df(con(), "select median(price) as let_price, code from pristine.location_kpis where channel = 'RES_LET' and type = 'msoa21' group by code")

df = leftjoin(cap, lets, on=:code)
dropmissing!(df)
df.rental_yield = (df.let_price ./ df.price_t) .* 12

plot(;margin=5Plots.mm)
scatter!(df.capital_growth .- 1, df.rental_yield, ylims=[0,0.1], xlims=[-0.1, 0.1]; xlabel = "Yearly capital appreciation", ylabel = "Rental yield", legend=:none, markersize=0.1)

cor(df.rental_yield, df.capital_growth)







# reprojecting msoa data to h3 at resolution 5

loc_h3 = select_df(con(), "select distinct h3_5, code, h3ToParent(h3, 5) as h3_5, untuple(h3ToGeo(h3_5)) as p from raw.location_h3_indexed where res = 9 and type = 'msoa21'")


using XLSX, CSV

s = XLSX.readxlsx("household_income_msoa_2020.xlsx") # from https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/earningsandworkinghours/datasets/smallareaincomeestimatesformiddlelayersuperoutputareasenglandandwales 2020 dataset
incomes_messy = DataFrame(XLSX.gettable(s["Net income before housing costs"], first_row = 5)) # get first row with your eyes
incomes = incomes_messy[!, Symbol.(["MSOA code", "Net annual income before housing costs (£)"])]
rename!(incomes, Symbol("MSOA code") => :code, Symbol("Net annual income before housing costs (£)") => :income)
incomes.type .= "msoa21"
incomes.year .= 2021 # annual income
incomes

incomes_h3 = leftjoin(loc_h3, incomes, on=:code)
dropmissing!(incomes_h3)

df = select_df(con(), "select median(price) as price, h3ToParent(h3_9, 5) as index_int from pristine.properties_collapsed_test where channel = 'LREW_BUY' and date > '2021-01-01' group by index_int")
df.index = string.(df.index_int, base=16)
df = leftjoin(df, incomes_h3, on=:index_int=>:h3_5)
dropmissing!(df)

df.value = df.price ./ df.income


CSV.write("test_h3_5.csv", df[!, [:index, :value, Symbol("p.latitude"), Symbol("p.longitude")]])




loc_h3 = select_df(con(), "select distinct h3_7, code, h3ToParent(h3, 7) as h3_7, untuple(h3ToGeo(h3_7)) as p from raw.location_h3_indexed where res = 9 and type = 'msoa21'")


using XLSX, CSV

s = XLSX.readxlsx("household_income_msoa_2020.xlsx") # from https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/earningsandworkinghours/datasets/smallareaincomeestimatesformiddlelayersuperoutputareasenglandandwales 2020 dataset
incomes_messy = DataFrame(XLSX.gettable(s["Net income before housing costs"], first_row = 5)) # get first row with your eyes
incomes = incomes_messy[!, Symbol.(["MSOA code", "Net annual income before housing costs (£)"])]
rename!(incomes, Symbol("MSOA code") => :code, Symbol("Net annual income before housing costs (£)") => :income)
incomes.type .= "msoa21"
incomes.year .= 2021 # annual income
incomes

incomes_h3 = leftjoin(loc_h3, incomes, on=:code)
dropmissing!(incomes_h3)

df = select_df(con(), "select median(price)*12 as price, h3ToParent(h3_9, 7) as index_int from pristine.properties_collapsed_test where channel = 'RES_LET' and date > '2021-01-01' group by index_int having count(*) > 10")
df.index = string.(df.index_int, base=16)
df = leftjoin(df, incomes_h3, on=:index_int=>:h3_7)
dropmissing!(df)

df.value = ((df.price ./ df.income) .> 0.3) .|> Float64


CSV.write("test_h3_7.csv", df[!, [:index, :value, Symbol("p.latitude"), Symbol("p.longitude")]])

using CSV
df = select_df(con(), "select median(if(time_in_market > 0, time_in_market, null)) as value, h3ToParent(h3_9, 4) as index_int from properties_collapsed where channel = 'RES_LET' and date > '2021-01-01' group by index_int having count(*) > 10")
df.index = string.(df.index_int, base=16)
dropmissing!(df)
#df.value = df.value ./ quantile(df.value, 0.9)

CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value]])

s = XLSX.readxlsx("household_income_msoa_2020.xlsx") # from https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/earningsandworkinghours/datasets/smallareaincomeestimatesformiddlelayersuperoutputareasenglandandwales 2020 dataset
incomes_messy = DataFrame(XLSX.gettable(s["Net income before housing costs"], first_row = 5)) # get first row with your eyes
incomes = incomes_messy[!, Symbol.(["MSOA code", "Net annual income before housing costs (£)"])]
rename!(incomes, Symbol("MSOA code") => :code, Symbol("Net annual income before housing costs (£)") => :income)
incomes.type .= "msoa21"
incomes.year .= 2021 # annual income
incomes

H3_RES = 9 # don't use anything smaller than 9
loc_h3 = select_df(con(), "select distinct index_int, code, h3ToParent(h3, $H3_RES) as index_int, untuple(h3ToGeo(index_int)) as p from raw.location_h3_indexed where res = 9 and type = 'msoa21'")
incomes_h3 = leftjoin(loc_h3, incomes, on=:code)
dropmissing!(incomes_h3)

df = select_df(con(), "select median(price) as value, h3ToParent(h3_9, $H3_RES) as index_int from pristine.properties_collapsed_test where channel = 'LREW_BUY' and date > '2021-01-01' group by index_int having count(*) > 10")
df.index = string.(df.index_int, base=16)
#df = leftjoin(df, incomes_h3, on=:index_int)
dropmissing!(df)

#df.value = df.price ./ df.income
df.value = 1 .- (df.value .- quantile(df.value, 0.05)) ./ quantile(df.value, 0.95) # 0 is bad, cut off top and bottom 5%
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value]])



using CSV
H3_RES = 8 # don't use anything smaller than 9
df = select_df(con(), "select median(if(time_in_market > 0, time_in_market, null)) as value_t, h3ToParent(h3_9, $H3_RES) as index_int from pristine.properties_collapsed_test where channel = 'RES_LET' and date > '2021-01-01' and bedrooms = 1 group by index_int having count(*) > 10")

df.index = string.(df.index_int, base=16)
#df = leftjoin(df, incomes_h3, on=:index_int)
dropmissing!(df)

#df.value = df.price ./ df.income
df.value = 1 .- (df.value_t .- quantile(df.value_t, 0.05)) ./ quantile(df.value_t, 0.95) # 0 is bad (red), cut off top and bottom 5%
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value]])

using PlotlyLight
df_l = select_df(con(), "select code, part_of_year, year, entry_to_agreed_days as let_days from pristine.location_kpis where channel = 'RES_LET' and part_of_year_resolution = 'month' and type = 'ttwa' and bedrooms = 3")
df_b = select_df(con(), "select code, part_of_year, year, entry_to_agreed_days as buy_days from pristine.location_kpis where channel = 'RES_BUY' and part_of_year_resolution = 'month' and type = 'ttwa' and bedrooms = 3")

df = leftjoin(df_l, df_b, on=[:code, :year, :part_of_year])
dropmissing!(df)
df = df[(0 .< df.let_days .< 30) .&& (0 .< df.buy_days .< 100), :]
p = PlotlyLight.plot(x=df.buy_days, y=df.let_days, type="histogram2dcontour"); # https://plotly.com/julia/2d-histogram-contour/
p.layout.xaxis.title = "Days until sale agreed"
# p.layout.nbinsx = 1
# p.layout.nbinsy = 1 # doesn't work
p.layout.yaxis.title = "Days until rental agreed"
p

using Plots
gr()
df_l = select_df(con(), "select code,name, entry_to_agreed_days as let_days, date_start from pristine.location_kpis where channel = 'RES_LET' and part_of_year_resolution = 'year' and type = 'region' and bedrooms = 3 and code != '' and date_start > '2021-12-30'")
df_l.date_start = floor.(df_l.date_start, Quarter)
df_b = select_df(con(), "select code, name, entry_to_agreed_days as buy_days, date_start from pristine.location_kpis where channel = 'RES_BUY' and part_of_year_resolution = 'year' and type = 'region' and bedrooms = 3 and code != '' and date_start > '2021-12-30'")
df_b.date_start = floor.(df_b.date_start, Quarter)

df = leftjoin(df_l, df_b, on=[:code, :name, :date_start])
dropmissing!(df)
df = df[(0 .< df.let_days .< 30) .&& (0 .< df.buy_days .< 100), :]
Plots.plot(df.buy_days, df.let_days, #=series_annotations = text.(year.(df.date_start), :top, 10),=# xlabel="Days until sale agreed", ylabel="Days until rental agreed", legend=:topleft, margin=5Plots.mm, group=df.name, arrow=true)

# less conservative, don't chuck 2021 data away
df_l = select_df(con(), "select code,name, avg(entry_to_agreed_days) as let_days, any(date_start) as date from pristine.location_kpis where channel = 'RES_LET' and part_of_year_resolution = 'month' and type = 'region' and bedrooms = 3 and code != '' and date_start > '2021-05-30' group by year, code, name")
df_l.date = year.(df_l.date)
df_b = select_df(con(), "select code,name, avg(entry_to_agreed_days) as buy_days, any(date_start) as date from pristine.location_kpis where channel = 'RES_BUY' and part_of_year_resolution = 'month' and type = 'region' and bedrooms = 3 and code != '' and date_start > '2021-05-30' group by year, code, name")
df_b.date = year.(df_b.date)

df = leftjoin(df_l, df_b, on=[:code, :name, :date])
sort!(df, :date)
dropmissing!(df)
df = df[(0 .< df.let_days .< 30) .&& (0 .< df.buy_days .< 100), :]
Plots.plot(df.buy_days, df.let_days, #=series_annotations = text.(year.(df.date_start), :top, 10),=# xlabel="Days until sale agreed", ylabel="Days until rental agreed", legend=:topleft, margin=5Plots.mm, group=df.name, arrow=true)




using CSV
H3_RES = 4 # don't use anything smaller than 9
date = "'2020-01-01'"
df_n = select_df(con(), "select count(*) nnew, h3ToParent(h3_9, $H3_RES) as index_int from pristine.properties_collapsed_test where channel = 'RES_NEW' and date > $date and bedrooms = 1 group by index_int")
df_r = select_df(con(), "select count(*) nold, h3ToParent(h3_9, $H3_RES) as index_int from pristine.properties_collapsed_test where channel = 'RES_BUY' and date > $date and bedrooms = 1 group by index_int having nold > 5")
df = outerjoin(df_n, df_r, on=:index_int)
replace!(df.nnew, missing => 0)
dropmissing!(df)
df.value_t = df.nnew ./ (df.nnew + df.nold)
addquantiles!(df, :value_t)

df.index = string.(df.index_int, base=16)
df.value = 1 .- df.value_t_quantile
#df.value = 1 .- (df.value_t_quantile .- quantile(df.value_t_quantile, 0.05)) ./ quantile(df.value_t_quantile, 0.95) # 0 is bad (red), cut off top and bottom 5%
df.value = 1 .- df.value_t
df.value = df.value_t
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value]])



# % of rentals that are HMOs
using CSV
H3_RES = 9 # don't use anything smaller than 9
#df_hmo = select_df(con(), "select count(*) hmo, h3ToParent(h3_9, $H3_RES) as index_int from pristine.properties_collapsed_test where property_subtype in ('House Share', 'House of Multiple Occupation') and date > '2021-01-01' group by index_int having hmo > 5")
df_hmo = select_df(con(), "select count(*) hmo, h3ToParent(h3_9, $H3_RES) as index_int from pristine.properties_collapsed_test where channel = 'STU_LET' or property_subtype in ('House Share', 'House of Multiple Occupation') and date > '2021-01-01' and bedrooms = 1 group by index_int having hmo > 0")
df_all = select_df(con(), "select count(*) allrent, h3ToParent(h3_9, $H3_RES) as index_int from pristine.properties_collapsed_test where channel = 'RES_LET' or channel = 'STU_LET' and date > '2021-01-01' group by index_int")
df = outerjoin(df_hmo, df_all, on=:index_int)
replace!(df.hmo, missing => 0)
dropmissing!(df)
df.value_t = df.hmo ./ df.allrent

df.index = string.(df.index_int, base=16)
df.value = df.value_t
df.value = 1 .- (df.value_t .- quantile(df.value_t, 0.05)) ./ quantile(df.value_t, 0.95) # 0 is bad (red), cut off top and bottom 5%
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value]])

# rental premium for HMOs
# premium seems to have disappeared :(
using CSV
H3_RES = 4 # don't use anything smaller than 9
df_hmo = select_df(con(), "select median(price) hmo, h3ToParent(h3_9, $H3_RES) as index_int from pristine.properties_collapsed_test where property_subtype in ('House Share', 'House of Multiple Occupation') and date > '2021-01-01' and bedrooms <= 1 group by index_int having count(*) > 100")
df_all = select_df(con(), "select median(price/bedrooms) allrent, h3ToParent(h3_9, $H3_RES) as index_int from pristine.properties_collapsed_test where channel = 'RES_LET' and not property_subtype in ('House Share', 'House of Multiple Occupation') and date > '2021-01-01' group by index_int")
df = outerjoin(df_hmo, df_all, on=:index_int)
dropmissing!(df)
df.value_t = df.hmo ./ df.allrent
df = df[-Inf .< df.value_t .< Inf, :]
df.index = string.(df.index_int, base=16)
df.value = 1 .- (df.value_t .- quantile(df.value_t, 0.05)) ./ quantile(df.value_t, 0.95) # 0 is bad (red), cut off top and bottom 5%
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value]])

using CSV
H3_RES = 9 # don't use anything smaller than 9
#df_hmo = select_df(con(), "select count(*) hmo, h3ToParent(h3_9, $H3_RES) as index_int from pristine.properties_collapsed_test where property_subtype in ('House Share', 'House of Multiple Occupation') and date > '2021-01-01' group by index_int having hmo > 5")
df = select_df(con(), "select avg(bedrooms) value_t, h3ToParent(h3_9, $H3_RES) as index_int from pristine.properties_collapsed_test group by index_int")

df.index = string.(df.index_int, base=16)
df.value = 1 .- (df.value_t .- quantile(df.value_t, 0.05)) ./ quantile(df.value_t, 0.95) # 0 is bad (red), cut off top and bottom 5%
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value]])


using Plots
plotly()
df = select_df(con(), "select count(*) as count, toYear(date) year, toMonth(date) month from raw.land_registry_england_wales where date > '2020-01-01'  group by year, month order by year, month")
plot(df.month, df.count, grouping=df.year, color=:turbo, line_z=Date.(df.year, df.month) .|> x -> x.instant.periods.value, linewidth=5, colorbar=false)

df = select_df(con(), "select count(*) as count, toYear(date) year, toMonth(date) week from raw.land_registry_england_wales group by year, week order by year, week")
plot(Date.(df.year, df.week), df.count)


x = rand(100)
y = rand(100)
z = rand(100) # values to map to color gradient

scatter(x, y, z=z, cgrad=:viridis, markersize=6, legend=false)
scatter(x, y, marker_z=z, color=:turbo, markersize=6, legend=false, colorbar=true)

df = select_df(con(), "select publish_date, date from raw.land_registry_england_wales")
df.delay = df.publish_date .- df.date
df.delay_days = round.(df.delay, Day)
histogram(df[df.date .> Date(2020), :delay_days])

H3_RES = 9
df = select_df(con(), "select median(current_energy_efficiency) as value_t, geoToH3(lon, lat, $H3_RES) as index_t from (select uprn, current_energy_efficiency from raw.epc_data_england) epc left join (select uprn, lat, lon from raw.uprn_metadata) um on um.uprn = epc.uprn group by index_t")
df.index = string.(df.index_t, base=16)
df.value = df.value_t ./ 100
addquantiles!(df, :value_t)
df.value = df.value_t_quantile
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value]])


using CSV
df = select_df(con(), "select h3 as hex, code from raw.location_h3_indexed where type = 'fuas' and res = 7") # check county, region, fuas, lsoa21s, msoa21s, oa21s
df = leftjoin(df, combine(groupby(df, :code), x -> (value_t = rand(),)), on=:code)
df.index = string.(df.hex, base=16)
df.value = 1 .- (df.value_t .- quantile(df.value_t, 0.05)) ./ quantile(df.value_t, 0.95) # 0 is bad (red), cut off top and bottom 5%
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value]])



# most new builds per constituency
res = 7
inner_query = "select * from raw.location_h3_indexed where type = 'pcon' and res = $res and code like 'E%' or code like 'W%'" # ideally need to find the intersection between that and england/wales. no, it's easy! just need like E or like W
df = select_df(con(), "select count(*) as nnew, code, name from (select price, h3_$res from pristine.properties_collapsed_test where channel = 'RES_NEW' and toYear(date) = 2023) pc left outer join ($inner_query) lm on pc.h3_$res = lm.h3 group by code, name")
df = df[startswith.(df.code, 'E') .|| startswith.(df.code, 'W'), :]

using Plots
# would be cool to see if number of new builds correlates with price change
res = 9
channel = "RES_BUY"
df_old = select_df(con(), "select price_t, psqm, runningDifference(psqm) psqm_yoy, hex, nold, runningDifference(price_t) yoy, year from (select median(price) price_t, median(if(price_per_sqm > 0, price_per_sqm, null)) psqm, count(*) as nold, h3ToParent(h3_11, $res) as hex, toYear(date) as year from pristine.properties_collapsed_test where channel = '$channel' group by all order by hex, year asc)")
df_old = combine(groupby(df_old, :hex), group -> group[2:end, :]) # bin first year because nonsense
dropmissing!(df_old)
df_new = select_df(con(), "select count(*) nnew, h3ToParent(h3_11, $res) as hex, toYear(date) as year from pristine.properties_collapsed_test where channel = 'RES_NEW' group by all order by hex, year asc")
df = leftjoin(df_old, df_new, on=[:hex, :year])
df = df[df.year .< 2024, :]
replace!(df.nnew, missing => 0)
df.nnew_perc = df.nnew ./ (df.nold .+ df.nnew)
df = df[df.nnew .> 0, :] # exclude zero new builds
df = df[df.price_t .> 0, :] # drop 0, how are these even getting in
#df.yoy_perc = df.yoy ./ (df.price_t .- df.yoy)
df.yoy_perc = df.psqm_yoy ./ (df.psqm .- df.psqm_yoy)
addquantiles!(df, :yoy_perc)
addquantiles!(df, :nnew_perc)
cor(df.yoy_perc, df.nnew_perc)

using Plots
ticks = 0.1:0.2:0.9
yoys = map(x -> round(quantile(df.yoy_perc, x)*100, sigdigits=1)|>Int, ticks)
nnews = map(x -> round(quantile(df.nnew_perc, x)*100, sigdigits=1)|>Int, ticks)
histogram2d(df.nnew_perc_quantile,df.yoy_perc_quantile,xlims=(0,1), ylims=(0,1), markersize=0.1,xlabel="% listings that are new builds", ylabel="% increase in listing price/sqm of existing properties", xticks=(ticks,nnews), yticks=(ticks, yoys))


using CSV
res = 9
cap = select_df(con(), "select median(price) as price_t, h3ToParent(h3_11, $res) as hex from pristine.properties_collapsed_test where channel = 'RES_BUY' and bedrooms = 3 and date > 2022 group by all")
lets = select_df(con(), "select median(price) as let_price, h3ToParent(h3_11, $res) as hex from pristine.properties_collapsed_test where channel = 'RES_LET' and bedrooms = 3 and date > 2022 group by all")
df = leftjoin(cap, lets, on=:hex)
dropmissing!(df)
df = df[(df.let_price .> 0) .&& (df.price_t .> 0), :]
df.yield = df.let_price./df.price_t .* 12
df.index = string.(df.hex, base=16)
df.value = df.let_price
addquantiles!(df, :let_price)
addquantiles!(df, :yield)
df.value = df.yield_quantile
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value]])


# for khalil
#
# "high rental yield within commute distance of london"
using CSV
res = 7
inner_query = "select * from raw.location_h3_indexed where type = 'fuas' and name = 'London' and res = $res" # ideally need to find the intersection between that and england/wales. no, it's easy! just need like E or like W
# UK001FSC0  / FS00 for inc commuting
df = select_df(con(), inner_query)
# honestly this is such a great hack
sort!(df, :code) # FSC, i.e. core, appears at the bottom of the list
df = df[.!nonunique(df, :h3, keep=:last) .&& (df.code .== "UK001FS00"), :] # drop all FS00 that are repeated in FSC0 and then only show the FS00
commuter_belt = df[.!nonunique(df, :h3, keep=:last) .&& (df.code .== "UK001FS00"), :] # drop all FS00 that are repeated in FSC0 and then only show the FS00
df.index = string.(df.h3, base=16)
df.value .= 1
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value]])


commuter_belt = df[.!nonunique(df, :h3, keep=:last) .&& (df.code .== "UK001FS00"), :] # drop all FS00 that are repeated in FSC0 and then only show the FS00
# rental yields
res = 7
min_sample = 10
cap = select_df(con(), "select count(*) as nc, median(price) as price_t, h3ToParent(h3_11, $res) as hex from pristine.properties_collapsed_test where channel = 'RES_BUY' and 2 <= bedrooms <= 3 and date > 2022 group by all having nc > $min_sample")
lets = select_df(con(), "select count(*) as nl, median(price) as let_price, h3ToParent(h3_11, $res) as hex from pristine.properties_collapsed_test where channel = 'RES_LET' and 2 <= bedrooms <= 3 and date > 2022 group by all having nl > $min_sample")
df = leftjoin(cap, lets, on=:hex)
dropmissing!(df)
df = df[(df.let_price .> 0) .&& (df.price_t .> 0), :]
df.yield = df.let_price./df.price_t .* 12
df.index = string.(df.hex, base=16)
#df.value = df.yield
addquantiles!(df, :let_price)
addquantiles!(df, :yield)
df.value = df.yield_quantile
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value]])

df = leftjoin(commuter_belt[!, Not(:value)], df, on=:index)
dropmissing!(df)
addquantiles!(df, :yield)
df.value = df.yield_quantile
df.value = df.yield .* 20
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value]])

# location based instead
using CSV
df = select_df(con(), """
with
commuter_h3s as (select h3 from raw.location_h3_indexed where res = 7 and type = 'fuas' and name = 'London' group by h3 having count(*) = 1),

commuter_locations as (select distinct(code) from raw.location_h3_indexed where type = 'ward' and res = 7 and h3 in commuter_h3s),

sale_price as (select price, code, bedrooms from pristine.location_kpis where code in commuter_locations and part_of_year_resolution = 'year' and part_of_year = 2023 and bedrooms > 1 and bedrooms < 5 and channel = 'LREW_BUY'),

rent_price as (select price, code, name, agreed, bedrooms from pristine.location_kpis where code in commuter_locations and part_of_year_resolution = 'year' and part_of_year = 2023 and bedrooms > 1 and bedrooms < 5 and channel = 'RES_LET' and agreed > 10)

select round(rp.price/sp.price * 12 * 100, 2) yield, rp.price median_rent, sp.price median_price, code, name, agreed, bedrooms from rent_price rp left join sale_price sp on rp.code = sp.code and rp.bedrooms = sp.bedrooms order by yield desc
""")
CSV.write("commuter_london_yields_wards.csv", df[df.yield .< 20, :])
#
# for khalil ends
# execute(con(), "create table raw.location_h3_indexed engine = MergeTree() order by (res, type, code, name, h3) as select * from pristine.location_meta_h3_view")
# execute(con(), "drop table raw.location_h3 settings max_table_size_to_drop = 0")



# fun stuff

# number of houses with solar panels per h3
df = select_df(con(), "select h3 as index, count(*) as thingy from (select uprn, geoToH3(um.lon, um.lat, 7) as h3, photo_supply from raw.epc_data_england epc left join raw.uprn_metadata um on epc.uprn = um.uprn where photo_supply != '0.0' and photo_supply != '') group by h3")
df.index = string.(df.index, base=16)
addquantiles!(df, :thingy)
df.value = df.thingy_quantile
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value, :thingy]])

# number of houses with wind turbines per h3
df = select_df(con(), "select h3 as index, count(*) as thingy from (select uprn, geoToH3(um.lon, um.lat, 7) as h3, wind_turbine_count from raw.epc_data_england epc left join raw.uprn_metadata um on epc.uprn = um.uprn where wind_turbine_count != '0' and wind_turbine_count != '' and wind_turbine_count != '-1') group by h3")
df.index = string.(df.index, base=16)
addquantiles!(df, :thingy)
df.value = df.thingy_quantile
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value, :thingy]])

# this is just a map of where people live -> need to divide by number of dwellings

 
using CSV
df = select_df(con(), "select entry_to_agreed_days_change/(entry_to_agreed_days-entry_to_agreed_days_change) as thingy, name as index from pristine.location_kpis where type = 'h3_7' and part_of_year_resolution = 'rolling_year' and part_of_year = 0 and channel = 'RES_BUY' and bedrooms = 3")
# df = select_df(con(), "select entry_to_agreed_days as thingy, name as index from pristine.location_kpis where type = 'h3_9' and part_of_year_resolution = 'rolling_year' and part_of_year = 0 and channel = 'RES_BUY' and bedrooms = 3")
dropmissing!(df)
addquantiles!(df, :thingy)
df.value = df.thingy_quantile
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value, :thingy]])



using Plots
df = select_df(con(),"select new_entries, part_of_year, year from pristine.location_kpis lk where name = 'Pembrokeshire' and channel = 'RES_BUY' and bedrooms = -1 and part_of_year_resolution = 'month' order by year desc, part_of_year desc")
df = df[df.year .> 2021, :]
df = df[.!((df.year .== 2024) .&& (df.part_of_year .== 9)), :]
sort!(df, [:year, :part_of_year])
transform!(groupby(df, :year), :new_entries => cumsum => :cumsum)
plot(df.part_of_year, df.new_entries, group=df.year, xticks=1:12)

# todo: also return uncertainty
function construction_age_band_wrangler(band)
    function sane(y)
        if 1066 <= y < year(today())
            return y
        end
        return nothing
    end
    matcher = r"England and Wales:\s*(?:(\d{4})(?:\s*-\s*(\d{4})|(?:\s+onwards|\s+before))?|\bbefore\s+(\d{4}))" # 1: start; 2: end, 3:end
    m = match(matcher, band)
    if isnothing(m)
        try
            return parse(Int, band) # need sanity check on all returned really
        catch(e)
            return nothing
        end
    end
    if sum(.!isnothing.(m.captures)) == 1
        !isnothing(m.captures[1]) && return parse(Int, m.captures[1]) # before this date
        !isnothing(m.captures[2]) && return parse(Int, m.captures[2]) # should never be true
        !isnothing(m.captures[3]) && return parse(Int, m.captures[3]) # after this date
    elseif sum(.!isnothing.(m.captures)) == 2
        return Int(floor(mean(parse.(Int, m.captures[1:2]))))
    end
    return nothing
end
df = select_df(con(), "select construction_age_band, geoToH3(lon, lat, 11) as index_t from (select uprn, construction_age_band from raw.epc_data_england where uprn > 0) epc left join (select uprn, lat, lon from raw.uprn_metadata) um on um.uprn = epc.uprn")
df.age = ThreadsX.map(construction_age_band_wrangler, df.construction_age_band)
df.age2 = replace(df.age, nothing => missing)
dropmissing!(df)

dfg = combine(groupby(df, :index_t), :age2 => median => :age)
addquantiles!(dfg, :age)
dfg.index = string.(dfg.index_t, base=16)
dfg.value = dfg.age_quantile

using CSV, JSON
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", dfg[!, [:index, :value, :age]])
# Make legend scale human friendly (optional)
write("$(homedir())/projects/H3-MON/www/data/meta.json", JSON.json(Dict("scale" => Dict(zip([0, 0.2, 0.4, 0.6, 0.8, 1], quantile.(Ref(dfg.age), [0.0001, 0.2, 0.4, 0.6, 0.8, 0.9999]))))))



using Plots
df = select_df(con(),"select price_per_sqm as price, entry_to_agreed_days, name, part_of_year, new_entries from pristine.location_kpis lk where type = 'fuas' and channel = 'RES_BUY' and bedrooms = -1 and part_of_year_resolution = 'rolling_year' and code like '%FSC%'  order by part_of_year")
dropmissing!(df)

# this is interesting, the quantiles show very little correlation, so probably good for categorising

# individuals probably want per-year leaderboards (combine) since they have to deal with reality, government probably wants overrall since they can change country
addquantiles!(df, :price)
addquantiles!(df, :entry_to_agreed_days)
# combine(groupby(df, :part_of_year), d -> addquantiles!(d, :price))
# combine(groupby(df, :part_of_year), d -> addquantiles!(d, :entry_to_agreed_days))
#plot(df.price_quantile, df.entry_to_agreed_days_quantile, series_annotations=text.(df.name, :bottom, 5), markershape=:x, markersize=0.00001, legend=:none, xticks=quantilelabels(df.price), yticks=quantilelabels(df.entry_to_agreed_days), xlabel="Price", ylabel="Time on market", group=df.name, arrow=true)

# get top 1/4 of data and bin ones without enough years, probably!
n_years = combine(groupby(df, :name), nrow).nrow |> median
c = combine(groupby(df, :name), :new_entries => (x->(sum(x)/n_years)) => :new_entries)
dfm = @view df[in.(df.name, Ref(c[c.new_entries .> quantile(c.new_entries, 0.75), :name])), :]
# plot(dfm.price_quantile, dfm.entry_to_agreed_days_quantile, series_annotations=text.(dfm.name, :bottom, 5), markershape=:x, markersize=0.00001, legend=:none,  xlabel="Price", ylabel="Time on market", group=dfm.name, arrow=true)
plot(dfm.price_quantile, dfm.entry_to_agreed_days_quantile, series_annotations=text.(dfm.name, :bottom, 5), markershape=:x, markersize=0.00001, legend=:none, xticks=quantilelabels(dfm.price), yticks=quantilelabels(dfm.entry_to_agreed_days), xlabel="Price", ylabel="Time on market", group=dfm.name, arrow=true)
plot(dfm.price, dfm.entry_to_agreed_days, series_annotations=text.(dfm.name, :bottom, 5), markershape=:x, markersize=0.00001, legend=:none,  xlabel="Price", ylabel="Time on market", group=dfm.name, arrow=true)


# for buy to let want to move from top left in RES_BUY to bottom right in RES_LET -> do cosine similarity with (1,0) -> (0,1) vector

# try swapping price for new entries / population density/population

df = select_df(con(),"select price, entry_to_agreed_days, name, channel from pristine.location_kpis lk where type = 'fuas' and channel in ('RES_BUY', 'RES_LET') and bedrooms = 3 and part_of_year_resolution = 'rolling_year' and part_of_year = 0 and code like '%FSC%' order by channel")
combine(groupby(df, :channel), d -> addquantiles!(d, :price))
combine(groupby(df, :channel), d -> addquantiles!(d, :entry_to_agreed_days))
dropmissing!(df)

# addquantiles!(df, :price)
# addquantiles!(df, :entry_to_agreed_days)
plot(df.price_quantile, df.entry_to_agreed_days_quantile, series_annotations=text.(df.name, :bottom, 5), markershape=:x, markersize=0.00001, legend=:none, xlabel="Price", ylabel="Time on market", group=df.name, arrow=true)



# just 1d for simon
df = select_df(con(),"select price, entry_to_agreed_days, name, channel from pristine.location_kpis lk where type = 'fuas' and channel in ('RES_BUY', 'RES_LET') and bedrooms = 3 and part_of_year_resolution = 'rolling_year' and part_of_year = 0 and code like '%FSC%' order by channel")
df = unstack(df[!, [:name, :entry_to_agreed_days, :channel]], :channel, :entry_to_agreed_days)
addquantiles!(df, :RES_BUY)
addquantiles!(df, :RES_LET)
dropmissing!(df)
scatter(df.RES_BUY_quantile, df.RES_LET_quantile, series_annotations=text.(df.name, :bottom, 5), markershape=:x, markersize=0.00001, legend=:none, xlabel="Time to sell", ylabel="Time to let", xticks=quantilelabels(df.RES_BUY), yticks=quantilelabels(df.RES_LET))




# Graph for homes england -> bottom left = ideal, outside of that = bad for sellers / bad for buyers
df = select_df(con(),"select price_per_sqm as price, entry_to_agreed_days, new_entries, name, part_of_year from pristine.location_kpis lk where type = 'fuas' and channel = 'RES_BUY' and bedrooms = -1 and part_of_year_resolution = 'rolling_year' and code like '%FSC%' and part_of_year = 0 order by part_of_year")
# df = select_df(con(),"select price as price, entry_to_agreed_days, new_entries, name, part_of_year from pristine.location_kpis lk where type = 'district' and channel = 'RES_BUY' and bedrooms = 3 and part_of_year_resolution = 'rolling_year' and part_of_year = 0 order by part_of_year")
dropmissing!(df)

# this is interesting, the quantiles show very little correlation, so probably good for categorising
addquantiles!(df, :price)
addquantiles!(df, :entry_to_agreed_days)
# combine(groupby(df, :part_of_year), d -> addquantiles!(d, :price))
# combine(groupby(df, :part_of_year), d -> addquantiles!(d, :entry_to_agreed_days))
dfm = df#@view df[df.new_entries .> quantile(df.new_entries, 0.75), :]
# dfm = @view df[df.new_entries .> quantile(df.new_entries, 0.75), :]
# dfm = @view df[rand(1:size(df,1),60), :]
plot(dfm.price_quantile, dfm.entry_to_agreed_days_quantile, series_annotations=text.(dfm.name, :bottom, 5), markershape=:x, markersize=0.00001, legend=:none, xticks=quantilelabels(dfm.price), yticks=quantilelabels(dfm.entry_to_agreed_days), xlabel="Price", ylabel="Time on market", group=dfm.name, arrow=true) # quantiles relabelled with original values
#plot(dfm.price, dfm.entry_to_agreed_days, series_annotations=text.(dfm.name, :bottom, 5), markershape=:x, markersize=0.00001, legend=:none, xlabel="Price", ylabel="Time on market", group=dfm.name, arrow=true) # normal scale
#plot(dfm.price_quantile, dfm.entry_to_agreed_days_quantile, series_annotations=text.(dfm.name, :bottom, 5), markershape=:x, markersize=0.00001, legend=:none,  xlabel="Price", ylabel="Time on market", group=dfm.name, arrow=true) # quantiles shown directly

plot(dfm.price_quantile, dfm.entry_to_agreed_days_quantile, series_annotations=text.(dfm.name, :bottom, 5), markershape=:x, markersize=0.00001, legend=:none,  xlabel="Price", ylabel="Time on market", group=dfm.name, arrow=true, 
    xticks=[round.(quantilelabels(df.price, nonlinear=true, n=50)[1], sigdigits=2)...],
    # xticks=[0.1:0.2:0.9...,quantilelabels(df.price, nonlinear=true, n=50)[1]...],
    yticks=[round.(quantilelabels(df.entry_to_agreed_days, nonlinear=true, n=50)[1], sigdigits=2)...],
    # yticks=[0.1:0.2:0.9...,quantilelabels(df.entry_to_agreed_days, nonlinear=true, n=50)[1]...], NB: can't do this! you're adding extra lines in which is misleading
    xformatter=(x->(x*20)%1≈0 ? string(round(quantile(df.price, x), sigdigits=2)) : ""), 
    yformatter=(x->(x*20)%1≈0 ? string(round(quantile(df.entry_to_agreed_days, x), sigdigits=2)) : ""),
    xrotation=30,
    # thickness_scaling=0.5,
) # linear ticks on non-linear scale
# plot(dfm.price_quantile, dfm.entry_to_agreed_days_quantile, series_annotations=text.(dfm.name, :bottom, 5), markershape=:x, markersize=0.00001, legend=:none,  xlabel="Price", ylabel="Time on market", group=dfm.name, arrow=true, xformatter=x -> round(quantile(df.price, x), sigdigits=2), yformatter=x -> quantile(df.entry_to_agreed_days, x)) # don't need quantilelabels for linear
(x->(x*10)%1≈0 ? quantile(df.price, x) : "")(0.1)





# graphs for homes england
using Plots, Plots.Measures
#pgfplotsx() # can't get it working

# res_buy data quality individual properties

# when this is median it is exactly 1 for 2022

# df = select_df(con(), "select avg(clear_price/price) ratio, count(*) n, toYear(clear_date) y, toMonth(clear_date) m from pristine.properties_collapsed_test pct where clear_price > 0 and price > 0 and channel = 'RES_BUY' and time_in_market > 0 group by all order by y desc, m desc")
# plot(df.m, df.ratio, markersize=0.7, group=df.y, markerstrokewidth=0.1)

# don't think we need this
df = select_df(con(), "select median(clear_price) cp, median(price) p, count(*) n, h3_7, toYear(clear_date) y from pristine.properties_collapsed_test pct where clear_price > 0 and price > 0 and channel = 'RES_BUY' and time_in_market > 0 group by all")
scatter(df.cp, df.p, markersize=0.5)#, group=df.y, markerstrokewidth=0.1)
plot!(identity)

# sample quality sales
df = select_df(con(), "select
    price, code, name, part_of_year, channel
    from pristine.location_kpis
    where part_of_year_resolution = 'rolling_year' and type = 'h3_7' and channel in ('RES_BUY', 'LREW_BUY') and name != '' -- and code like '%FSC%'
    and new_entries > 10
    and price > 0
    and bedrooms == -1
    and part_of_year = 0
    order by part_of_year")
# unstack syntax: unstack(df, [grouping keys], value to become column header, value of that column)
df2 = unstack(df[!, [:code, :price, :channel, :part_of_year]], [:code, :part_of_year], :channel, :price)#, combine=first)
dropmissing!(df2)
dfm = @view df2[df2.part_of_year .== 0, :]
scatter(df2.LREW_BUY, df2.RES_BUY, markersize=2,lims=(0,2e6),markercolor=:black, margin=7mm)
plot!(identity, xlabel="Land registry sale median price", ylabel="Propexum median asking price", legend=:none, widen=true)#, series_annotations="y=x")
savefig("~/projects/homes_england_sep2024/asksalescatter.pdf")
cor(df2.LREW_BUY, df2.RES_BUY)

using KernelDensity
plot(kde(df2.LREW_BUY./df2.RES_BUY), legend=:none, xlabel="Ratio of asking price to eventual sale price", ylabel="Probability density ∝ number of areas")
histogram(df2.LREW_BUY./df2.RES_BUY, legend=:none, xlabel="Ratio of asking price to eventual sale price", ylabel="Number of areas")
savefig("~/projects/homes_england_sep2024/asksaleratiohistogram.pdf")


df = select_df(con(), "select price, code, year, part_of_year from pristine.location_kpis where channel = 'RES_LET' and bedrooms = -1 and part_of_year_resolution = 'month' and type = 'region'")
using CSV
dfh = CSV.read("homes_england_sep2024/homelet-rents.csv",DataFrame)
dfh.part_of_year = month.(dfh.date)
dfh.year = year.(dfh.date)
dfh.price = dfh.value
dfm = leftjoin(df, dfh, on=[:code, :year, :part_of_year], renamecols = "_us" => "_them")
dropmissing!(dfm)
scatter(dfm.price_them, dfm.price_us,markersize=2, legend=:none, xlabel="Third party achieved mean rents", ylabel="Propexum median asking rents", lims=(500,2500), markercolor=:black, margin=7mm)
plot!(identity)
savefig("~/projects/homes_england_sep2024/askletscatter.pdf")




dfg = select_df(con(), """
    select
    median(price) price,
    h3_11
    from pristine.properties_collapsed_test where
    h3_7 in (select h3 from raw.location_h3_indexed where res = 7 and type = 'fuas' and code like '%FSC%'  and name = 'West Midlands')
    and channel = 'RES_BUY'
    group by all
""")

addquantiles!(dfg, :price)
dfg.index = string.(dfg.h3_11, base=16)
dfg.value = dfg.price_quantile

using CSV, JSON
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", dfg[!, [:index, :value, :price]])
# Make legend scale human friendly (optional)
write("$(homedir())/projects/H3-MON/www/data/meta.json", JSON.json(Dict("scale" => Dict(zip([0, 0.2, 0.4, 0.6, 0.8, 1], round.(quantile.(Ref(dfg.price), [0.0001, 0.2, 0.4, 0.6, 0.8, 0.9999]), sigdigits=2))))))
# screenshot h3-mon sutton coldfield NE of birmingham via flameshot




dfg = select_df(con(), """
    select
    median(price) price,
    h3_11
    from pristine.properties_collapsed_test where
    h3_7 in (select h3 from raw.location_h3_indexed where res = 7 and type = 'fuas' and code like '%FSC%'  and name = 'West Midlands')
    and channel = 'RES_LET'
    group by all
""")

addquantiles!(dfg, :price)
dfg.index = string.(dfg.h3_11, base=16)
dfg.value = dfg.price_quantile

using CSV, JSON
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", dfg[!, [:index, :value, :price]])
# Make legend scale human friendly (optional)
write("$(homedir())/projects/H3-MON/www/data/meta.json", JSON.json(Dict("scale" => Dict(zip([0, 0.2, 0.4, 0.6, 0.8, 1], round.(quantile.(Ref(dfg.price), [0.0001, 0.2, 0.4, 0.6, 0.8, 0.9999]), sigdigits=2))))))
# screenshot birmingham via flameshot



df = select_df(con(), "select price, part_of_year, year, entry_to_agreed_days from pristine.location_kpis where bedrooms = -1 and channel = 'RES_LET' and part_of_year_resolution = 'month' and type = 'fuas' and code like '%FSC%' and name = 'London' order by year desc, part_of_year desc")
df.date = Date.(df.year, df.part_of_year)
df = df[Date(2022,1) .< df.date .< Date(2024,9), :] # exclude incomplete month
plot(df.date, df.entry_to_agreed_days, xlabel="Month", legend=:none, ylabel="Median days to let, London", xlims=(Date(2021,11), Date(2024,9)))
savefig("~/projects/homes_england_sep2024/londontimetolettime.pdf")

df = select_df(con(), "select avg(property_type = 'Flat') flat_ratio,  geoToH3(lon, lat, 9) as index_t from (select uprn, property_type from raw.epc_data_england where uprn > 0 and epc_type == 'domestic') epc left join (select uprn, lat, lon from raw.uprn_metadata) um on um.uprn = epc.uprn group by all")
dropmissing!(df)

df = df[df.flat_ratio .!== 0.0, :]
addquantiles!(df, :flat_ratio)
df.index = string.(df.index_t, base=16)
df.value = df.flat_ratio_quantile
using CSV, JSON
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value, :flat_ratio]])
# Make legend scale human friendly (optional)
write("$(homedir())/projects/H3-MON/www/data/meta.json", JSON.json(Dict("scale" => Dict(zip([0, 0.2, 0.4, 0.6, 0.8, 1], round.(quantile.(Ref(df.flat_ratio), [0.0001, 0.2, 0.4, 0.6, 0.8, 0.9999]), sigdigits=2))))))
# screenshot birmingham via flameshot


# Graph for homes england -> bottom left = ideal, outside of that = bad for sellers / bad for buyers
df = select_df(con(),"select price_per_sqm as price, entry_to_agreed_days, new_entries, name, part_of_year from pristine.location_kpis lk where type = 'fuas' and channel = 'RES_BUY' and bedrooms = -1 and part_of_year_resolution = 'rolling_year' and code like '%FSC%' and part_of_year = 0 order by part_of_year")
dropmissing!(df)

addquantiles!(df, :price)
addquantiles!(df, :entry_to_agreed_days; jiggle=true)
# combine(groupby(df, :part_of_year), d -> addquantiles!(d, :price))
# combine(groupby(df, :part_of_year), d -> addquantiles!(d, :entry_to_agreed_days))
dfm = df#@view df[df.new_entries .> quantile(df.new_entries, 0.75), :]
# dfm = @view df[df.new_entries .> quantile(df.new_entries, 0.75), :]
# dfm = @view df[rand(1:size(df,1),60), :]
plot(dfm.price_quantile, dfm.entry_to_agreed_days_quantile, series_annotations=text.(dfm.name, :bottom, 5), markershape=:x, markersize=0.00001, legend=:none, xticks=quantilelabels(dfm.price), yticks=quantilelabels(dfm.entry_to_agreed_days), xlabel="Median sale price per sqm", ylabel="Median days on market", group=dfm.name, arrow=true, margin=7mm) # quantiles relabelled with original values
savefig("~/projects/homes_england_sep2024/timeonmarketvsprice.pdf")



# building height
df = select_df(con(), """
    select max(toUInt16(toFloat32(flat_storey_count))) max_storey_count, geoToH3(lon, lat, 10) h3 from raw.epc_location_indexed where flat_storey_count != '' group by all
    -- select max(toUInt16(toFloat32(if(flat_storey_count == '', '2', flat_storey_count)))) max_storey_count, geoToH3(lon, lat, 10) h3 from raw.epc_location_indexed group by all -- assume no data = 2
""")
# addquantiles!(df, :max_storey_count)
df.max_storey_count_quantile = min.(df.max_storey_count ./ 10, 1)
df.index = string.(df.h3, base=16)
df.value = df.max_storey_count_quantile
using CSV, JSON
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value, :max_storey_count]])
# Make legend scale human friendly (optional)
write("$(homedir())/projects/H3-MON/www/data/meta.json", jsonscale(df, :max_storey_count_quantile, :max_storey_count))
# screenshot birmingham via flameshot

# tenure type
df = select_df(con(), "select tenure, geoToH3(lon, lat, 9) h3 from raw.epc_location_indexed where epc_type == 'domestic'")
function tenure_wrangler(tenure_type) # it'd be better really to run this on the server to save bandwidth
    mapping = Dict(
        "Owner-occupied" => :owned,
        "rental (social)" => :social,
        "" => missing,
        "NO DATA!" => missing,
        "Rented (social)" => :social,
        "Not defined - use in the case of a new dwelling for which the intended tenure in not known. It is not to be used for an existing dwelling" => missing,
        "owner-occupied" => :owned,
        "unknown" => missing,
        "rental (private)" => :rented,
        "Rented (private)" => :rented,
    )
    get(mapping, tenure_type, missing)
end
df.tenuresym = ThreadsX.map(tenure_wrangler, df.tenure)
dropmissing!(df)
dfm = combine(groupby(df, :h3), :tenuresym => (ts -> begin
        mean(ts .== :social)
    end) => :pc_social)

dfm.index = string.(dfm.h3, base=16)
addquantiles!(dfm, :pc_social)
dfm.value = dfm.pc_social_quantile
using CSV, JSON
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", dfm[!, [:index, :value, :pc_social]])
# Make legend scale human friendly (optional)
write("$(homedir())/projects/H3-MON/www/data/meta.json", jsonscale(dfm, :pc_social_quantile, :pc_social))


df = select_df(con(), "select corr(price, bedrooms) c, h3ToParent(h3_11,7) h3 from pristine.properties_collapsed_test where channel = 'RES_BUY' and bedrooms > -1 and price > 1 group by all having c < 1 and c > 0")
df.index = string.(df.h3, base=16)
addquantiles!(df, :c)
df.value = df.c_quantile
using CSV, JSON
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value, :c]])
# Make legend scale human friendly (optional)
write("$(homedir())/projects/H3-MON/www/data/meta.json", jsonscale(df, :c_quantile, :c))

select_df(con(), "select description from raw.rm_listing_events limit 1")


# homes england income to how price ratio
using XLSX, CSV

loc_h3 = select_df(con(), "select code, h3 from raw.location_h3_indexed where res = 7 and type = 'msoa21'")
s = XLSX.readxlsx("household_income_msoa_2020.xlsx") # from https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/earningsandworkinghours/datasets/smallareaincomeestimatesformiddlelayersuperoutputareasenglandandwales 2020 dataset
incomes_messy = DataFrame(XLSX.gettable(s["Net income before housing costs"], first_row = 5)) # get first row with your eyes
incomes = incomes_messy[!, Symbol.(["MSOA code", "Net annual income before housing costs (£)"])]
rename!(incomes, Symbol("MSOA code") => :code, Symbol("Net annual income before housing costs (£)") => :income)
incomes.type .= "msoa21"
incomes.year .= 2021 # annual income
incomes

incomes_h3 = leftjoin(loc_h3[.!nonunique(loc_h3, :h3), :], incomes, on=:code)
dropmissing!(incomes_h3)

df = select_df(con(), "select median(price) as price, h3_7 as index_int from pristine.properties_collapsed_test where channel = 'RES_BUY' group by h3_7")
# df = select_df(con(), "select median(price)*12 as price, h3_9 as index_int from pristine.properties_collapsed_test where channel = 'RES_LET' group by h3_9")
df.index = string.(df.index_int, base=16)
df = leftjoin(df, incomes_h3, on=:index_int=>:h3)
dropmissing!(df)

df.ratio = df.price ./ df.income

using CSV, JSON
addquantiles!(df, :ratio)

df2 = select_df(con(), "select median(if(time_in_market>0, time_in_market, null)) time_in_market, h3_7 from pristine.properties_collapsed_test where channel = 'RES_BUY' group by all")
dropmissing!(df2)
dfm = innerjoin(df, df2,on=:index_int=>:h3_7)
addquantiles!(dfm, :ratio)
addquantiles!(dfm, :time_in_market)
# propexum liquidity score (tm) (r) (c)
dfm.liquidity .= 1 .- sqrt.(dfm.ratio_quantile.^2 .+ dfm.time_in_market_quantile.^2) ./ sqrt(2)
addquantiles!(dfm, :liquidity)

dfm.value = dfm.liquidity#_quantile
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", dfm[!, [:index, :value, :ratio, :time_in_market]])
# Make legend scale human friendly (optional)
# write("$(homedir())/projects/H3-MON/www/data/meta.json", jsonscale(dfm, :value, :liquidity_quantile))
# screenshot birmingham via flameshot




# land value estimate
using CSV, LinearRegression
df = select_df(con(), "select bedrooms+1 bp1, price, code h3, new_entries from pristine.location_kpis where channel = 'RES_LET' and bedrooms > -1 and bedrooms < 5 and part_of_year = 0 and part_of_year_resolution = 'rolling_year' and type = 'h3_7'")
dropmissing!(df)
df = df[df.new_entries .> 10, :]
leftjoin!(df, combine(groupby(df, :h3), nrow), on=:h3)
# df = df[df.nrow .> quantile(df.nrow, 0.2), :]
df = df[df.nrow .>= 3, :]

dfm = combine(groupby(df, :h3), [:bp1,:price] => bias∘linregress => :land_value)
# dfm.index = string.(dfm.h3, base=16)
dfm.index = dfm.h3

addquantiles!(dfm, :land_value)
dfm.value = dfm.land_value_quantile
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", dfm[!, [:index, :value, :land_value]])

using CSV
df = select_df(con(), "select median(price) as mprice, h3_9 as index_int from pristine.properties_collapsed_test where channel = 'LREW_BUY' and price > 0 group by h3_9")
addquantiles!(df, :mprice)
df.index = string.(df.index_int, base=16)
df.value = df.mprice
# write("$(homedir())/projects/H3-MON/www/data/meta.json", jsonscale(df, :value, :mprice))
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value, :mprice]])

# 14 seconds with quantile, 11 seconds without, it's fine



# simon ppn presentation
# The first one would be the TIM (time to secure a buyer) over the last 3 years. The idea is to showcase the slowdown in the market
# CA vs YIELD using districts - this is to show that there are places where both are really good
# price increase of bedrooms
# any other interesting one you might think of?

# time to secure buyer

df = select_df(con(), "select 100*entry_to_agreed_days_change_yoy/entry_to_agreed_days as entry_to_agreed_days_change_yoy, date_start, name from pristine.location_kpis where type = 'fuas' and channel = 'RES_BUY' and part_of_year_resolution = 'quarter' and code like '%FSC%' and bedrooms = -1 and year > 2022 and name in ('London', 'West Midlands', 'Manchester', 'Bristol') order by date_start")

using Plots
plot(df.date_start, df.entry_to_agreed_days_change_yoy, grouping=df.name, ylabel="Increase in time on market (% YoY)", title="UK residential sales slowdown starting to recover", legend=:topright)
savefig("entry_to_agreed_days_change_yoy.pdf")

df = select_df(con(), "select entry_to_agreed_days as entry_to_agreed_days_change_yoy, date_start, name from pristine.location_kpis where type = 'fuas' and channel = 'RES_BUY' and part_of_year_resolution = 'month' and code like '%FSC%' and bedrooms = -1 and year > 2021 and name in ('London', 'West Midlands', 'Manchester', 'Bristol') order by date_start")
plot(df.date_start, df.entry_to_agreed_days_change_yoy, grouping=df.name, ylabel="Days on market", title="Estate agents in the UK don't work over Christmas", legend=:topleft)


# # buyer's market -> landlord's market

# needs more work to be usable at high resolution

# using XLSX, CSV

# loc_h3 = select_df(con(), "select code, h3 from raw.location_h3_indexed where res = 7 and type = 'msoa21'")
# s = XLSX.readxlsx("household_income_msoa_2020.xlsx") # from https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/earningsandworkinghours/datasets/smallareaincomeestimatesformiddlelayersuperoutputareasenglandandwales 2020 dataset
# incomes_messy = DataFrame(XLSX.gettable(s["Net income before housing costs"], first_row = 5)) # get first row with your eyes
# incomes = incomes_messy[!, Symbol.(["MSOA code", "Net annual income before housing costs (£)"])]
# rename!(incomes, Symbol("MSOA code") => :code, Symbol("Net annual income before housing costs (£)") => :income)
# incomes.type .= "msoa21"
# incomes.year .= 2021 # annual income
# incomes

# incomes_h3 = leftjoin(loc_h3[.!nonunique(loc_h3, :h3), :], incomes, on=:code)
# dropmissing!(incomes_h3)

# df = select_df(con(), "select median(price) as price, median(if(time_in_market>0, time_in_market, null)) time_in_market_buy, h3_7 as index_int from pristine.properties_collapsed_test where channel = 'RES_BUY' group by h3_7")
# df_let = select_df(con(), "select median(price)*12 as price_let, median(if(time_in_market>0, time_in_market, null)) time_in_market_let, h3_7 as index_int from pristine.properties_collapsed_test where channel = 'RES_LET' group by h3_7")
# # df = select_df(con(),"select price_per_sqm as price, entry_to_agreed_days time_in_market_buy, name from pristine.location_kpis lk where type = 'fuas' and channel = 'RES_BUY' and bedrooms = -1 and part_of_year_resolution = 'rolling_year' and code like '%FSC%' and part_of_year = 0 order by part_of_year")
# # df_let = select_df(con(),"select price_per_sqm as price_let, entry_to_agreed_days time_in_market_let, name from pristine.location_kpis lk where type = 'fuas' and channel = 'RES_LET' and bedrooms = -1 and part_of_year_resolution = 'rolling_year' and code like '%FSC%' and part_of_year = 0 order by part_of_year")
# # df = outerjoin(df, df_let, on=:name)
# df = outerjoin(df, df_let, on=:index_int)
# df.index = string.(df.index_int, base=16)
# df = leftjoin(df, incomes_h3, on=:index_int=>:h3)
# dropmissing!(df)

# df.ratio_buy = df.price #./ df.income
# df.ratio_let = df.price_let ./ df.income

# using CSV, JSON
# addquantiles!(df, :ratio_buy)
# addquantiles!(df, :ratio_let)
# addquantiles!(df, :time_in_market_let)
# addquantiles!(df, :time_in_market_buy)

# # buy/let 
# df.goodness_buy .= sqrt.((1 .-df.ratio_buy_quantile).^2 .+ df.time_in_market_buy_quantile.^2) ./ sqrt(2)
# df.goodness_let .= sqrt.(df.ratio_let_quantile.^2 .+ (1 .-df.time_in_market_let_quantile).^2) ./ sqrt(2)

# df.goodness .= 1 .- sqrt.(df.goodness_buy.^2 .+ df.goodness_let.^2) ./ sqrt(2)

# df.name = df.code
# df.value = df.goodness
# CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value, :ratio_buy_quantile, :time_in_market_buy_quantile, :ratio_let_quantile, :time_in_market_let_quantile]])
# # using Plots, Plots.Measures
# plot(df.goodness_buy, df.goodness_let, series_annotations=text.(df.name, :bottom, 5), markershape=:x, markersize=0.00001, legend=:none, group=df.name, arrow=true, margin=7mm, xlabel="buy goodness", ylabel="let goodness") # quantiles relabelled with original values

# # goodness score = difference between ratio,tim buy -> ratio,tim let vector and (0,1) -> (1,0)
# # -> cosine similarity
# map(v -> v*[-1,1]', (df.ratio_buy, df.time_in_market_buy) .- (df.ratio_let, df.time_in_market_let))

# # propexum liquidity score (tm) (r) (c)
# dfm.liquidity .= 1 .- sqrt.(dfm.ratio_quantile.^2 .+ dfm.time_in_market_quantile.^2) ./ sqrt(2)
# addquantiles!(dfm, :liquidity)

# dfm.value = dfm.liquidity#_quantile
# CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", dfm[!, [:index, :value, :ratio, :time_in_market]])
# # Make legend scale human friendly (optional)
# # write("$(homedir())/projects/H3-MON/www/data/meta.json", jsonscale(dfm, :value, :liquidity_quantile))
# # screenshot birmingham via flameshot

# dfm.liquidity .= 1 .- sqrt.(dfm.ratio_quantile.^2 .+ dfm.time_in_market_quantile.^2) ./ sqrt(2)

df = select_df(con(),"select price_per_sqm as price, entry_to_agreed_days time_in_market, name, new_entries, channel from pristine.location_kpis lk where type = 'fuas' and channel = 'RES_BUY' and bedrooms = -1 and part_of_year_resolution = 'rolling_year' and code like '%FSC%' and part_of_year = 0 order by part_of_year")
df_let = select_df(con(),"select price_per_sqm as price, entry_to_agreed_days time_in_market, name, new_entries, channel from pristine.location_kpis lk where type = 'fuas' and channel = 'RES_LET' and bedrooms = -1 and part_of_year_resolution = 'rolling_year' and code like '%FSC%' and part_of_year = 0 order by part_of_year")
df = vcat(df, df_let)
dropmissing!(df)
transform!(groupby(df, :name), nrow)
df = df[df.nrow .> 1, :]

combine(groupby(df, :channel), df -> addquantiles!(df, :price; jiggle=true))
combine(groupby(df, :channel), df -> addquantiles!(df, :time_in_market; jiggle=true))

dfm_t = df[df.new_entries .> 5000, :]
transform!(groupby(dfm_t, :name), nrow => :nrow_2)
dfm = @view dfm_t[dfm_t.nrow_2 .== 2, :]

# buy->let, let comes first
plot(dfm.price_quantile, dfm.time_in_market_quantile, series_annotations=text.(dfm.name, :bottom, 5), markershape=:x, markersize=0.00001, legend=:none, group=dfm.name, arrow=true, margin=7mm,xlabel="Landlord/seller power", ylabel="Buyer/tenant power",title="Buy to let power dynamics") # quantiles relabelled with original values
savefig("buy_to_let_power.pdf")


# capital appreciation vs rental yield
df = select_df(con(),"select price, price/(price - price_change) - 1 capital_growth, code index from pristine.location_kpis lk where type = 'h3_7' and channel = 'RES_BUY' and bedrooms = -1 and part_of_year_resolution = 'rolling_year' and part_of_year = 0 and new_entries > 100 order by part_of_year")
df_let = select_df(con(),"select price_per_sqm as price_let, entry_to_agreed_days time_in_market_let, code index from pristine.location_kpis lk where type = 'h3_7' and channel = 'RES_LET' and bedrooms = -1 and part_of_year_resolution = 'rolling_year' and part_of_year = 0 order by part_of_year")
df = outerjoin(df, df_let, on=:index)
dropmissing!(df)
df.yield = 100 .* 12 .* df.price_let ./ df.price
scatter(df.yield,df.capital_growth, markersize=0.1, xlabel="Rental yield", ylabel="Capital appreciation", legend=:none, margin=7mm, xlims=(0,0.15), ylims=(-0.5,0.5), title="Appreciation vs yield, 5km^2 parcels across UK")
savefig("yield_vs_capital_growth.pdf")

df = select_df(con(),"select price, price/(price - price_change) - 1 capital_growth, code index, name from pristine.location_kpis lk where type = 'fuas' and channel = 'RES_BUY' and bedrooms = -1 and part_of_year_resolution = 'rolling_year' and part_of_year = 0 and new_entries > 5000 and code like '%FSC%' order by part_of_year")
df_let = select_df(con(),"select price_per_sqm as price_let, entry_to_agreed_days time_in_market_let, code index, name from pristine.location_kpis lk where type = 'fuas' and channel = 'RES_LET' and bedrooms = -1 and part_of_year_resolution = 'rolling_year' and part_of_year = 0 and code like '%FSC%' order by part_of_year")
df = outerjoin(df, df_let, on=[:index, :name])
dropmissing!(df)
df.yield = 100 .* 12 .* df.price_let ./ df.price
scatter(df.yield,df.capital_growth, markersize=0.1, xlabel="Rental yield", ylabel="Capital appreciation", legend=:none, margin=7mm, xlims=(0.04,0.1), ylims=(-0.05,0.15), title="Appreciation vs yield, 5km^2 parcels across UK", series_annotations=text.(df.name, :bottom, 5))
savefig("yield_vs_capital_growth.pdf")



using Plots
# try to fix bug
df = select_df(con(), "select median(price) price, geoToH3(lon, lat, 5) h3, toYear(date) year, count(*) n from (select price, uprn, date from raw.land_registry_england_wales where uprn > 0) lre left join raw.uprn_metadata um on um.uprn = lre.uprn group by year, h3 order by year, h3") # my5 = /5 rather than /1
df = df[df.n .> quantile(df.n, 0.1), :]
# pad diff with 1
transform!(groupby(df, :h3), :year => (p -> [1.0; diff(p)...]))
df = df[df.year_function .== 1.0, :]
transform!(groupby(df, :h3), nrow)
df = df[df.nrow .>= 10, :]
df2 = combine(groupby(df, :h3), :price => (p -> p[1:end-5]) => :p1, :price => (p -> p[6:end]) => :p2, :year => (p -> p[6:end]) => :year)
df2.cap = (1 .+df2.p1./df2.p2).^(1/5) .-1
df2.cap = (1 .+df2.p2./df2.p1).^(1/5) .-1
df2.cap = (df2.p2./df2.p1).^(1/5) .-1
transform!(groupby(df2, :h3), nrow)
df2 = df2[df2.nrow .>= 10, :]

year_after_year = combine(groupby(df2, :h3), :cap => (p -> p[1:end-5]) => :p1, :cap => (p -> p[6:end]) => :p2, :year => (p -> p[6:end]) => :year)
# not sure if i prefer :Spectral or :turbo
y = @view year_after_year[year_after_year.year .> 2005, :] # whole graph is cooler but harder to read
scatter(100 .*y.p1, 100 .*y.p2, zcolor=y.year, markersize=0.5, markerstrokewidth=0, color=:Spectral, xlabel="Cap. growth % in first 5-year period", ylabel="Cap. growth % in second 5-year period", label=:none, xlims=(-10,30), ylims=(-10,30))
scatter(100 .*y.p1, 100 .*y.p2, markersize=0.5, markerstrokewidth=0, color=:Spectral, xlabel="Cap. growth % in first 5-year period", ylabel="Cap. growth % in second 5-year period", label=:none, xlims=(5,20), ylims=(5,20))

cor_vs_y = combine(groupby(year_after_year, :year), [:p1, :p2] => cor)
plot(cor_vs_y.year, cor_vs_y.p1_p2_cor, label=:none, ylabel="Correlation past/future 5yr cap. growth")



# sales slowdown
df = select_df(con(), "select entry_to_agreed_days, year, entry_to_agreed_days/(entry_to_agreed_days - entry_to_agreed_days_change) as entry_to_agreed_days_change_yoy, date_start, name from pristine.location_kpis where type = 'fuas' and channel = 'RES_BUY' and part_of_year_resolution = 'month' and code like '%FSC%' and bedrooms = -1 and name in ('London', 'West Midlands', 'Manchester', 'Bristol') and year >= 2022 order by date_start")
dropmissing!(df)

using Plots

df[df.name .== "West Midlands", :name] .= "Birmingham"
df.name_year = df.name .* " " .* string.(df.year)
# df = df[df.name .== "London", :]

# TODO: fix because it's YoY compounded and you're compounding by quarter
# df.entry_to_agreed_days_change_qoq = df.entry_to_agreed_days_change_yoy .^ (1/4)
# transform!(groupby(df, :name), :entry_to_agreed_days_change_yoy => cumprod)
# plot(df.date_start, 100 .*(df.entry_to_agreed_days_change_yoy_cumprod), grouping=df.name, ylabel="Cumulative increase in time on market (%)", legend=:topleft)
plot(layout = (4))
for y in unique(df.year)
    d = df[df.year .== y, :]
    plot!(month.(d.date_start), d.entry_to_agreed_days, grouping=d.name_year, ylabel="Days on market", xlabel="Month", legend=:topleft, layout=(4), xrotation=45, size=(1200, 800), arrow=true, margin=10Plots.mm, xticks=1:12)
end
plot!()
savefig("entry_to_agreed_days_change_yoy_compounded.pdf")






# maybe i can cheat here: don't strictly need to do this here, can use _date_ instead
#
# # except i think we do for new_entries?
# select_df(con(), """
#     -- CREATE TABLE pristine.location_kpis_V3_test
#     -- ENGINE = MergeTree()
#     -- ORDER BY (type, channel, bedrooms, property_type, code, rolling_year, y, q, m)
#     -- SETTINGS allow_nullable_key = 1
#     -- AS
#     $(grouping_preamble("listed_date")), -- also "cleared_date"
#     count(*) new_entries
#     from (select * from pristine.properties_collapsed_test limit 100000)
#     --from pristine.properties_collapsed_test
#     group by 
#         grouping sets $(gen_grouping_sets())
#     settings group_by_use_nulls = 1, max_memory_usage = 40000000000, max_bytes_before_external_group_by = 20000000000, max_bytes_before_external_sort = 20000000000
#     -- use disk storage because group by is too big, fails otherwise
#     -- https://clickhouse.com/docs/en/sql-reference/statements/select/group-by#group-by-in-external-memory says to set mem limit = 2x disk
# """)

# i think we'll need to do multiple passes:
# - 1) general stats of live listings
#       - price percentiles
# - 2) rm listings which have been agreed
#       - agreed
#       - agreed_total_value
#       - entry_to_agreed_days
#
# - 3) rm listings which have been cleared
        # cleared
        # entry_to_cleared_days
#
# - 4) new rm listings
#       # new_entries
#
# ... then just need to join all of those based on the grouping sets. i think? or could just give simon four tables >:)

# add other locations back
# make names as close to previous names as possible


df = select_df(con(), """
    select median(price) price, bedrooms, bathrooms from pristine.properties_collapsed_test
    where channel = 'RES_BUY'
    group by 
        grouping sets (
            (bedrooms, bathrooms),
            (bedrooms),
            (bathrooms)
        )
    having (bedrooms is null or bathrooms is null) or (bathrooms < bedrooms and bedrooms < 5)
    order by bedrooms, bathrooms
    settings group_by_use_nulls = 1
""")

using CSV
df.index = string.(df.h3_7, base=16)
df.value = df.price

CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value]])



using UnicodePlots
df = select_df(con(), """
    select median(price_bedroom_correlation) pc, floor(price_median/200)*200 price_band, sum(sample_size) c from pristine.location_kpis_V3_test where bedrooms is NULL and property_type is null and price_bedroom_correlation is not null and channel = 'RES_LET' and rolling_year = 0 group by ALL having c > 50 and price_band > 500 and price_band < 2000 order by price_band
""")

lineplot(df.price_band, df.pc, xlabel="Price", ylabel="Price-bedroom correlation")

select_df(con(), """select quantile(0.5)(sample_size), "least(5, bedrooms)" from pristine.location_kpis_V3_test group by all order by "least(5, bedrooms)" """)
select_df(con(), """select quantile(0.5)(sample_size), bedrooms from pristine.location_kpis_V3_test group by all having bedrooms <= 7 order by bedrooms""")
# adding 5+ bedrooms category makes almost zero difference

# lowercase
select_df(con(), """select substring(lower(hex(h3_7)), 2) from pristine.properties_collapsed_test limit 10""")
select_df(con(), """select code from pristine.location_kpis where type = 'h3_7' limit 10""")

# porting progress:
# need 

# this should probably go on the database really because it'll get used a lot
# loc_h3_stats = select_df(con(), "select argMin(res, avg_h3_num) as optimal_h3_res, type from (select type, res, abs(log10(10000) - log10(count(*)/count(distinct(code)))) as avg_h3_num from raw.location_h3_indexed group by type, res order by (type, avg_h3_num)) group by type")

# hard coded because i got fed up of waiting ~2-3 mins each time
loc_h3_stats = DataFrame(
    optimal_h3_res = UInt8[0x0b, 0x09, 0x0b, 0x09, 0x09, 0x0d, 0x09, 0x07, 0x0b, 0x07, 0x09],
    type = ["lsoa21", "ttwa", "msoa21", "fuas", "county", "oa21", "pcon", "region", "ward", "country", "district"],
)
loc2h3 = Dict(zip(loc_h3_stats.type, loc_h3_stats.optimal_h3_res))
        # type in ["lsoa21", "oa21", "county", "ttwa", "msoa21"] && continue # county and ttwa broken

# todo: make more DRY
for type in ["country", "region", "district", "fuas"]
    @info "starting $type"
    @time execute(con(), """
        insert into pristine.location_kpis_V3_test
        select channel, type, bedrooms, code, if(property_type in $(julia2clickhouse(known_property_types)), property_type, 'other') property_type, toInt16(ceil((toDate(date) - today()) / 365)) as rolling_year, toYear(date) AS y, toQuarter(date) AS q, toMonth(date) AS m,
        least(5,bedrooms),
        median(price) price_median,
        corr(price, bedrooms) price_bedroom_correlation,
        count(*) sample_size
        --from (select * from pristine.properties_collapsed_test limit 10000) pct
        from pristine.properties_collapsed_test pct
        left join (select code, type, h3 from raw.location_h3_indexed where type = '$type' and res = $(loc2h3[type])) lhi on lhi.h3 = pct.h3_$(loc2h3[type])
        group by 
            grouping sets $(gen_grouping_sets())
        settings group_by_use_nulls = 1, max_memory_usage = 40000000000, max_bytes_before_external_group_by = 20000000000, max_bytes_before_external_sort = 20000000000
    """)
end


# can maybe do yoy with https://clickhouse.com/docs/en/sql-reference/statements/alter/column#materialize-column
#
# but i'm not sure. coz it needs to operate on groups
#
#
# ALTER TABLE tmp ADD COLUMN s String MATERIALIZED toString(x);
#
# ALTER TABLE tmp MATERIALIZE COLUMN s;
#
#
# probably easier to make a new table as per
# > If the ALTER query is not sufficient to make the table changes you need, you can create a new table, copy the data to it using the INSERT SELECT query, then switch the tables using the RENAME query and delete the old table.



# proportion of sold properties that are let

# ffs simon got rid of the uprns
#
execute(con2(), """
    create view default.vw_rm_listing_events_with_uprns as (select * from default.rm_listing_events rle left join default.listing_uprn_map lup on rle.id = lup.listing_id)
    """)

df = select_df(con2(), """
    select avg(let) let, toMonth(event_date) as m, toYear(event_date) as y, any(event_date) as first_date from (select event_timestamp as event_date, uprn, price, if(uprn in (select uprn from default.vw_rm_listing_events_with_uprns where channel = 'RES_LET' and uprn > 0), 1, 0) as let
    from default.vw_rm_listing_events_with_uprns where channel = 'RES_BUY' and uprn > 0) group by y, m order by (y, m)
""")

using Plots
dfm = @view df[df.first_date .>= Date(2023, 1, 1), :]
dfm.let_rb = dfm.let ./ dfm.let[1] 
plot(dfm.first_date, dfm.let_rb)


# more complex model: first and last date of rental
df = select_df(con2(), """
    select min(d) first_date, toMonth(d) as m, toYear(d) as y, avg(d < lf) new_let, avg((d > ll) and (ll > '1970-01-01')) removed_let from (select rleb.event_timestamp d, rleb.uprn, min(rlel.event_timestamp) lf, max(rlel.event_timestamp) ll from (select * from default.vw_rm_listing_events_with_uprns where channel = 'RES_BUY' and uprn > 0) rleb left join (select * from default.vw_rm_listing_events_with_uprns where channel = 'RES_LET' and uprn > 0) rlel on rleb.uprn = rlel.uprn group by d, rleb.uprn) group by y, m order by (y, m)
""")

# hard to get any info from this because of course properties that have just been listed have not been relet
# and at the start no properties have been let before
plot(df.first_date, df.new_let)
plot!(df.first_date, df.removed_let)

# maybe could have a deadline? properties that are bought/sold and let within three months before/after ... very difficult to know actually because e.g. tenants in situ, and (almost) no-one will advertise for let just before selling

# i think we basically do not have enough data


# transfer postcode meta to cyclops from medusa
pm = select_df(con(), "select postcode, lat, lon from raw.postcode_meta")
execute(con2(), """
CREATE TABLE IF NOT EXISTS postcode_meta
$(tablespec(sort(enumerate(chtypes(pm))|>collect, by=x->x[2][1]) .|> x->x[2]))
ENGINE = MergeTree()
ORDER BY postcode
""")
insert(con2(), "postcode_meta", [df2dict(pm)])




# population
using Arrow, HivePartitioner
df = readhivedir(path->DataFrame(Arrow.Table(path)), "../../../../population-around-a-tile/map/data/JRC_POPULATION_2018_H3_by_rnd/")
df.h3 = parse.(UInt64, df.index, base=16)
minidf = copy(df[:, [:h3, :population, :res]])
minidf.res = parse.(UInt8, minidf.res)
minidf = minidf[minidf.res .> 5, :] # res 5 estimates unreliable

execute(con(), """
CREATE TABLE IF NOT EXISTS population_h3
    $(tablespec(chtypes(minidf)))
ENGINE = MergeTree()
ORDER BY (res, h3, population)
""")
execute(con(), "TRUNCATE TABLE IF EXISTS population_h3")
insert(con(), "population_h3", [df2dict(minidf)])
select_df(con(), "select population from population_h3 limit 10")

# pcon lookup
using CSV
lu = CSV.read("Ward_to_Westminster_Parliamentary_Constituency_to_LAD_to_UTLA_(July_2024)_Lookup_in_UK.csv", DataFrame, stringtype=String)

execute(con(), """
CREATE TABLE IF NOT EXISTS pcon24_lookup
    $(tablespec(chtypes(lu)))
ENGINE = MergeTree()
ORDER BY (PCON24CD, UTLA24CD, LAD24CD, WD24CD)
""")
execute(con(), "TRUNCATE TABLE IF EXISTS pcon24_lookup")
insert(con(), "pcon24_lookup", [df2dict(lu)])
select_df(con(), "select * from pcon24_lookup limit 10")


# pcon populated land area
# select_df(con(), "select * from location_h3 where type = 'wd23' and res = 9 limit 10")
# select_df(con(), "select distinct type from location_h3 where res = 7") # eugh we only have 2023
# select_df(con(), """
#     select count(*)*h3HexAreaKm2(7) as populated_area, PCON24CD from (
#         select * from location_h3 wd
#         left join population_h3 pop on pop.h3 = wd.h3
#         where population > 0
#         and type = 'wd23'
#         and res = 7
#     ) wdc
#     left join pcon24_lookup pcon on pcon.WD24CD = wdc.code
#     group by PCON24CD
# """)

# select_df(con(), "select distinct code from location_h3 where res=11 and type='wd23'") # seem to be barely any wards?
# select_df(con(), "select count(*), type, res from location_h3 group by all")

# # nice, pcons loaded
# select_df(con(), "select distinct code from location_h3 where res=7 and type='pcon24'")

res = 9
df = select_df(con(), """
    select code, count(*)*h3HexAreaKm2($res) as area_km2, sum(population >= 1)*h3HexAreaKm2($res) as populated_area_km2, medianExactWeighted(population, toUInt64(floor(population)))/h3HexAreaKm2($res) as population_weighted_median_population_per_km2, median(population)/h3HexAreaKm2($res) as median_population_per_km2 from (
        select *, pop.population from location_h3 pcon
        left join population_h3 pop on pop.h3 = pcon.h3
        where type = 'pcon24'
        and res = $res
    ) group by code
""")

# pcons = select_df(con(), "select distinct code from location_h3 where res=7 and type='pcon24'")
# missing "N05000007"
# workaround: convert it to res 9 manually
df_ni = select_df(con(), """
    select code, count(*)*h3HexAreaKm2($res) as area_km2, sum(population >= 1)*h3HexAreaKm2($res) as populated_area_km2, medianExactWeighted(population, toUInt64(floor(population)))/h3HexAreaKm2($res) as population_weighted_median_population_per_km2, median(population)/h3HexAreaKm2($res) as median_population_per_km2 from (
        select code, h3, pop.population from (
            select code, h3 from location_h3
            array join h3ToChildren(h3, 9) as h3
            where res=7 and type='pcon24' and code = 'N05000007'
        ) pcon
        left join population_h3 pop on pop.h3 = pcon.h3
    ) group by code
""")

df = vcat(df, df_ni)

# sizes all look about right
df.populated_fraction = df.populated_area_km2 ./ df.area_km2
sort!(df, [:populated_fraction, :population_weighted_median_population_per_km2])
using CSV
CSV.write("pcon_populated_land_area.csv", atfront(df, [:code]))





###
#
# number of letting listings per year per capita
#
###

cols = ["lat", "lon"]
df = select_df(con(), """
    select h3, count/population listings_per_capita_year from (SELECT geoToH3("t.2", "t.1", 9) h3, count(*) count from (
        SELECT id, channel, untuple(argMax(($(join(cols, ","))), event_timestamp)) as t
        from rm_listing_events
        where event_timestamp > now() - interval 1 year
        and channel = 'RES_BUY'
        -- and property_type != 'retirement'
        group by id, channel
    ) group by all) listings
    left join population_h3 pop on pop.h3 = listings.h3
    where pop.res = 9
    and population > 0
""")

using CSV
df.index = string.(df.h3, base=16)
df.value = df.listings_per_capita_year

CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value]])


brighton_h3_5 = [0x0851959b7fffffff, 0x085194a7bfffffff, 0x085194a73fffffff, 0x085194a0ffffffff, 0x085194a4ffffffff, 0x085194a47fffffff, 0x085194a0bfffffff] # res 5

string(brighton_h3_5)[8:end-1] # extract actual uint64 hex

# brighton_h3_9 = select_df(con(), "select arrayJoin(arrayJoin(arrayMap(x->h3ToChildren(x, 9), [$(string(brighton_h3_5)[8:end-1])]))) as h3") # get list of h3s at higher resolution

cols = ["uprn", "price", "lat", "lon"]
df2 = select_df(con(), """
    SELECT id, channel, untuple(argMax(($(join(cols, ","))), event_timestamp)) as t
    from vw_rm_listing_events_with_uprns
    where event_timestamp > now() - interval 1 year
    and uprn > 0
    and channel = 'RES_BUY' -- only look at sales for now
    and property_type != 'retirement'
    and geoToH3(lon, lat, 9) in (select arrayJoin(arrayJoin(arrayMap(x->h3ToChildren(x, 9),
    [$(string(brighton_h3_5)[8:end-1])]))))
    group by id, channel
""")

rename!(df2, map(p -> Pair(Symbol("t.$(p[1])"), p[2]), enumerate(cols)))


 # add floor areas, epc rating
floor_areas = mapreduce(uprns -> select_df(con(), """
    select uprn, total_floor_area, number_habitable_rooms, current_energy_efficiency
    from epc_data_england
    where uprn in $uprns
    order by inspection_date desc
"""), vcat, Iterators.map(julia2clickhouse, Iterators.partition(df2.uprn, MAX_CLICKHOUSE_QUERY_SIZE)))

floor_areas = floor_areas[.!nonunique(floor_areas, :uprn, keep=:first), :]

leftjoin!(df2, floor_areas, on = :uprn)

using Plots
mini = df2[replace(92 .> df2.current_energy_efficiency .> 20, missing=>false) .&& replace(df2.number_habitable_rooms .< 5, missing=>false), :]

function number2band(eff)
    if (eff >= 92)
        return 1
    elseif (eff >= 81)
        return 2
    elseif (eff >= 69)
        return 3
    elseif (eff >= 55)
        return 4
    elseif (eff >= 39)
        return 5
    elseif (eff >= 21)
        return 6
    elseif (eff >= 1)
        return 7
    else
        return 8
    end
end

function band2string(band)
    if band == 1
        return "A"
    elseif band == 2
        return "B"
    elseif band == 3
        return "C"
    elseif band == 4
        return "D"
    elseif band == 5
        return "E"
    elseif band == 6
        return "F"
    elseif band == 7
        return "G"
    else
        return "U"
    end
end


mini.band = number2band.(mini.current_energy_efficiency)
mini.psqm = mini.price ./ mini.total_floor_area

toplot = combine(groupby(mini, :band), :psqm => median => :psqm, :psqm => (x->quantile(x, 0.25)) => :q25, :psqm => (x->quantile(x, 0.75)) => :q75, nrow)
plot(toplot.band, toplot.q25, linestyle=:dash, label="Q1", xlabel="EPC rating", ylabel="£/sqm", title="Brighton area residential sales prices by EPC rating", margin=5*Plots.mm)
plot!(toplot.band, toplot.psqm, xformatter=band2string, label="Q2")
plot!(toplot.band, toplot.q75, linestyle=:dash, label="Q3")
bar!(twinx(), toplot.band, toplot.nrow, label="count", fillopacity=0.02, legend=:none, ylabel="Sales listings per year")


####
#
# Floor area per capita
#
####

res = 7
df = select_df(con(), """
    select sum(total_floor_area)/population garden_per_capita, h3ToParent(h3_11, $res) as h3 from properties_area sa
    left join population_h3 pop on h3 = pop.h3
    where pop.res = $res
    and population > 0
    group by all
""")
dropmissing!(df)
using CSV
df.index = string.(df.h3, base=16)
df.value = df.garden_per_capita
df = df[10000 .> df.value .> 10, :]
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value]])


####
#
# Simon's Grove Coventry prices
#
####

select_df(con(), "select price, postcode, street, paon, date, new_build=1 from land_registry_england where postcode = 'CV7 8RR' order by date desc")
select_df(con(), """
    select avg(price) from (select price, postcode, street, paon, date from land_registry_england where postcode = 'CV7 8RR' order by date desc)
""")
select_df(con(), """
    select avg(price) from (select price, postcode, event_timestamp from rm_listing_events where postcode like 'CV7 8R%' and channel = 'RES_BUY' and property_type = 'semi_detached' order by event_timestamp desc)
""")



select_df(con(), "select price, postcode, street, paon, date, new_build=1 from land_registry_england where street = 'ANTHONY PILLAGE WAY' order by date desc")

select_df(con(), """select id, price, postcode, event_timestamp from rm_listing_events where postcode = 'CV5 9PW'""")


####
#
# UPRNs that share INSPIREs with a commercial property
#
# dining and drinking
# 63be6904847c3692a84b9bb5
#
# retail
# 4d4b7105d754a06378d81259
####

select_df(con(), """
    select arrayJoin(uprns) uprn, fop.h3_15, name, country, latitude, longitude, ih.INSPIREID from foursquare_os_places fop
    inner join (select INSPIREID, h3 as h3_15 from inspire_h3 where INSPIREID in (
        select INSPIREID from inspire_uprn_raw
        group by INSPIREID
        having count(*) > 1
        limit 1000
    )) ih on fop.h3_15 = ih.h3_15
    left join (select INSPIREID, groupArray(uprn) uprns from inspire_uprn_raw group by INSPIREID) iu on ih.INSPIREID = iu.INSPIREID
    where country = 'GB'
    and (
        has(fsq_category_ids, '63be6904847c3692a84b9bb5')
        or 
        has(fsq_category_ids, '4d4b7105d754a06378d81259')
    )
""")


select_df(con(), """ select * from foursquare_os_categories where lower(category_name) like '%bakery%' """)


####
#
# People per bakery Europe-wide
#
####
res = 5
df = select_df(con(), """
    select h3ToParent(h3_15, $res) h3, count(fop.h3_15) n, sum(population) p, p/n people_per_bakery from foursquare_os_places fop
    left join population_h3 pop on h3 = pop.h3
    where true
--    and country in ('GB', 'FR')
    and pop.res = $res
    and population > 0
    and has(fsq_category_ids, '4bf58dd8d48988d16a941735')
    and h3_15 is not null
    group by h3
    having n > 0
""")
dropmissing!(df)
using CSV
df.index = string.(df.h3, base=16)
df.value = df.people_per_bakery
# df = df[10000 .> df.value .> 10, :]
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value]])


####
#
# Bakery density worldwide
#
####
res = 5
df = select_df(con(), """
    select h3ToParent(h3_15, $res) h3, count(fop.h3_15) n, n/h3HexAreaKm2($res) density, 1/(2*sqrt(density)) avg_distance  from foursquare_os_places fop
    where true
--    and country in ('GB', 'FR')
    and has(fsq_category_ids, '4bf58dd8d48988d16a941735')
    and h3_15 is not null
    group by h3
    having n > 0
""")
dropmissing!(df)
using CSV
df.index = string.(df.h3, base=16)
df.value = (df.avg_distance ./ 5) .* -60 # average walking time in minutes
# df = df[10000 .> df.value .> 10, :]
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[df.value .> -95, [:index, :value]])



# population weighted average walking time to bakery
res = 4
mini_res = 7
df = select_df(con(), """
    select h3ToParent(h3, $res) h3_big, medianExactWeighted(avg_distance, toUInt64(floor(p))) median_dist, (median_dist / 5) * -60 walking_time from (
        select h3ToParent(h3_15, $mini_res) h3, count(fop.h3_15) n, sum(population) p, n/h3HexAreaKm2($mini_res) density, 1/(2*sqrt(density)) avg_distance
        from foursquare_os_places fop
        left join population_h3 pop on h3 = pop.h3
        where true
        and pop.res = $mini_res
        and population > 0
        and has(fsq_category_ids, '4bf58dd8d48988d16a941735')
        and h3_15 is not null
        group by h3
        having n > 0
    ) group by h3_big
""")
df.index = string.(df.h3_big, base=16)
df.value = (df.median_dist ./ 5) .* -60 # distance in km -> walking time in minutes
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[:, [:index, :value]])

res = 9
df = select_df(con(), """
    select median(price) price, geoToH3(lon, lat, $res) h3, count(*) n from rm_listing_events
    where event_timestamp > now() - interval 5 year
    and channel = 'RES_BUY'
    -- and property_type = 'semi_detached'
    and property_type = 'bungalow'
    group by h3 having count(*) > 10
""")
df.index = string.(df.h3, base=16)
df.value = df.n
# df.value = -1 .* df.median_dist # average walking time in minutes
# df = df[10000 .> df.value .> 10, :]
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[:, [:index, :value]])

select_df(con(), "select 1/h3HexAreaKm2($mini_res) density, 1/(2*sqrt(density)) avg_distance") # we assume that anyone further than this from a bakery doesn't exist. probably a bad idea
# better approach might be to replace 0 bakery H3s with average distance in the k ring + the average distance?


###
#
# Bakeries hard mode: people who live more than 15 minutes away still exist
#
###
using CSV
res = 3
mini_res = 7
max_distance = 8 
df = select_df(con(), """
    select quantileExactWeighted(0.75)(distance_to_bakery, toUInt64(ceil(population))) weighted_distance, weighted_distance / 5 * 60 weighted_walking_time, h3ToParent(h3, $res) h3_big from (
    select any(population) population, min(distance_to_bakery) distance_to_bakery, h3 from (
        select ph.population, ph.h3, ph.h3_candidate, fop.n, distance + 1/(2*sqrt(n/h3HexAreaKm2($mini_res))) distance_to_bakery from (
        select population, h3, arrayJoin(h3kRing(h3, $max_distance)) h3_candidate, (h3Distance(h3, h3_candidate)-1)*h3EdgeLengthKm($mini_res) distance
        from population_h3 where res = $mini_res and population > 0)
        ph
        inner join (select h3ToParent(h3_15, $mini_res) h3, count(*) n from foursquare_os_places fop
        where true
        -- and has(fsq_category_ids, '4bf58dd8d48988d16a941735') -- bakery
        and has(fsq_category_ids, '4bf58dd8d48988d129951735') -- railway station
        and h3_15 is not null group by h3) fop on fop.h3 = ph.h3_candidate
    ) group by h3
    ) group by h3_big
""")
df.index = string.(df.h3_big, base=16)
df.value = df.weighted_walking_time
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[:, [:index, :value]])


####
#
# Same but for trains
#
####
a = select_df(con(), """ select * from foursquare_os_categories where lower(category_name) like '%tram%' """)
# 4bf58dd8d48988d12a951735
# hmm..... i think we might need to use subcategories? it seems like we need to check if a category is a leaf first?
using CSV
res = 7
mini_res = 9
max_distance = 5#12 
df = select_df(con(), """
    select quantileExactWeighted(0.5)(distance_to_bakery, toUInt64(ceil(population))) weighted_distance, weighted_distance / 5 * -60 weighted_walking_time, h3ToParent(h3, $res) h3_big from (
    select any(population) population, min(distance_to_bakery) distance_to_bakery, h3 from (
        select ph.population, ph.h3, ph.h3_candidate, fop.n, distance + 1/(2*sqrt(n/h3HexAreaKm2($mini_res))) distance_to_bakery from (
        select population, h3, arrayJoin(h3kRing(h3, $max_distance)) h3_candidate, (h3Distance(h3, h3_candidate)-1)*h3EdgeLengthKm($mini_res) distance
        from population_h3 where res = $mini_res and population > 0)
        ph
        inner join (select h3ToParent(h3_15, $mini_res) h3, count(*) n from foursquare_os_places fop 
        where true and
        -- (has(fsq_category_ids, '4d4b7105d754a06379d81259')) -- or has(fsq_category_ids, '63be6904847c3692a84b9c28'))
        -- has(fsq_category_ids, '52f2ab2ebcbc57f1066b8b51') -- tram station -- seems to include some closed ones?
        has(fsq_category_ids, '4bf58dd8d48988d129951735') -- railway station
        and h3_15 is not null
        and date_closed is null -- doesn't seem to filter out all dodgy tram stations. should probably index on this
        group by h3) fop on fop.h3 = ph.h3_candidate
    ) group by h3
    ) group by h3_big
""")
df.index = string.(df.h3_big, base=16)
df.value = df.weighted_walking_time
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[:, [:index, :value]])
# a = select_df(con(), """ select * from foursquare_os_categories where level2_category_id = '63be6904847c3692a84b9c28' and category_level = 3""")

# it's ok, it's a leaf
# a = select_df(con(), """ select * from foursquare_os_categories where level2_category_id = '63be6904847c3692a84b9c28' and category_level = 3""")
a = select_df(con(), """ select * from foursquare_os_categories where lower(category_name) like '%tram%'""")




####
#
# Graphs instead of maps
#
####
a = select_df(con(), """ select * from foursquare_os_categories where lower(category_name) like '%tram%' """)
# 4bf58dd8d48988d12a951735
# hmm..... i think we might need to use subcategories? it seems like we need to check if a category is a leaf first?
using Plots, CSV
mini_res = 7
max_distance = 5  # res 9, max distance 12 takes like 10 minutes to run
quantiles_raw = 0.01:0.01:0.99
quantiles = replace(julia2clickhouse(quantiles_raw)[2:end-1], "'" => "")
query = """
    select quantilesExactWeighted($quantiles)(distance_to_bakery, toUInt64(ceil(population))) weighted_distance, weighted_distance / 5 * 60 weighted_walking_time, country, sum(n) n from (
    select any(population) population, any(country) country, min(distance_to_bakery) distance_to_bakery, h3, sum(n) n from (
        select country, ph.population, ph.h3, ph.h3_candidate, fop.n, distance + 1/(2*sqrt(n/h3HexAreaKm2($mini_res))) distance_to_bakery from (
        select population, h3, arrayJoin(h3kRing(h3, $max_distance)) h3_candidate, (h3Distance(h3, h3_candidate)-1)*h3EdgeLengthKm($mini_res) distance
        from population_h3 where res = $mini_res and population > 0)
        ph
        inner join (select h3ToParent(h3_15, $mini_res) h3, count(*) n, anyHeavy(country) country from foursquare_os_places fop 
        where true and
        -- (has(fsq_category_ids, '4d4b7105d754a06379d81259')) -- or has(fsq_category_ids, '63be6904847c3692a84b9c28'))
        -- has(fsq_category_ids, '52f2ab2ebcbc57f1066b8b51') -- tram station -- seems to include some closed ones?
        has(fsq_category_ids, '4bf58dd8d48988d129951735') -- railway station
        --has(fsq_category_ids, '4bf58dd8d48988d16a941735') -- bakery
        and h3_15 is not null
        and date_closed is null -- doesn't seem to filter out all dodgy tram stations. should probably index on this
        group by h3) fop on fop.h3 = ph.h3_candidate
    ) group by h3
    ) group by country
    -- having n > 50 -- prevent overspills
    order by country asc
"""
@time df = select_df(con(), query)

# write("query.sql", query)
# CSV.read("test.tsv", DataFrame, header=false)

gimme(country) = df[df.country .== country, :weighted_walking_time] |> first
# pgimme(country) = plot!(gimme(country), quantiles_raw, label=country)
# pgimme(country) = plot!(gimme(country), quantiles_raw, label=country, series_annotations=text(country, :bottom, 3)) # it'd be nice if the labels were less frequent
pgimme(country) = begin
    i = Int.(round.(rand(5).*length(quantiles_raw)))
    return plot!(gimme(country), quantiles_raw, label=country, annotation=map(k -> (gimme(country)[k], quantiles_raw[k], text(country, 4)), i))
end
p = plot(;xlabel="Maximum walking time to nearest railway station, mins", ylabel="Fraction of population")
for country in split("GB CH FR ES AT DE CZ SK")
    pgimme(country)
end
p
plot!(; xlims=(0,45))
# plot(dfm.price_quantile, dfm.entry_to_agreed_days_quantile, series_annotations=text.(dfm.name, :bottom, 5), markershape=:x, markersize=0.00001, legend=:none,  xlabel="Price", ylabel="Time on market", group=dfm.name, arrow=true, 


# this seems like a weird way to do it but it seems to work so meh
mini = combine(groupby(df, :country), g -> begin
        c = collect(zip(quantiles_raw, g.weighted_walking_time|>first))
        (quantile=map(x->x[1], c), walking_time=map(x->x[2], c))
end)
mini = mini[.!nonunique(mini, [:country, :walking_time], keep=:last), :] # interpolate for plotting
v = mini[in.(mini.country, Ref(split("GB CH FR ES AT DE CZ SK NL BE IE"))), :]
plot(v.walking_time, v.quantile, group=v.country, series_annotations=map(c -> text(rand() < 0.3 ? c : "", :bottom, 5), v.country), xlims=(0,25), legend=:topleft, xlabel="Maximum walking time to nearest railway station, mins", ylabel="Fraction of population")




#####
#
# Use CH CLI for slow queries so you get some progress
#
####
mini_res = 9
max_distance = 25  # res 9, max distance 12 takes like 10 minutes to run # grid size 9 -> cell size 0.2km, 5 km/h / 0.2 km = 25 cells / hour
quantiles_raw = 0.01:0.01:0.99
quantiles = replace(julia2clickhouse(quantiles_raw)[2:end-1], "'" => "")
query = """
    select quantilesExactWeighted($quantiles)(distance_to_bakery, toUInt64(ceil(population))) weighted_distance, weighted_distance / 5 * 60 weighted_walking_time, country, sum(n) n from (
    select any(population) population, any(country) country, min(distance_to_bakery) distance_to_bakery, h3, sum(n) n from (
        select country, ph.population, ph.h3, ph.h3_candidate, fop.n, distance + 1/(2*sqrt(n/h3HexAreaKm2($mini_res))) distance_to_bakery from (
        select population, h3, arrayJoin(h3kRing(h3, $max_distance)) h3_candidate, (h3Distance(h3, h3_candidate)-1)*h3EdgeLengthKm($mini_res) distance
        from population_h3 where res = $mini_res and population > 0)
        ph
        inner join (select h3ToParent(h3_15, $mini_res) h3, count(*) n, anyHeavy(country) country from foursquare_os_places fop 
        where true and
        -- (has(fsq_category_ids, '4d4b7105d754a06379d81259')) -- or has(fsq_category_ids, '63be6904847c3692a84b9c28'))
        -- has(fsq_category_ids, '52f2ab2ebcbc57f1066b8b51') -- tram station -- seems to include some closed ones?
        has(fsq_category_ids, '4bf58dd8d48988d129951735') -- railway station
        --has(fsq_category_ids, '4bf58dd8d48988d16a941735') -- bakery
        and h3_15 is not null
        and date_closed is null -- doesn't seem to filter out all dodgy tram stations. should probably index on this
        group by h3) fop on fop.h3 = ph.h3_candidate
    ) group by h3
    ) group by country
    -- having n > 50 -- prevent overspills
    order by country asc
"""
write("query.sql", query * "into outfile 'test.tsv'") # run in CH, res 9, range 25 takes about half an hour
# clickhouse-client --progress --queries-file=query.sql ...[normal options]


df = CSV.read("test.tsv", DataFrame, header=["weighted_distance", "weighted_walking_time", "country", "n"])
df.weighted_walking_time = map(s -> parse.(Float64, split(s[2:end-2], ",")), df.weighted_walking_time)
# this seems like a weird way to do it but it seems to work so meh
mini = combine(groupby(df, :country), g -> begin
        c = collect(zip(quantiles_raw, g.weighted_walking_time|>first))
        (quantile=map(x->x[1], c), walking_time=map(x->x[2], c))
end)
# mini = mini[.!nonunique(mini, [:country, :walking_time], keep=:last), :] # interpolate for plotting
v = mini[in.(mini.country, Ref(split("GB CH FR ES AT DE CZ SK NL BE IE"))), :]
plot(v.walking_time, v.quantile, group=v.country, series_annotations=map(c -> text(rand() < 0.05 ? c : "", :bottom, 5), v.country), xlims=(0,25), legend=:topleft, xlabel="Maximum walking time to nearest railway station, mins", ylabel="Fraction of population") # hmm, this is hard to believe. maybe 25 cells isn't far enough to capture all of the population in lots of countries - e.g. france comes out very well



#### 
#
# acceptable places to live on the entire planet
#
####
using CSV
res = 8
df = select_df(con(), """
    select h3ToParent(h3_15, $res) h3, count(fop.h3_15) n, arrayFlatten(groupUniqArray(fsq_category_ids)) pls from foursquare_os_places fop
    where true
    and (has(fsq_category_ids, '4bf58dd8d48988d16a941735') -- bakery
    or has(fsq_category_ids, '4bf58dd8d48988d1e5941735') -- dog park
    or has(fsq_category_ids, '4bf58dd8d48988d163941735') -- park
    or has(fsq_category_ids, '4bf58dd8d48988d129951735') -- railway station
    or has(fsq_category_ids, '4bf58dd8d48988d1fd931735') -- metro station
    or has(fsq_category_ids, '52f2ab2ebcbc57f1066b8b51') -- tram station
    or has(fsq_category_ids, '4bf58dd8d48988d1fc931735') -- light rail station
    )
    and h3_15 is not null
    group by h3
    having true
    and n > 0
    and has(pls, '4bf58dd8d48988d16a941735') -- bakery
    and (has(pls, '4bf58dd8d48988d1e5941735') -- dog park
    or has(pls, '4bf58dd8d48988d163941735') -- park
    )
    and (has(pls, '4bf58dd8d48988d129951735') -- railway station
    or has(pls, '4bf58dd8d48988d1fd931735') -- metro station
    or has(pls, '52f2ab2ebcbc57f1066b8b51') -- tram station
    or has(pls, '4bf58dd8d48988d1fc931735') -- light rail station
    )
""")
dropmissing!(df)
using CSV
df.index = string.(df.h3, base=16)
df.value = df.n
# df = df[10000 .> df.value .> 10, :]
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value]])



####
#
# Wood burning stoves
#
####
df_mainheat = select_df(con(), """select mainheat_description, count(*) c from epc_data_england group by all order by c""")
df_secondheat = select_df(con(), """select secondheat_description, count(*) c from epc_data_england group by all order by c""")

# apply mark i eyeball to look for wood burners that are worth counting
secondheat_wood = ["Room heaters, wood logs", "Room heaters, coal", "Room heaters, dual fuel (mineral and wood)"]
mainheat_wood = ["Boiler and radiators, dual fuel (mineral and wood)", "Boiler and radiators, coal", "Room heaters, dual fuel (mineral and wood)", "Boiler and radiators, wood logs", "Room heaters, coal", "Room heaters, wood logs"]

res = 10
df = select_df(con(), """
    select 
    avg(if(mainheat_description in $(julia2clickhouse(mainheat_wood)) or secondheat_description in $(julia2clickhouse(secondheat_wood)), 1, 0)) has_wood_perc,
    sum(if(mainheat_description in $(julia2clickhouse(mainheat_wood)) or secondheat_description in $(julia2clickhouse(secondheat_wood)), 1, 0))/h3HexAreaKm2($res) wood_per_km,
    geoToH3(lon, lat, $res) h3
    from epc_data_england epc
    inner join (select uprn, max(lodgement_datetime) lodgement_datetime from epc_data_england where uprn > 0 group by uprn) epc2 on epc.uprn = epc2.uprn and epc.lodgement_datetime = epc2.lodgement_datetime -- only most recent EPC
    left join uprn_os os on os.uprn = epc.uprn
    group by all
""")
using CSV
df.index = string.(df.h3, base=16)
df.value = df.wood_per_km #./ quantile(df.wood_per_km, 0.99)
today = Dates.today()
mkpath("$(homedir())/projects/H3-MON/www/data/wood_stoves")
write("""$(homedir())/projects/H3-MON/www/data/wood_stoves/$today.json""", 
    JSON.json(Dict(
    "t" => "Number of wood stoves per km²",
    "flip" => true,
    #"raw" => true,
    "c" => "MCHLG",
    "scale" => Dict(zip(0.0:0.2:1.0, 0:12:60)),
)))
CSV.write("$(homedir())/projects/H3-MON/www/data/wood_stoves/$today.csv", df[df.value .> 0.474, [:index, :value]]) # exclude areas with 3 or fewer burners

####
#
# population weighted
#
####
mini_res = 9
res = 6
df = select_df(con(), """
    select h3ToParent(h3, $res) h3_big, medianExactWeighted(wood_per_km, toUInt32(round(population))) wood_per_km from (
    select 
    -- avg(if(mainheat_description in $(julia2clickhouse(mainheat_wood)) or secondheat_description in $(julia2clickhouse(secondheat_wood)), 1, 0)) has_wood_perc,
    sum(if(mainheat_description in $(julia2clickhouse(mainheat_wood)) or secondheat_description in $(julia2clickhouse(secondheat_wood)), 1, 0))/h3HexAreaKm2($mini_res) wood_per_km,
    geoToH3(lon, lat, $mini_res) h3
    from epc_data_england epc
    inner join (select uprn, max(lodgement_datetime) lodgement_datetime from epc_data_england where uprn > 0 group by uprn) epc2 on epc.uprn = epc2.uprn and epc.lodgement_datetime = epc2.lodgement_datetime -- only most recent EPC
    left join uprn_os os on os.uprn = epc.uprn
    group by all
    ) wood
    left join population_h3 pop on pop.h3 = wood.h3
    -- left join (select arrayJoin(h3ToChildren(h3, $mini_res)) h3, population from population_h3 where res = 9) pop on pop.h3 = wood.h3 -- not sure projecting to higher res works
    group by h3_big
""")
using CSV
df.index = string.(df.h3_big, base=16)
df.value = df.wood_per_km
# addquantiles!(df, :wood_per_km, jiggle=true)
# df.value = df.wood_per_km_quantile
# CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[df.value .> 210, [:index, :value]]) # exclude areas with 3 or fewer burners
CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[:, [:index, :value]]) # exclude areas with 3 or fewer burners

####
#
# wood burning vs population weighted population density
#
####
res = 9
df = select_df(con(), """
    select h3, population/h3HexAreaKm2($res) population, wood_per_km from (
    select 
    -- avg(if(mainheat_description in $(julia2clickhouse(mainheat_wood)) or secondheat_description in $(julia2clickhouse(secondheat_wood)), 1, 0)) has_wood_perc,
    sum(if(mainheat_description in $(julia2clickhouse(mainheat_wood)) or secondheat_description in $(julia2clickhouse(secondheat_wood)), 1, 0))/h3HexAreaKm2($res) wood_per_km,
    geoToH3(lon, lat, $res) h3
    from epc_data_england epc
    inner join (select uprn, max(lodgement_datetime) lodgement_datetime from epc_data_england where uprn > 0 group by uprn) epc2 on epc.uprn = epc2.uprn and epc.lodgement_datetime = epc2.lodgement_datetime -- only most recent EPC
    left join uprn_os os on os.uprn = epc.uprn
    group by all
    ) wood
    left join population_h3 pop on pop.h3 = wood.h3
""")

using Plots
histogram2d(df.population, df.wood_per_km, nbins=10)
sort!(df, :population)
df.wq = cumsum(df.population) ./ sum(df.population) # jiggles which we don't want but ignore for now
df = df[.!isnan.(df.wq), :]
df.wqr = round.(df.wq, digits=1)

agg = combine(groupby(df, :wqr), 
    :wood_per_km => (w -> quantile(w, 0.05)) => :w05,
    :wood_per_km => (w -> quantile(w, 0.25)) => :w25,
    :wood_per_km => (w -> quantile(w, 0.5)) => :w50,
    :wood_per_km => (w -> quantile(w, 0.75)) => :w75,
    :wood_per_km => (w -> quantile(w, 0.95)) => :w95,
)
actualvaluelabels(values, labels; middle = [0.001, 0.2, 0.4, 0.6, 0.8, 0.999]) = begin
    inds = [findfirst(>=(v), values) for v in middle]
    qs = labels[inds]
    return (middle, round.(qs, sigdigits=2))
end
plot(; xticks=actualvaluelabels(df.wqr, df.population), ylabel="Wood and coal burners per km²", xlabel="Population per km²")
plot!(agg.wqr, agg.w95; label="95th percentile")
plot!(agg.wqr, agg.w75; label="75th percentile")
plot!(agg.wqr, agg.w50; label="50th percentile")
plot!(agg.wqr, agg.w25; label="25th percentile")
plot!(agg.wqr, agg.w05; label="5th percentile")
# => not just urban areas, almost universal problem everywhere except most rural 5% of population. can see the impact of smoke free zones at 95th percentiles of density and stoves per km2
#
using CSV
df = select_df(con(), "select h3ToParent(h3, 6) as index_int, sum(population) value from population_h3 where res = 9 group by all")
df.index = string.(df.index_int, base=16)
dropmissing!(df)
#df.value = df.value ./ quantile(df.value, 0.9)

CSV.write("$(homedir())/projects/H3-MON/www/data/h3_data.csv", df[!, [:index, :value]])

####
#
# Sales per capita
#
####
using CSV
res = 6
years = 3
df = select_df(con(), """
    select h3, 1000*c/(population*$years) value from (
        select geoToH3(lon, lat, $res) h3, count(*) c from land_registry_england lre
        left join uprn_os os on os.uprn = lre.uprn
        where true
        and uprn > 0
        and new_build
        and date > now() - interval $years year
        group by all
    ) lrc
    left join (select h3ToParent(h3, $res) as h3, sum(population) population from population_h3 where res = 9 group by all) pop on lrc.h3 = pop.h3
""")
df.index = string.(df.h3, base=16)
df = df[df.value .<= quantile(df.value, 0.99), :] # i thought this was already supposed to happen
dropmissing!(df)
#df.value = df.value ./ quantile(df.value, 0.9)

#CSV.write("$(homedir())/projects/H3-MON/www/data/new_build_sales_per_1k_pop_yr_apr2024.csv", df[!, [:index, :value]])
# workflow so you don't accidentally overwrite the last thing each time
today = Dates.today()
mkpath("$(homedir())/projects/H3-MON/www/data/$today")
CSV.write("$(homedir())/projects/H3-MON/www/data/$today/h3_data.csv", df[!, [:index, :value]])

####
#
# Fraction of gails/greggs that are gails (1 = all gails, 0 = all greggs)
#
####
using CSV
res = 7
df = select_df(con(), """
    select geoToH3(longitude, latitude, $res) h3, sum(name = 'Greggs') greggses, sum(name = 'GAIL\\'s Bakery') gailses from foursquare_os_places
    where true
    and country = 'GB'
    group by all
""")
dropmissing!(df)
df.value = df.gailses ./ (df.greggses .+ df.gailses)
df.index = string.(df.h3, base=16)
df = df[df.value .> 0, :]

#CSV.write("$(homedir())/projects/H3-MON/www/data/new_build_sales_per_1k_pop_yr_apr2024.csv", df[!, [:index, :value]])
# workflow so you don't accidentally overwrite the last thing each time
today = Dates.today()
mkpath("$(homedir())/projects/H3-MON/www/data/$today")
CSV.write("$(homedir())/projects/H3-MON/www/data/$today/gails_to_greggs_ratio.csv", df[!, [:index, :value]])


using CSV
res = 6
years = 10
df = select_df(con(), """
    select geoToH3(lon, lat, $res) h3, median(price) value from land_registry_england lre
    left join uprn_os os on os.uprn = lre.uprn
    where true
    and uprn > 0
    -- and new_build
    and date > now() - interval $years year
    group by all
""")
dropmissing!(df)
df.index = string.(df.h3, base=16)
df = df[df.value .> 0, :]

#CSV.write("$(homedir())/projects/H3-MON/www/data/new_build_sales_per_1k_pop_yr_apr2024.csv", df[!, [:index, :value]])
# workflow so you don't accidentally overwrite the last thing each time
today = Dates.today()
mkpath("$(homedir())/projects/H3-MON/www/data/$today")
CSV.write("$(homedir())/projects/H3-MON/www/data/$today/tiny.csv", df[!, [:index, :value]])

####
#
# What extended fuas do wards belong to?
#
####
res = 7
df = select_df(con(), """
    select fuas.name, fuas_core.name, fuas.code, fuas_core.code, count(*) c from (
    select * from location_h3 where res = $res
    and type = 'fuas') fuas
    inner join (select h3ToParent(h3, $res) h3, code, name from location_h3 where res = 9 and type = 'wd23') fuas_core on fuas_core.h3 = fuas.h3
    group by all
""")

sort!(df, :c, rev=true)
df[.!nonunique(df, Symbol("fuas_core.code")), :]


####
#
# LSOA population estimates projected down by UPRN counts
#
####

using XLSX
s = XLSX.readxlsx("data/file?uri=%2Fpeoplepopulationandcommunity%2Fpopulationandmigration%2Fpopulationestimates%2Fdatasets%2Flowersuperoutputareamidyearpopulationestimatesnationalstatistics%2Fmid2021andmid2022%2Fsapelsoabroadagetablefinal.xlsx");
population_messy = DataFrame(XLSX.gettable(s["Mid-2022 LSOA 2021"], first_row = 4))
population_tidy = population_messy[!, [Symbol("LSOA 2021 Code"), Symbol("Total")]]
rename!(population_tidy, Symbol("LSOA 2021 Code") => :code, Symbol("Total") => :population)
population_tidy.code = string.(population_tidy.code)
population_tidy.population = UInt16.(population_tidy.population)

execute(con(), """
    create table ons_lsoa_2022_population
    $(tablespec(chtypes(population_tidy)))
    ENGINE = MergeTree()
    ORDER BY (code, population)
""")

insert(con(), "ons_lsoa_2022_population",[df2dict(population_tidy)]) 

# uprn counts and lsoaness

using CSV
# # ultra high res population estimates will probably come in handy someday right
# execute(con(), """
#     create table population_h3_11
#     engine MergeTree()
#     order by (h3, population)
#     as
#     with lsoa_h3_uprn_counts as (
#     select count(*) c, geoToH3(lon, lat, $res) h3, code from uprn_os os
#     inner join (select * from location_h3 where res = $res and type = 'lsoa21') lh on lh.h3 = h3
#     where uprn > 0
#     group by all
#     ),
#     lsoa_uprn_counts as (
#     select sum(c) total_uprn, code from lsoa_h3_uprn_counts
#     group by all
#     )
#     select (c/total_uprn)*population population, h3 from lsoa_h3_uprn_counts hc
#     left join lsoa_uprn_counts lc on lc.code = hc.code
#     left join ons_lsoa_2022_population pop on pop.code = hc.code
# """)

res = 11
df = select_df(con(), """
    with lsoa_h3_uprn_counts as (
    select count(*) c, geoToH3(lon, lat, $res) h3, code from uprn_os os
    inner join (select * from location_h3 where res = $res and type = 'lsoa21') lh on lh.h3 = h3
    where uprn > 0
    group by all
    ),
    lsoa_uprn_counts as (
    select sum(c) total_uprn, code from lsoa_h3_uprn_counts
    group by all
    )
    select (c/total_uprn)*population population, h3 from lsoa_h3_uprn_counts hc
    left join lsoa_uprn_counts lc on lc.code = hc.code
    left join ons_lsoa_2022_population pop on pop.code = hc.code
""") # 9 is quite chunky, it would be nice to have it at higher
# df = select_df(con(), """
#     with lsoa_h3_uprn_counts as (
#     select count(*) c, geoToH3(lon, lat, $res) h3, code from uprn_os os
#     inner join (select * from location_h3 where res = $res and type = 'lsoa21') lh on lh.h3 = h3
#     where uprn > 0
#     group by all
#     ),
#     lsoa_uprn_counts as (
#     select sum(c) total_uprn, code from lsoa_h3_uprn_counts
#     group by all
#     )
#     select sum(population) population, h3ToParent(h3, 10) h3 from (
#         select (c/total_uprn)*population population, h3 from lsoa_h3_uprn_counts hc
#         left join lsoa_uprn_counts lc on lc.code = hc.code
#         left join ons_lsoa_2022_population pop on pop.code = hc.code
#     )
#     group by all
# """) # 9 is quite chunky, it would be nice to have it at higher. but 11 is too high
df.index = string.(df.h3, base=16)
df.value = round.(df.population)
df = df[df.value .> 0, :]

#CSV.write("$(homedir())/projects/H3-MON/www/data/new_build_sales_per_1k_pop_yr_apr2024.csv", df[!, [:index, :value]])
# workflow so you don't accidentally overwrite the last thing each time
today = Dates.today()
mkpath("$(homedir())/projects/H3-MON/www/data/$today")
CSV.write("$(homedir())/projects/H3-MON/www/data/$today/lsoa_population_estimate_bigger.csv", df[!, [:index, :value]])


# using CSV
res = 10
years = 10
df = select_df(con(), """
    select geoToH3(lon, lat, $res) h3, median(price) value from land_registry_england lre
    left join uprn_os os on os.uprn = lre.uprn
    where true
    and uprn > 0
    -- and new_build
    and date > now() - interval $years year
    group by all
""")
dropmissing!(df)
df.index = string.(df.h3, base=16)
df = df[df.value .> 0, :]

#CSV.write("$(homedir())/projects/H3-MON/www/data/new_build_sales_per_1k_pop_yr_apr2024.csv", df[!, [:index, :value]])
# workflow so you don't accidentally overwrite the last thing each time
today = Dates.today()
mkpath("$(homedir())/projects/H3-MON/www/data/$today")
CSV.write("$(homedir())/projects/H3-MON/www/data/$today/property_price.csv", df[!, [:index, :value]])

####
#
# just getting column names from census
#
####
select_df(con(), "select distinct display_name from census_2021_data
    where lower(display_name) like '%van%'
    --limit 1 -->:(
") 

select_df(con(), "select count(*), res from location_h3 where type = 'oa21' group by all")
select_df(con(), "select count(*), res from location_h3 where type = 'lsoa21' group by all")

# cool, res 11 or 13 should be fine

####
#
# percentage of car-free households
#
####
using CSV

df = select_df(con(), """
    with oa21_cars as (
        select "2021 output area" code, "No cars or vans in household" zero_cars, Total total --, zero_cars/total percent_zero_cars
        from file('ons_stuff/oa21_cars.csv', CSVWithNames)
    )
    select h3ToParent(h3, 9) h3, sum(zero_cars)/sum(total) value from location_h3 l
    inner join oa21_cars cars on cars.code = l.code
    where type = 'oa21'
    and res = 11
    group by all
""")
dropmissing!(df)
df.index = string.(df.h3, base=16)

#CSV.write("$(homedir())/projects/H3-MON/www/data/new_build_sales_per_1k_pop_yr_apr2024.csv", df[!, [:index, :value]])
# workflow so you don't accidentally overwrite the last thing each time
today = Dates.today()
mkpath("$(homedir())/projects/H3-MON/www/data/$today")
CSV.write("$(homedir())/projects/H3-MON/www/data/$today/no_cars.csv", df[!, [:index, :value]])

####
#
# Sales per capita
#
####
using CSV
res = 9
years = 5
df = select_df(con(), """
    select h3, 1000*c/(population*$years) value from (
        select geoToH3(lon, lat, $res) h3, count(*) c from land_registry_england lre
        left join uprn_os os on os.uprn = lre.uprn
        where true
        and uprn > 0
        --and property_type = 'FLAT'
        --and new_build
        and date > now() - interval $years year
        group by all
    ) lrc
    left join (select h3ToParent(h3, $res) as h3, sum(population) population from population_h3 where res = 9 group by all) pop on lrc.h3 = pop.h3
""")
df.index = string.(df.h3, base=16)
df = df[df.value .<= quantile(df.value, 0.99), :] # i thought this was already supposed to happen
dropmissing!(df)

today = Dates.today()
mkpath("$(homedir())/projects/H3-MON/www/data/$today")
CSV.write("$(homedir())/projects/H3-MON/www/data/$today/sales_per_capita.csv", df[!, [:index, :value]])

####
#
# same but for 5 roomed buildings, approx 3bed
#
###
using CSV
res = 9
years = 5
df = select_df(con(), """
    select h3, 1000*c/(population*$years) value from (
        select geoToH3(lon, lat, $res) h3, count(*) c from land_registry_england lre
        left join uprn_os os on os.uprn = lre.uprn
        left join epc_data_england epc on epc.uprn = lre.uprn
        where true
        and lre.uprn > 0
        and number_habitable_rooms = 5
        --and property_type = 'FLAT'
        --and new_build
        and date > now() - interval $years year
        group by all
    ) lrc
    left join (select h3ToParent(h3, $res) as h3, sum(population) population from population_h3 where res = 9 group by all) pop on lrc.h3 = pop.h3
""")
df.index = string.(df.h3, base=16)
df = df[df.value .<= quantile(df.value, 0.99), :] # i thought this was already supposed to happen
dropmissing!(df)

today = Dates.today()
mkpath("$(homedir())/projects/H3-MON/www/data/$today")
CSV.write("$(homedir())/projects/H3-MON/www/data/$today/sales_per_capita_3beds.csv", df[!, [:index, :value]])

df = select_df(con(), """
    select bedrooms, count(*) c, property_type from vw_rm_listing_events_with_uprns
    where property_type in ('flat', 'semi_detached', 'detached') and bedrooms between 0 and 6 group by all order by bedrooms, property_type
""")


####
#
# time to sell, price per square metre by agent in Lewes
#
####
df = select_df(con(), """
    with lewes as (select h3 from location_h3
        where true
        and type = 'lad23'
        and name = 'Lewes'
        and res = 9
    )
    select agent_name, channel, median(price/bedrooms) price_per_bedroom, count(*) c from (
        select distinct on (rm.id) price, channel, bedrooms, geoToH3(os.lon, os.lat, 9) h3, agent_name from vw_rm_listing_events_with_uprns rm
        left join uprn_os os on os.uprn = rm.uprn
        --left join epc_data_england epc on epc.uprn = rm.uprn
        inner join lewes l on l.h3 = h3
        where rm.uprn > 0
    )
    group by all
    having c > 10
    order by channel, price_per_bedroom desc
""")
using CSV
CSV.write("/mnt/chungus/scratch/lewes_price_per_bedroom_per_agent.csv", df)

####
#
# percentage of car-free households with empty areas removed from map
#
####
using CSV

df = select_df(con(), """
    with oa21_cars as (
        select "2021 output area" code, "No cars or vans in household" zero_cars, Total total --, zero_cars/total percent_zero_cars
        from file('ons_stuff/oa21_cars.csv', CSVWithNames)
    )
    select h3ToParent(h3, 9) h3, sum(zero_cars)/sum(total) value from location_h3 l
    inner join oa21_cars cars on cars.code = l.code
    inner join (
        select geoToH3(lon, lat, 9) h3, count(*) c from urpn_os
        group by all
        having c > 1
    ) uo on uo.h3 = h3
    where type = 'oa21'
    and res = 11
    group by all
""")
dropmissing!(df)
df.index = string.(df.h3, base=16)

#CSV.write("$(homedir())/projects/H3-MON/www/data/new_build_sales_per_1k_pop_yr_apr2024.csv", df[!, [:index, :value]])
# workflow so you don't accidentally overwrite the last thing each time
today = Dates.today()
mkpath("$(homedir())/projects/H3-MON/www/data/$today")
CSV.write("$(homedir())/projects/H3-MON/www/data/$today/no_cars.csv", df[!, [:index, :value]])



####
#
# Walking time to public transport
#
# dining and drinking
# 63be6904847c3692a84b9bb5
#
# retail
# 4d4b7105d754a06378d81259
####
using CSV

select_df(con(), """ select * from foursquare_os_categories where category_name ilike '%trans%' """)
df = select_df(con(), """
    select pls h3, min(dist) value from (
    select h3, t.1 dist, arrayJoin(t.2) pls from (
    select assumeNotNull(h3ToParent(h3_15, 10)) h3, arrayJoin(arrayMap(x->(x, h3HexRing(h3, x)), arrayMap(x->toUInt16(x), range(0,6+1)))) t from foursquare_os_places fop
        where true
        and (has(fsq_category_ids, '4bf58dd8d48988d1fe931735')
            or has(fsq_category_ids, '52f2ab2ebcbc57f1066b8b4f')
            or has(fsq_category_ids, '4bf58dd8d48988d1fd931735')
            or has(fsq_category_ids, '4bf58dd8d48988d12a951735')
            or has(fsq_category_ids, '4bf58dd8d48988d129951735')
            or has(fsq_category_ids, '4bf58dd8d48988d1fc931735')
            or has(fsq_category_ids, '52f2ab2ebcbc57f1066b8b51')
            or has(fsq_category_ids, '4bf58dd8d48988d1ec931735')
            or has(fsq_category_ids, '63be6904847c3692a84b9c2d')
            or has(fsq_category_ids, '63be6904847c3692a84b9c28')
        )
        and country = 'GB'
        )
    )
    group by pls
""")
dropmissing!(df)
df.index = string.(df.h3, base=16)

#CSV.write("$(homedir())/projects/H3-MON/www/data/new_build_sales_per_1k_pop_yr_apr2024.csv", df[!, [:index, :value]])
# workflow so you don't accidentally overwrite the last thing each time
today = Dates.today()
mkpath("$(homedir())/projects/H3-MON/www/data/transport_stops")
CSV.write("$(homedir())/projects/H3-MON/www/data/transport_stops/$today.csv", df[!, [:index, :value]])

# looks like the bus stop data is bad, we'll probably need to use GTFS :(


####
#
# gtfs
#
####

df = select_df(con(), """
    with
    10 as res,
    80 as walk_speed_per_min
    select pls h3, ((2*min(dist)+1)*h3EdgeLengthM(res))/walk_speed_per_min value from (
    select h3, t.1 dist, arrayJoin(t.2) pls from (
    select assumeNotNull(h3ToParent(h3_15, res)) h3, arrayJoin(arrayMap(x->(x, h3HexRing(h3, x)), arrayMap(x->toUInt16(x), range(0,3+1)))) t from transitous_stops_lite
        where true
        and source like 'fr_%'
        )
    )
    group by pls
""")
dropmissing!(df)
df.index = string.(df.h3, base=16)

#CSV.write("$(homedir())/projects/H3-MON/www/data/new_build_sales_per_1k_pop_yr_apr2024.csv", df[!, [:index, :value]])
# workflow so you don't accidentally overwrite the last thing each time
today = Dates.today()
mkpath("$(homedir())/projects/H3-MON/www/data/transport_stops")
write("""$(homedir())/projects/H3-MON/www/data/transport_stops/$today.json""", 
    JSON.json(Dict(
    "t" => "Approximate walking distance to nearest public transport, minutes",
    "flip" => true,
    # "raw" => true,
    "c" => "Transitous et al.",
)))
CSV.write("$(homedir())/projects/H3-MON/www/data/transport_stops/$today.csv", df[!, [:index, :value]])
# basically useless, no measurement of quality

# cool this is a nice measure of goodness, now we just need to make it decay somehow?
df = select_df(con(), """
    select geoToH3(stop_lon, stop_lat, 7) h3, max(value) value from (
        select stop_id, stop_lat, stop_lon, count(*) value from transitous_stop_times_one_day
        where source like 'gb_%'
        group by all
    )
    group by all
""")
dropmissing!(df)
df.index = string.(df.h3, base=16)

#CSV.write("$(homedir())/projects/H3-MON/www/data/new_build_sales_per_1k_pop_yr_apr2024.csv", df[!, [:index, :value]])
# workflow so you don't accidentally overwrite the last thing each time
today = Dates.today()
mkpath("$(homedir())/projects/H3-MON/www/data/transport_stops")
write("""$(homedir())/projects/H3-MON/www/data/transport_stops/$today.json""", 
    JSON.json(Dict(
    "t" => "wip transport goodness",
    "flip" => true,
    # "raw" => true,
    "c" => "Transitous et al.",
)))
CSV.write("$(homedir())/projects/H3-MON/www/data/transport_stops/$today.csv", df[!, [:index, :value]])

# feels like we're getting somewhere, but need not just frequency but where the stuff goes
# to avoid hard cutoffs need to find 30 minute walk radius (2.5 km) and use that (30)
df = select_df(con(), """
    with
    10 as res,
    30 as max_dist,
    -- assume that people walk in "straight lines" at half the speed they walk around buildings, roads etc.
    80/2 as walk_speed_per_min
    select pls h3, min(total_wait) time_to_transport from (
    -- value is number of transport per day, t.1 is distance
    -- average wait time is (18*60)/(number of transport per day * 2) + walking time if we say we're awake for 18 hours and we on average only wait half time
        select h3, (18*60)/(departs_per_day*2) wait_time_at_stop, ((2*(t.1)+1)*h3EdgeLengthM(res))/walk_speed_per_min walk_to_stop, walk_to_stop + wait_time_at_stop total_wait, arrayJoin(t.2) pls from (
            select geoToH3(stop_lon, stop_lat, res) h3, arrayJoin(arrayMap(x->(x, h3HexRing(h3, x)), arrayMap(x->toUInt16(x), range(0,max_dist+1)))) t, max(value) departs_per_day from (
                select stop_id, stop_lat, stop_lon, count(*) value from transitous_everything_stop_times_one_day
                where source like 'gb_%'
                group by all
            )
        group by all
        )
    ) st
    left semi join (select geoToH3(lon, lat, res) h3 from uprn_os) uo on h3 = uo.h3 -- exclude places where zero people live
    group by pls
    having time_to_transport <= 60
""")
dropmissing!(df)
df.index = string.(df.h3, base=16)
today = Dates.today()
df.value = df.time_to_transport ./ 60
mkpath("$(homedir())/projects/H3-MON/www/data/transport_stops")
write("""$(homedir())/projects/H3-MON/www/data/transport_stops/$today.json""", 
    JSON.json(Dict(
    "t" => "Approximate time to walk and board nearest public transport, minutes",
    "flip" => true,
    "raw" => true,
    "c" => "Transitous et al.",
    "scale" => Dict(zip(0.0:0.2:1.0, 0:12:60)),
)))
#CSV.write("$(homedir())/projects/H3-MON/www/data/transport_stops/$today.csv", df[df.value .<= 0.45, [:index, :value]])#, :time_to_transport]])
CSV.write("$(homedir())/projects/H3-MON/www/data/transport_stops/$today.csv", df[!, [:index, :value, :time_to_transport]])

using CSV
df = select_df(con(), """
WITH RECURSIVE
    -- Define the time window: journey must end within 1 hour of input_start_time
    --'8575785' AS start_node, -- morbio
    '8505018:0:1' as start_node, -- meggen zentrum
    4 as max_travel_time,
    20 as max_walk_time,
    parseDateTimeBestEffort('2025-01-01 09:00:00') AS journey_start_time,
    journey_start_time + INTERVAL max_travel_time HOUR AS journey_end_limit_time,
    'ch_opentransportdataswiss25.gtfs' as target_source,
    reachable_destinations AS (
        -- Anchor Member: First hops from the starting source_id
        -- These are direct connections from the input_source_id
        SELECT
            e.next_stop current_node_id,
            e.next_arrival current_arrival_time,
            [start_node, e.next_stop] path_nodes, -- Track path to avoid cycles and for debugging
            1 hop_count
        FROM transitous_everything_edgelist e
        WHERE e.stop_id = start_node
          AND e.departure_time >= journey_start_time   -- Must depart at or after journey start time
          AND e.next_arrival <= journey_end_limit_time -- Must arrive within the 1-hour window
          AND source like 'ch_%'

        UNION ALL

        -- Recursive Member: Subsequent hops
        -- Connects from previously reached destinations
        SELECT
            e.next_stop,
            e.next_arrival,
            arrayPushBack(rd.path_nodes, e.next_stop) AS path_nodes,
            rd.hop_count + 1
        FROM reachable_destinations rd
        JOIN transitous_everything_edgelist e ON rd.current_node_id = e.stop_id -- Join on current node being the next source
        -- To access journey_end_limit_time
        WHERE e.departure_time >= rd.current_arrival_time -- Must depart after arriving at previous node
          AND e.next_arrival <= journey_end_limit_time  -- And new arrival must still be within the overall 1-hour window
          AND NOT has(rd.path_nodes, e.next_stop)           -- Basic cycle prevention (important!)
          AND rd.hop_count < 1000                           -- Max depth to prevent runaway recursion (adjust as needed)
          AND source like 'ch_%'
    )
select arrayJoin(h3) h3, min(travel_time + (h3Distance(h3, stop_h3) / 0.6)) value from (
SELECT current_node_id, dateDiff('minute', journey_start_time, min(current_arrival_time)) travel_time, max_travel_time*60 - travel_time remaining_travel_time, toUInt16(floor(least(remaining_travel_time, max_walk_time) * 0.6)) res_10_radius, any(st.stop_lat) lat, any(st.stop_lon) lon, assumeNotNull(geoToH3(lon, lat, 10)) stop_h3,
--[geoToH3(lon, lat, 9)] h3
h3kRing(stop_h3, assumeNotNull(res_10_radius)) h3
--SELECT current_node_id, min(current_arrival_time)--, any(st.stop_lat), any(st.stop_lon)
FROM reachable_destinations r
-- Optionally, you can filter out the start_node itself if it becomes reachable via a loop
LEFT ANY JOIN transitous_everything_stops st on st.stop_id = r.current_node_id
WHERE current_node_id != start_node
AND source = target_source
GROUP BY current_node_id
ORDER BY current_node_id
)
group by h3
-- ok it's the source= that's the slow bit, this is fine
""")
# need to also include walking time from the source node because it's a bit daft atm
dropmissing!(df)
df.index = string.(df.h3, base=16)
today = Dates.today()
mkpath("$(homedir())/projects/H3-MON/www/data/debug")
write("""$(homedir())/projects/H3-MON/www/data/debug/$today.json""", 
    JSON.json(Dict(
    "t" => "Travel time to destination, minutes",
    "flip" => true,
    # "raw" => true,
    "c" => "Transitous et al.",
    # "scale" => Dict(zip(0.0:0.2:1.0, 0:12:60)),
)))
#CSV.write("$(homedir())/projects/H3-MON/www/data/transport_stops/$today.csv", df[df.value .<= 0.45, [:index, :value]])#, :time_to_transport]])
CSV.write("$(homedir())/projects/H3-MON/www/data/debug/$today.csv", df[!, [:index, :value]])

# times seem very pessimistic -> should work on stop unification



####
#
# Buy to let liquidity vs yield
#
####
using CSV
# goodness: vector distance from (0,0)
df = select_df(con(), """
    with
    rentals as (
        select code, entry_to_agreed_days, price_median,
		percent_rank() over (order by agreed asc) agreed_rank
		from location_kpis_V3_3
        where true
        and price_median > 0
        and type like '%h3%'
        and rolling_year = 0
        and m is null
        and y is null
        and q is null
        and property_type is null
        and bedrooms is null
        and least_of_5_or_bedrooms is null
        and entry_to_agreed_days > 0
        and channel = 'RES_LET'
    ),
    sales as (
        select code, price_median,
		percent_rank() over (order by agreed asc) agreed_rank
		from location_kpis_V3_3
        where true
        and price_median > 0
        and type like '%h3%'
        and rolling_year = 0
        and m is null
        and y is null
        and q is null
        and property_type is null
        and bedrooms is null
        and least_of_5_or_bedrooms is null
        and entry_to_agreed_days > 0
        and channel = 'RES_BUY'
    )
    select
    code index,
    percent_rank() over (order by r.price_median/s.price_median asc) yield_rank,
    percent_rank() over (order by entry_to_agreed_days desc) let_liquidity,
    sqrt(pow(let_liquidity, 2) + pow(yield_rank, 2))/sqrt(2) value
    from rentals r
    left join sales s on s.code = r.code
    where true
	-- exclude low activity areas
	and r.agreed_rank > 0.7
	and s.agreed_rank > 0.7
""")
dropmissing!(df)
today = Dates.today()
mkpath("$(homedir())/projects/H3-MON/www/data/best_let")
write("""$(homedir())/projects/H3-MON/www/data/best_let/$today.json""", 
    JSON.json(Dict(
    "t" => "Propexum let investment score",
    #"flip" => true,
    "raw" => true,
    #"c" => "Transitous et al.",
    # "scale" => Dict(zip(0.0:0.2:1.0, 0:12:60)),
)))
#CSV.write("$(homedir())/projects/H3-MON/www/data/transport_stops/$today.csv", df[df.value .<= 0.45, [:index, :value]])#, :time_to_transport]])
CSV.write("$(homedir())/projects/H3-MON/www/data/best_let/$today.csv", df[!, [:index, :value]])


####
#
# stop unification experiments
#
####

using CSV
df = select_df(con(), """
    select arrayJoin(h3kRing(geoToH3(stop_lon, stop_lat, 11),1)) h3, count() value from transitous_everything_stops
    --where source ilike 'ch%'
    group by h3
""")
dropmissing!(df)
# df.index = string.(df.h3, base=16)
today = Dates.today()
mkpath("$(homedir())/projects/H3-MON/www/data/debug")
# write("""$(homedir())/projects/H3-MON/www/data/debug/$today.json""", 
#     JSON.json(Dict(
#     "t" => "Travel time to destination, minutes",
#     "flip" => true,
#     # "raw" => true,
#     "c" => "Transitous et al.",
#     # "scale" => Dict(zip(0.0:0.2:1.0, 0:12:60)),
# )))
#CSV.write("$(homedir())/projects/H3-MON/www/data/transport_stops/$today.csv", df[df.value .<= 0.45, [:index, :value]])#, :time_to_transport]])
# CSV.write("$(homedir())/projects/H3-MON/www/data/debug/$today.csv", df[!, [:index, :value]])

# not perfect but tbh looks reasonable
import H3.API: kRing, geoToH3, GeoCoord, h3ToParent
unclustered = Set(df.h3) # delete!(set, key); push!(set, key)
clusters = []
done = false
i = 0

function check_neighbours!(start, this_cluster)
    neighbours = intersect(kRing(start, 1), unclustered) # do we allow gaps or not? 1: no gaps, 2: small gaps
    this_ring = Set()
    # n = neighbours[1]
    for n in neighbours
        push!(this_cluster, n)
        push!(this_ring, n)
        delete!(unclustered, n)
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
d.stop_uuid = d.code
# d.res .= CLUSTER_H3_RESOLUTION

# trim small clusters
# dsmall = @view d[d.nrow .> 30, :]

CSV.write("$(homedir())/projects/H3-MON/www/data/debug/$today.csv", d[!, [:index, :value]])
#write("$(homedir())/projects/H3-MON/www/data/meta.json", JSON.json(Dict("scale" => Dict(zip([0, 0.2, 0.4, 0.6, 0.8, 1], quantile.(Ref(dfg.age), [0.0001, 0.2, 0.4, 0.6, 0.8, 0.9999]))))))

# make the stop uuid table
execute(con(),
    """
        CREATE TABLE transitous_everything_stop_uuids
        $(tablespec(sort(enumerate(chtypes(d[!, [:h3, :stop_uuid]]))|>collect, by=x->x[2][1]) .|> x->x[2])) -- sort column names
        ENGINE = MergeTree()
        ORDER BY (h3, code) 
    """
)
insert(con(), "transitous_everything_stop_uuids",[df2dict(d[!, [:h3, :stop_uuid]])])

execute(con(), """
    create table transitous_everything_stop_times_one_day_even_saner
    engine = MergeTree
    order by (source, stop_uuid, sane_route_id, stop_lat, stop_lon, trip_id, arrival_time, departure_time)
    settings allow_nullable_key = 1
    as
    select *, geoToH3(stop_lon, stop_lat, 11) h3 from transitous_everything_stop_times_one_day_sane st
    left join transitous_everything_stop_uuids tu on tu.h3 = h3
""")



####
#
# using the router
#
####
using CSV
df = select_df(con(), """
-- why is this so slow once minutes > 30ish :(
WITH RECURSIVE
    --'8575785' AS start_node, -- morbio
    --'8505018:0:1' as start_node, -- meggen zentrum
    --469887 as start_node, -- luxembourg
    1158217 as start_node, -- morbio
    240 as max_travel_time,
    20 as max_walk_time,
    parseDateTimeBestEffort('2025-01-01 09:10:00') AS journey_start_time,
    journey_start_time + INTERVAL max_travel_time MINUTE AS journey_end_limit_time,
    reachable_destinations AS (
        -- Anchor Member: First hops from the starting source_id
        -- These are direct connections from the input_source_id
        SELECT
            e.next_stop current_node_id,
            e.next_arrival current_arrival_time,
            [start_node, e.next_stop] path_nodes,
            1 hop_count
        FROM transitous_everything_edgelist_sane e
        WHERE e.stop_uuid = start_node
          AND e.departure_time >= journey_start_time
          AND e.next_arrival <= journey_end_limit_time

        UNION ALL

        SELECT
            e.next_stop,
            e.next_arrival,
            arrayPushBack(rd.path_nodes, e.next_stop) AS path_nodes,
            rd.hop_count + 1
        FROM reachable_destinations rd
        JOIN transitous_everything_edgelist_sane e ON rd.current_node_id = e.stop_uuid
        -- To access journey_end_limit_time
        WHERE e.departure_time >= rd.current_arrival_time
          AND e.next_arrival <= journey_end_limit_time
          AND NOT has(rd.path_nodes, e.next_stop)
          AND rd.hop_count < 1000
    )
select arrayJoin(h3) h3, min(travel_time + (h3Distance(h3, stop_h3) / 0.6)) value from (
SELECT current_node_id, dateDiff('minute', journey_start_time, min(current_arrival_time)) travel_time, max_travel_time - travel_time remaining_travel_time,
toUInt16(floor(least(remaining_travel_time, max_walk_time) * 0.6)) res_10_radius, any(st.stop_lat) lat, any(st.stop_lon) lon, assumeNotNull(geoToH3(lon, lat, 10)) stop_h3,
--[geoToH3(lon, lat, 9)] h3
h3kRing(stop_h3, assumeNotNull(res_10_radius)) h3
--SELECT current_node_id, min(current_arrival_time)--, any(st.stop_lat), any(st.stop_lon)
FROM reachable_destinations r
-- Optionally, you can filter out the start_node itself if it becomes reachable via a loop
LEFT ANY JOIN transitous_everything_stop_times_one_day_even_saner st on st.stop_uuid = r.current_node_id
WHERE current_node_id != start_node
GROUP BY current_node_id
ORDER BY current_node_id
)
group by h3
""")
dropmissing!(df)
df.index = string.(df.h3, base=16)
today = Dates.today()
mkpath("$(homedir())/projects/H3-MON/www/data/debug")
# write("""$(homedir())/projects/H3-MON/www/data/debug/$today.json""", 
#     JSON.json(Dict(
#     "t" => "Travel time to destination, minutes",
#     "flip" => true,
#     # "raw" => true,
#     "c" => "Transitous et al.",
#     # "scale" => Dict(zip(0.0:0.2:1.0, 0:12:60)),
# )))
CSV.write("$(homedir())/projects/H3-MON/www/data/debug/$today.csv", df[!, [:index, :value]])



####
#
# router but fast
#
####
using CSV
function find_earliest_arrivals_multithreaded_gdf(df::GroupedDataFrame, start_uuid::Int64, initial_arrival_time::DateTime, cutoff_time::DateTime)
    # Stores the earliest known arrival time for each stop_uuid
    earliest_arrivals = Dict{Int64, DateTime}()
    # Lock to protect access to earliest_arrivals
    arrivals_lock = ReentrantLock() # Or just Lock if reentrant behavior isn't strictly needed

    # Queue of (stop_uuid, arrival_time_at_this_stop) tuples to process in the *next* iteration.
    # Managed by the main thread.
    processing_queue = Tuple{Int64, DateTime}[]

    # Initialize with the starting point
    # Lock is technically not needed here as it's single-threaded initialization,
    # but good practice if we were to modify this part later.
    lock(arrivals_lock)
    try
        earliest_arrivals[start_uuid] = initial_arrival_time
    finally
        unlock(arrivals_lock)
    end
    push!(processing_queue, (start_uuid, initial_arrival_time))

    # Main loop: continues as long as there are nodes to process from the previous iteration
    while !isempty(processing_queue)
        # Nodes discovered in this parallel iteration that need to be processed in the next.
        # A Channel is thread-safe for put! from multiple tasks.
        # The size of the channel can be tuned. Inf for unbounded.
        # Or set to a reasonable estimate like length(df) or number of nodes.
        newly_discovered_channel = Channel{Tuple{Int64, DateTime}}(Inf)

        # Take a snapshot of the current nodes to process in this iteration.
        # Threads will work on this batch.
        current_batch_to_process = copy(processing_queue)
        empty!(processing_queue) # Clear for collecting next iteration's work

        # Distribute the processing of nodes in current_batch_to_process across threads
        # Threads.@threads implicitly waits for all iterations to complete.
        Threads.@threads for (current_uuid, current_arrival_at_stop) in current_batch_to_process
            # Find all possible departures from current_uuid
            # where the departure_time is on or after we arrived at current_uuid
            # This filtering is done per-thread based on its assigned (current_uuid, current_arrival_at_stop)
            !haskey(gdf, (current_uuid,)) && continue
            t = gdf[(current_uuid,)]
            potential_departures = @view t[cutoff_time .>= t.departure_time .>= current_arrival_at_stop, :]

            for depart in eachrow(potential_departures)
                next_stop_id = depart.next_stop
                arrival_at_next_stop = depart.next_arrival

                # Variable to track if we need to add this to the channel
                added_to_channel_for_next_round = false

                # Critical section: Accessing and potentially modifying earliest_arrivals
                lock(arrivals_lock)
                try
                    if !haskey(earliest_arrivals, next_stop_id) || arrival_at_next_stop < earliest_arrivals[next_stop_id]
                        earliest_arrivals[next_stop_id] = arrival_at_next_stop
                        added_to_channel_for_next_round = true # Mark for adding to queue
                    end
                finally
                    unlock(arrivals_lock)
                end

                if added_to_channel_for_next_round
                    # Thread-safe put operation
                    put!(newly_discovered_channel, (next_stop_id, arrival_at_next_stop))
                end
            end
        end # End of @threads for loop

        # Close the channel to signal that no more items will be put by worker threads
        close(newly_discovered_channel)

        # Main thread collects all items from the channel for the next iteration's processing_queue
        for item in newly_discovered_channel
            push!(processing_queue, item)
        end
        # Optional: Deduplicate or further optimize processing_queue here if needed,
        # though the check against earliest_arrivals in the next iteration will handle redundancy.
    end

    return earliest_arrivals
end
@time df = select_df(con(), """
    with
    parseDateTimeBestEffort('2025-01-01 09:00:00') AS journey_start_time,
    300*1000/60 as max_speed_m_per_min,
    8*60 as max_journey_min
    select stop_uuid, h3, next_stop, next_arrival, departure_time from (
    select 
    --geoDistance(stop_lat, stop_lon, 47.0441, 8.3748) crow,
    geoDistance(stop_lat, stop_lon, 45.8570, 9.0230) crow,
    dateDiff('minute', journey_start_time, departure_time) minutes_from_start,
    dateDiff('minute', journey_start_time, next_arrival) aminutes_from_start,
    stop_uuid,
    geoToH3(stop_lon, stop_lat, 7) h3,
    next_stop,
    departure_time,
    next_arrival
    from transitous_everything_edgelist_sane
    where true
    and crow/max_speed_m_per_min < minutes_from_start
    and minutes_from_start between 0 and max_journey_min
    and aminutes_from_start between 0 and max_journey_min
    )
    order by departure_time asc
""");
@time big_df = select_df(con(), """
    select 
    stop_uuid,
    geoToH3(stop_lon, stop_lat, 7) h3,
    next_stop,
    departure_time,
    next_arrival
    from transitous_everything_edgelist_sane
    order by departure_time asc
""");
dropmissing!(big_df)

# todo: start from stop uuid instead
# add a check for max journey time
gdf = groupby(big_df, :stop_uuid)

start_uuid = 217175# df[1, :stop_uuid]	
#start_uuid = 385545
initial_arrival_time = DateTime(2025,01,01,04,00)
for t in initial_arrival_time:Minute(5):initial_arrival_time + Hour(18)
    @time stops = find_earliest_arrivals_multithreaded_gdf(gdf, start_uuid, t, t + Hour(3)); # ~4x quicker. nice
    # 0.006 seconds, l o l
    # oh no at 12 hours this starts to take ~30 seconds
    stops_df = flatten(DataFrame(stop_uuid=keys(stops),arrival_time=values(stops)), [:stop_uuid, :arrival_time])
    leftjoin!(stops_df, combine(gdf, :h3 => first => :h3), on=:stop_uuid)
    dropmissing!(stops_df) # oh, this can happen if we _just_ get to somewhere, i.e. arrive there. whatever, fix later

    stops_df.journey_time = map(x->x.value, round.(stops_df.arrival_time .- t, Minute))
    agg = combine(groupby(stops_df, :h3), :journey_time => minimum => :journey_time)
    agg.index = string.(agg.h3, base=16)
    agg.value = agg.journey_time
    today = Dates.today()
    mkpath("$(homedir())/projects/H3-MON/www/data/debug")
    write("""$(homedir())/projects/H3-MON/www/data/debug/$today.json""", 
        JSON.json(Dict(
        # "t" => "Travel time to destination, minutes",
        "flip" => true,
        # "raw" => true,
        # "c" => "Transitous et al.",
        # "scale" => Dict(zip(0.0:0.2:1.0, 0:12:60)),
    )))
    CSV.write("$(homedir())/projects/H3-MON/www/data/debug/$today.csv", agg[!, [:index, :value]])
    println(t)
    sleep(0.2)
end


# big_df = select_df(con(), """
#     select stop_uuid, next_stop, next_arrival, departure_time from transitous_everything_edgelist_sane ts
#     left join transitous_everything_trips t on ts.trip_id = t.trip_id
#     left join transitous_everything_routes r on t.route_id = r.route_id
#     where true
#     and ((route_type = 2) or (route_type between 100 and 199))
#     and ts.source like 'gb%'
# """)
# import Arrow
# Arrow.write("/mnt/chungus/scratch/edgelist_onlytrains_gb.arrow.arrow", big_df)


# todo: 
# - make a little api that finds the nearest stop for a given lat/lon and then returns the h3 and journey time, glue to h3-mon
# - separate router into separate package that takes arrow file
# - get stop lat/lons separately?


####
#
# Main commercial use
#
####
## get gemini to make a case statement to conslidate these

df2 = select_df(con(), """
    select property_type, count(*) c from epc_data_england where uprn > 0 and epc_type = 'commercial' group by property_type
    order by c desc
""")

expo_type = "commercial_epc_type"
res = 11
df = select_df(con(), """
    select 
    -- anyHeavy(property_type) property_type,
    CASE -- thanks google gemini
        WHEN multiSearchAny(lower(property_type), ['retail', 'financial/professional services']) THEN 'Retail & Financial Services'
        WHEN multiSearchAny(lower(property_type), ['offices', 'workshop']) THEN 'Office & Workshop'
        WHEN multiSearchAny(lower(property_type), ['restaurant', 'cafes', 'drinking establishments', 'hot food takeaways', 'public house']) THEN 'Food & Beverage'
        WHEN multiSearchAny(lower(property_type), ['storage', 'distribution', 'warehouse', 'industrial']) THEN 'Industrial & Storage'
        WHEN multiSearchAny(lower(property_type), ['hotel']) THEN 'Hotel'
        WHEN multiSearchAny(lower(property_type), ['residential institutions', 'hospitals', 'care homes', 'residential schools', 'universities and colleges', 'secure residential institutions', 'nursing residential homes', 'hostels']) THEN 'Residential Institutions'
        WHEN multiSearchAny(lower(property_type), ['non-residential institutions', 'education', 'primary health care', 'community/day centre', 'libraries museums and galleries', 'crown and county courts']) THEN 'Public & Community Services'
        WHEN multiSearchAny(lower(property_type), ['assembly and leisure', 'night clubs', 'theatres', 'sports centre', 'social clubs', 'sports ground arena']) THEN 'Leisure & Entertainment'
        WHEN multiSearchAny(lower(property_type), ['passenger terminals', 'airport terminals', 'bus station', 'train station', 'seaport terminal', 'car parks']) THEN 'Transportation'
        ELSE 'Other'
    END AS category,
    geoToH3(lon, lat, $res) h3
    from epc_data_england epc
    inner join (select uprn, max(lodgement_datetime) lodgement_datetime from epc_data_england where uprn > 0 and epc_type = 'commercial' group by uprn) epc2 on epc.uprn = epc2.uprn and epc.lodgement_datetime = epc2.lodgement_datetime -- only most recent EPC
    left join uprn_os os on os.uprn = epc.uprn
    group by all
""")
using CSV
df.index = string.(df.h3, base=16)

# assign colours by ... weird function of string length
transform!(groupby(df, :category), :category => (x -> sum.(collect.(x) .|> t -> UInt.(t))) => :pls)
df.value = df.pls
today = Dates.today()
mkpath("$(homedir())/projects/H3-MON/www/data/$expo_type")
write("""$(homedir())/projects/H3-MON/www/data/$expo_type/$today.json""", 
    JSON.json(Dict(
    "t" => "Most common business type",
    #"flip" => true,
    #"raw" => true,
    "c" => "MCHLG",
    # "scale" => Dict(zip(0.0:0.2:1.0, 0:12:60)),
)))
CSV.write("$(homedir())/projects/H3-MON/www/data/$expo_type/$today.csv", df[:, [:index, :value, :category]]) 


####
#
# Fish shops per capita
#
####

using CSV
expo_type = "fish_shops_per_capita"

res = 6
df = select_df(con(), """
    select geoToH3(longitude, latitude, $res) h3_f, count(*) fishes, population, fishes/population fp from foursquare_os_places fop
    left join (select h3ToParent(h3, $res) as h3, sum(population) population from population_h3 where res = 9 group by all) pop on h3_f = pop.h3
    -- left join (select h3ToParent(h3, $res) as h3, sum(population) population from population_h3_11 group by all) pop on h3_f = pop.h3
    where true
    -- and country = 'GB'
    and (false
        or name ilike '%fish%'
        or name ilike '%poisson%' -- french
        or name ilike '%fisch%' -- german
        or name ilike '%pesci%' -- italian
        or name ilike '%ryba%' -- czech
        or name ilike '%pez%' -- spain
    )
    group by all
    having true 
    and population > 0
    and fishes > 0
    order by population asc
""")
dropmissing!(df)
df.value = df.fp
df.index = string.(df.h3_f, base=16)

today = Dates.today()
mkpath("$(homedir())/projects/H3-MON/www/data/$expo_type")
write("""$(homedir())/projects/H3-MON/www/data/$expo_type/$today.json""", 
    JSON.json(Dict(
    "t" => "Fish shops per capita",
    #"flip" => true,
    #"raw" => true,
    "c" => "Foursquare",
    # "scale" => Dict(zip(0.0:0.2:1.0, 0:12:60)),
)))
CSV.write("$(homedir())/projects/H3-MON/www/data/$expo_type/$today.csv", df[:, [:index, :value]]) 


####
# listing sold -> lr sold dates
#
# conclusions thus far: grouping by:
# - bedrooms,
# - property type,
# - location,
# - is_chain_free
# doesn't help
####
using CSV
res = 7
dfr = select_df(con(), """
    select max(event_timestamp) stc_date, any(property_type) property_type, any(bedrooms) bedrooms, geoToH3(any(lon), any(lat), $res) h3, uprn, lr.last_sale, dateDiff('day', stc_date, lr.last_sale) stc_to_last_sale_days, any(is_chain_free) is_chain_free from (
        select * from (
            select uprn, id, event_timestamp, display_status, property_type, bedrooms, lat, lon, position(lower(description), 'chain') is_chain_free,
            lagInFrame(display_status, 1, display_status) OVER (PARTITION BY id ORDER BY event_timestamp ASC
                ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
            ) AS previous_status
            from vw_rm_listing_events_with_uprns
            where channel = 'RES_BUY'
            and uprn != 0
        )
        where true
        and (false
            or previous_status = ''
            or previous_status = 'Under Offer'
        )
        and display_status = 'Sold STC'
        order by event_timestamp desc
    ) rm
    left join (select max(date) last_sale, uprn from land_registry_england where uprn != 0 group by all) lr on lr.uprn = rm.uprn
    group by all
    having stc_to_last_sale_days > 0 -- exclude estate agents who sent this weirdly right after completion hmm but we want to count actual failures too
""")

# sort!(combine(groupby(df[df.bedrooms .< 4, :], [:property_type, :bedrooms]), :stc_to_last_sale_days => iqr), [:property_type, :bedrooms])
dropmissing!(dfr)
df = combine(groupby(dfr, :h3), :stc_to_last_sale_days => iqr, nrow)
df = df[df.nrow .> 9.5, :] # drop low certainty areas

df.value = df.stc_to_last_sale_days_iqr
df.index = string.(df.h3, base=16)

expo_type = "stc_to_keys_uncertainty"
today = Dates.today()
mkpath("$(homedir())/projects/H3-MON/www/data/$expo_type")
write("""$(homedir())/projects/H3-MON/www/data/$expo_type/$today.json""", 
    JSON.json(Dict(
    "t" => "IQR of days from STC to exchange of keys",
    "flip" => true,
    #"raw" => true,
    "c" => "HMLR",
    # "scale" => Dict(zip(0.0:0.2:1.0, 0:12:60)),
)))
CSV.write("$(homedir())/projects/H3-MON/www/data/$expo_type/$today.csv", df[:, [:index, :value]]) 
