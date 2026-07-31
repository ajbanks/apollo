#!/bin/julia

using DataFrames, Dates, Statistics, ThreadsX
include((@__DIR__) * "/../lib.jl")
include((@__DIR__) * "/../nearby/property_lookup.jl")


# todo: think about ergonomics
# can do a CSV each day
# probably makes sense to read previous CSVs up to e.g. a week old? and only output new leads into a new CSV
# so: read all previous CSVs, remove any identical rows, output CSV as _today and _date

function update_hot_leads()
    execute(con(), """
         create view if not exists vw_rm_listing_events_with_uprns_daily as (select * from rm_active_listings rle left join listing_uprn_map lup on rle.id = lup.listing_id)
     """)

    id2url = id -> " https://www.rightmove.co.uk/properties/$(id[4:end]) " # move to lib maybe, extra space for easy clicking. probably will be annoying for JS side

    # get all the listings added in the last week
    cols = ["uprn", "price", "event_timestamp", "display_status", "property_type", "bedrooms"]
    df = select_df(con(), """
        SELECT id, channel, untuple(argMax(($(join(cols, ","))), event_timestamp)) as t
        from vw_rm_listing_events_with_uprns_daily 
        where event_timestamp > now() - interval 1 week
        and uprn > 0
        and channel = 'RES_BUY' -- only look at sales for now
        and property_type != 'retirement'
        group by id, channel
    """)

    df.url = id2url.(df.id)

    rename!(df, map(p -> Pair(Symbol("t.$(p[1])"), p[2]), enumerate(cols)))

    df = df[df.display_status .== "", Not(:display_status)] # drop all sold etc ones

    avms = ThreadsX.map(doavm, df.uprn) # takes a few minutes, should consider optimising this / adding a progress bar


    # df[hasfield.(typeof.(avms), :error), :uprn][1] # e.g. 0x000000174916bb1a seems to be a real EOFError, investigate further

    # bin erroring rows for now
    df = df[.!hasfield.(typeof.(avms), :error), :]
    avms = avms[.!hasfield.(typeof.(avms), :error)]
    df.bmv = 1 .- df.price ./ getfield.(getfield.(avms, :sales), :estimate)
    df.valuation = getfield.(getfield.(avms, :sales), :estimate)
    df.yield = (12 .* getfield.(getfield.(avms, :rents), :estimate)) ./ df.price

    df.plot_area_sqm = parse.(Float32, (x -> hasfield(typeof(x), :known) ? get(x.known, "plot_area_sqm", "-1.0") : "-1.0").(avms))
    df.garden_area_sqm = parse.(Float32, (x -> hasfield(typeof(x), :known) ? get(x.known, "garden_area_sqm", "-1.0") : "-1.0").(avms))

    # add population
    locs = mapreduce(uprns -> select_df(con(), """
        select uprn, lon, lat, geoToH3(lon, lat, 9) h3, population from uprn_os os
        left join population_h3 pop on pop.h3 = h3
        where uprn in $uprns
        and pop.res = 9
    """), vcat, Iterators.map(julia2clickhouse, Iterators.partition(df.uprn, MAX_CLICKHOUSE_QUERY_SIZE)))

    leftjoin!(df, locs, on = :uprn)
    # looks like ~>500 is an urban area
    dropmissing!(df, :population) # there's only two, who cares


    # add floor areas, epc rating
    floor_areas = mapreduce(uprns -> select_df(con(), """
        select uprn, total_floor_area, number_habitable_rooms, current_energy_efficiency
        from epc_data_england
        where uprn in $uprns
        order by inspection_date desc
    """), vcat, Iterators.map(julia2clickhouse, Iterators.partition(df.uprn, MAX_CLICKHOUSE_QUERY_SIZE)))

    floor_areas = floor_areas[.!nonunique(floor_areas, :uprn, keep=:first), :] 

    leftjoin!(df, floor_areas, on = :uprn)  


    # add prev sale price
    landreg = mapreduce(uprns -> select_df(con(), """
        select uprn, price as previous_sale
        from land_registry_england
        where uprn in $uprns
        order by date desc
    """), vcat, Iterators.map(julia2clickhouse, Iterators.partition(df.uprn, MAX_CLICKHOUSE_QUERY_SIZE)))
    landreg = landreg[.!nonunique(landreg, :uprn, keep=:first), :]
    leftjoin!(df, landreg, on = :uprn)

    ####
    #
    # High yield
    #
    ####
    high_yield = copy(df[df.yield .> 0.15, :]) # human needs to go through, there are some real ones
    high_yield.lead_type .= "high_yield"
    deals = high_yield

    ####
    #
    # Well below market value
    #
    ####
    below_market_value = copy(df[df.bmv .> 0.25, :])
    below_market_value.lead_type .= "below_market_value"
    deals = vcat(deals, below_market_value)

    # select_df(con(), "select * from uprn_os order by uprn limit 10")
    # # # this is bad
    # # julia> select_df(con(), "select * from uprn_os order by uprn limit 10")
    # # ERROR: EOFError: read end of file
    # # # dbeaver works but clickhouse-client doesn't

    # doavm(df.uprn[1]) # ... fuck, this was working, somehow the database has got messed up?
    # select_df(con(), "select * from uprn_os order by uprn limit 10")  # ... it's working again. so that's nice

    # locs = mapreduce(uprns -> select_df(con(), "select lat, lon from uprn_os where uprn in $uprns"), vcat, Iterators.map(julia2clickhouse, Iterators.partition(df.uprn, MAX_CLICKHOUSE_QUERY_SIZE))) # do we care?

    # median(filter(>(0),parse.(Float32, (x -> hasfield(typeof(x), :known) ? get(x.known, "plot_area_sqm", "-1.0") : "-1.0").(avms)))) # median is 350 so i guess big is 700?

    # median(filter(>(0),parse.(Float32, (x -> hasfield(typeof(x), :known) ? get(x.known, "garden_area_sqm", "-1.0") : "-1.0").(avms)))) # median is 250 so i guess big is 500?

    ####
    #
    # large gardens / large plot sizes in urban areas
    #
    ###
    big_gardens = copy(df[(df.population .> 500) .&& (df.garden_area_sqm .> 500), :]) # this seems to work pretty well
    big_gardens.lead_type .= "big_gardens"
    deals = vcat(deals, big_gardens)

    big_plots = copy(df[(df.population .> 500) .&& (df.garden_area_sqm .> 0) .&& (df.plot_area_sqm .> 700), :])  # .> 0 filters out non-freeholds, also seems to work well
    big_plots.lead_type .= "big_plots"
    deals = vcat(deals, big_plots)


    # headinsand(p->quantile(p, 0.25))(df[(df.property_type .== "flat") .&& replace((df.bedrooms .== 2), missing => false), :total_floor_area]) # => 55m2 for 2 bedrooms, 40 for 1 bedroom

    ####
    #
    # 1 -> 2 flat conversions
    #
    ####
    one_bed_two_bed_conversion = copy(df[(df.property_type .== "flat") .&&
        replace((df.bedrooms .== 1), missing => false) .&&
        replace(df.total_floor_area .>= 55, missing => false),
    :])
    one_bed_two_bed_conversion.lead_type .= "one_bed_two_bed_conversion"
    deals = vcat(deals, one_bed_two_bed_conversion)

    ####
    #
    # .<= 3 beds with EPC < 69 (illegal from 2030 in theory) but not by much and highish yield
    # in urban areas
    #
    ####
    epc_rental_refurb_2030 = copy(df[
        replace((df.bedrooms .< 3), missing => false) .&&
        replace(55 .<= df.current_energy_efficiency .< 69, missing => false) .&&
        replace(df.population .> 400, missing => false) .&&
        df.yield .> 0.05,
    :])
    epc_rental_refurb_2030.lead_type .= "epc_rental_refurb_2030"
    deals = vcat(deals, epc_rental_refurb_2030)

    ####
    #
    # .<= 3 beds with EPC <= 38 (illegal to rent) but not by much and highish yield
    # in urban areas
    #
    ####
    epc_rental_refurb_now = copy(df[
        replace((df.bedrooms .< 3), missing => false) .&&
        replace(30 .<= df.current_energy_efficiency .< 38, missing => false) .&&
        replace(df.population .> 400, missing => false) .&&
        df.yield .> 0.05,
    :])
    epc_rental_refurb_now.lead_type .= "epc_rental_refurb_now"
    deals = vcat(deals, epc_rental_refurb_now)


    ####
    #
    # negative equity
    #
    ####
    negative_equity = copy(df[df.previous_sale .> (1.1 .* df.price), :])
    negative_equity.lead_type .= "negative_equity"
    deals = vcat(deals, negative_equity)


    ###
    #
    # upload the table
    #
    ###
    deals.previous_sale = Float64.(deals.previous_sale)
    deals.date_calculated .= Dates.now()
    execute(con(), """
    CREATE TABLE IF NOT EXISTS hot_leads_yesterday
        $(tablespec(chtypes(deals)))
    ENGINE = MergeTree()
    ORDER BY (channel, lead_type, date_calculated, h3, lat, lon, uprn)
    SETTINGS allow_nullable_key = 1
    """)
    execute(con(), """
    CREATE TABLE IF NOT EXISTS hot_leads
        $(tablespec(chtypes(deals)))
    ENGINE = MergeTree()
    ORDER BY (channel, lead_type, date_calculated, h3, lat, lon, uprn)
    SETTINGS allow_nullable_key = 1
    """)
    execute(con(), "TRUNCATE TABLE IF EXISTS hot_leads_yesterday")
    insert(con(), "hot_leads_yesterday", [df2dict(deals)])
    execute(con(), "exchange TABLES hot_leads_yesterday and hot_leads")

    execute(con(), """create view if not exists vw_hot_leads_new_today as
        select * except date_calculated from hot_leads
        except select * except date_calculated from hot_leads_yesterday
        --where date_calculated < now() - interval 22 hour -- insurance against the leads being regenerated too quickly
    """)
    return true
end




# ####
# #
# # only brighton
# #
# ####

# ## brighton area h3s
# brighton_h3_5 = [0x0851959b7fffffff, 0x085194a7bfffffff, 0x085194a73fffffff, 0x085194a0ffffffff, 0x085194a4ffffffff, 0x085194a47fffffff, 0x085194a0bfffffff] # res 5

# string(brighton_h3_5)[8:end-1] # extract actual uint64 hex

# # brighton_h3_9 = select_df(con(), "select arrayJoin(arrayJoin(arrayMap(x->h3ToChildren(x, 9), [$(string(brighton_h3_5)[8:end-1])]))) as h3") # get list of h3s at higher resolution

# df2 = select_df(con(), """
#     SELECT id, channel, untuple(argMax(($(join(cols, ","))), event_timestamp)) as t
#     from vw_rm_listing_events_with_uprns_daily 
#     where event_timestamp > now() - interval 1 month
#     and uprn > 0
#     and channel = 'RES_BUY' -- only look at sales for now
#     and property_type != 'retirement'
#     and geoToH3(lon, lat, 9) in (select arrayJoin(arrayJoin(arrayMap(x->h3ToChildren(x, 9), [$(string(brighton_h3_5)[8:end-1])]))))
#     group by id, channel
# """)
# df2.url = id2url.(df2.id)

# rename!(df2, map(p -> Pair(Symbol("t.$(p[1])"), p[2]), enumerate(cols)))

# df2 = df2[df2.display_status .== "", Not(:display_status)] # drop all sold etc ones

# avms2 = ThreadsX.map(doavm, df2.uprn) # takes a few minutes, should consider optimising this / adding a progress bar

# df2[hasfield.(typeof.(avms2), :error), :uprn][1] # e.g. 0x000000174916bb1a seems to be a real EOFError, investigate further

# # bin erroring rows for now
# df2 = df2[.!hasfield.(typeof.(avms2), :error), :]
# avms2 = avms2[.!hasfield.(typeof.(avms2), :error)]
# df2.bmv = 1 .- df2.price ./ getfield.(getfield.(avms2, :sales), :estimate)
# df2.valuation = getfield.(getfield.(avms2, :sales), :estimate)
# df2.yield = (12 .* getfield.(getfield.(avms2, :rents), :estimate)) ./ df2.price

# ####
# #
# # High yield
# #
# ####
# df2[df2.yield .> 0.15, :url] # one removed, one retirement

# ####
# #
# # Well below market value
# #
# ####
# df2[df2.bmv .> 0.35, :url] # at this level, 50% retirement, 50% very large, hard to value

# # select_df2(con(), "select * from uprn_os order by uprn limit 10")
# # # # this is bad
# # # julia> select_df2(con(), "select * from uprn_os order by uprn limit 10")
# # # ERROR: EOFError: read end of file
# # # # dbeaver works but clickhouse-client doesn't

# # doavm(df2.uprn[1]) # ... fuck, this was working, somehow the database has got messed up?
# # select_df2(con(), "select * from uprn_os order by uprn limit 10")  # ... it's working again. so that's nice

# # locs = mapreduce(uprns -> select_df2(con(), "select lat, lon from uprn_os where uprn in $uprns"), vcat, Iterators.map(julia2clickhouse, Iterators.partition(df2.uprn, MAX_CLICKHOUSE_QUERY_SIZE))) # do we care?

# df2.plot_area_sqm = parse.(Float32, (x -> hasfield(typeof(x), :known) ? get(x.known, "plot_area_sqm", "-1.0") : "-1.0").(avms2))
# df2.garden_area_sqm = parse.(Float32, (x -> hasfield(typeof(x), :known) ? get(x.known, "garden_area_sqm", "-1.0") : "-1.0").(avms2))

# # add population
# locs = mapreduce(uprns -> select_df(con(), """
#     select uprn, lon, lat, geoToH3(lon, lat, 9) h3, population from uprn_os os
#     left join population_h3 pop on pop.h3 = h3
#     where uprn in $uprns
#     and pop.res = 9
# """), vcat, Iterators.map(julia2clickhouse, Iterators.partition(df2.uprn, MAX_CLICKHOUSE_QUERY_SIZE)))

# leftjoin!(df2, locs, on = :uprn)
# # looks like ~>500 is an urban area
# dropmissing!(df2, :population)

# ####
# #
# # large gardens / large plot sizes in urban areas
# #
# ###
# df2[(df2.population .> 500) .&& (df2.garden_area_sqm .> 500), :url] # this seems to work pretty well
# df2[(df2.population .> 400) .&& (df2.garden_area_sqm .> 0) .&& (df2.plot_area_sqm .> 700), :url]  # .> 0 filters out non-freeholds, also seems to work well


# # add floor areas, epc rating
# floor_areas = mapreduce(uprns -> select_df(con(), """
#     select uprn, total_floor_area, number_habitable_rooms, current_energy_efficiency
#     from epc_data_england
#     where uprn in $uprns
#     order by inspection_date desc
# """), vcat, Iterators.map(julia2clickhouse, Iterators.partition(df2.uprn, MAX_CLICKHOUSE_QUERY_SIZE)))

# floor_areas = floor_areas[.!nonunique(floor_areas, :uprn, keep=:first), :] 

# leftjoin!(df2, floor_areas, on = :uprn)  


# headinsand(p->quantile(p, 0.25))(df2[(df2.property_type .== "flat") .&& replace((df2.bedrooms .== 2), missing => false), :total_floor_area]) # => 55m2 for 2 bedrooms, 40 for 1 bedroom

# ####
# #
# # 1 -> 2 flat conversions
# #
# ####
# df2[(df2.property_type .== "flat") .&&
#     replace((df2.bedrooms .== 1), missing => false) .&&
#     replace(df2.total_floor_area .>= 55, missing => false),
# :url]

# ####
# #
# # .<= 3 beds with EPC < 69 (illegal from 2030 in theory) but not by much and highish yield
# # in urban areas
# #
# ####
# df2[
#     replace((df2.bedrooms .< 3), missing => false) .&&
#     replace(55 .<= df2.current_energy_efficiency .< 69, missing => false) .&&
#     replace(df2.population .> 400, missing => false) .&&
#     df2.yield .> 0.05,
# :url]

# ####
# #
# # .<= 3 beds with EPC <= 38 (illegal to rent now) but not by much and highish yield
# # in urban areas
# #
# ####
# df2[
#     replace((df2.bedrooms .< 3), missing => false) .&&
#     replace(30 .<= df2.current_energy_efficiency .< 38, missing => false) .&&
#     replace(df2.population .> 400, missing => false) .&&
#     df2.yield .> 0.05,
# :url]


# landreg = mapreduce(uprns -> select_df(con(), """
#     select uprn, price as previous_sale
#     from land_registry_england
#     where uprn in $uprns
#     order by date desc
# """), vcat, Iterators.map(julia2clickhouse, Iterators.partition(df2.uprn, MAX_CLICKHOUSE_QUERY_SIZE)))
# landreg = landreg[.!nonunique(landreg, :uprn, keep=:first), :]
# leftjoin!(df2, landreg, on = :uprn)


# ####
# #
# # negative equity
# #
# ####
# df2[df2.previous_sale .> (1.1 .* df2.price), :url]
