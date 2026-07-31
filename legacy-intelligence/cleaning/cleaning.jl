#!/bin/julia

using DataFrames, Dates, Statistics, ThreadsX
include((@__DIR__) * "/../lib.jl")
include((@__DIR__) * "/../habitable_rooms/habitable_rooms.jl")

# execute(con(), "drop view if exists epc_lite")
# # these should probably be materialized
# execute(con(), """
#     create view if not exists epc_lite as (SELECT distinct on (uprn) * FROM (select uprn, total_floor_area, number_habitable_rooms, property_type from epc_data_england WHERE uprn != 0 order by inspection_date desc))
# """)
# execute(con(), """
#     create view if not exists vw_rm_listing_events_with_uprns as (select * from rm_listing_events rle left join listing_uprn_map lup on rle.id = lup.listing_id)
# """)

function update_properties()
    property_types = select_df(con(), "select distinct(property_type) from vw_rm_listing_events_with_uprns").property_type
    property_types = filter(x -> x !== "", property_types) # drop "" property type which includes stuff like caravans
    # select_df(con(), "select property_type, property_subtype, count(*) c from raw.rm_listing_events where channel NOT LIKE 'COM_%' group by all order by c desc")

    # clickhouse might run out of ram - need to swap the join over, probably?
    target_properties = reduce(vcat, ThreadsX.map(property_type -> begin
        query = """
            SELECT channel, display_status, uprn, price, id, event_timestamp as date, lat, lon, property_type, bedrooms, bathrooms, postcode, total_floor_area, number_habitable_rooms, property_subtype,
            $(join(map(res -> "geoToH3(lon, lat, $res) as h3_$res", H3_PERMITTED_RESOLUTIONS), ','))
            FROM (
                select * from vw_rm_listing_events_with_uprns
                WHERE channel NOT LIKE 'COM_%'
                AND property_type = '$property_type'
                AND property_subtype != 'caravan'
                AND not auction
            ) rm
            LEFT OUTER JOIN epc_lite epc -- only use latest report per uprn
            ON rm.uprn = epc.uprn
        """
        select_df(con(), query)
    end, property_types))

    sort!(target_properties, :date, rev=true) # why is this single threaded

    # tidy up studios: if property_subtype is studio then bedrooms = 0, if number_habitable_rooms = 1 then bedrooms = 0
    target_properties[replace(target_properties.number_habitable_rooms .== 1, missing => 0) .|> Bool, :bedrooms] .= 0
    target_properties[replace(target_properties.property_subtype .== "Studio", missing => 0) .|> Bool, :bedrooms] .= 0

    rightmove2lrew = Dict(r.rm_type => r.lrew_type for r in eachrow(select_df(con(), "select lower(lrew_type) lrew_type, lower(property_type) rm_type from lrew_property_type_map")) if !ismissing(r.lrew_type))

    # canonicalise property types
    target_properties.property_type = ThreadsX.map(t -> get(rightmove2lrew, t, ""), target_properties.property_type)


    # land_reg data to get eventual sale date for RM properties
    land_reg = select_df(con(), """
    select DISTINCT ON (uprn) uprn, price as clear_price, date as clear_date
    from (select uprn, price, date from land_registry_england where uprn > 0 and toYear(date) > 2021 order by date desc) -- 2021 since we don't have any data from before then
    """)

    # land_reg_all is for all properties, even where we don't have uprns
    # x + 1 => x - 1 is a hack: default value is zero, so this way missing values = -1 rather than getting mixed in with true x = 0 
    # potentially dangerous: latitude hardcoded to 20 minimum
    # nb: don't use lon 0.0 check because it could be real
    # some scottish data in here, there shouldn't be...
    #
    # time_in_market = 0 makes the kpis think that these properties truly sold
    # earliest_lre_date = "2021-01-01" # TODO: simon wants this reduced to include all the data we have, but it's unbearably slow
    earliest_lre_date = "1994-12-25"
    land_reg_all = select_df(con(), """
    -- NB: need to make an epc_property_type -> rm property_type mapping; this is not the same
    select lre2.uprn as uprn, epc_property_type, lower(lre2.property_type) as property_type, number_habitable_rooms - 1 as number_habitable_rooms, if(um.lat > 20, um.lon, pm.lon) as lon, if(um.lat > 20, um.lat, pm.lat) as lat, bedrooms - 1 as bedrooms, -1 as bathrooms, 'LREW_BUY' as channel, lre2.postcode as postcode, lre2.price as price, -1 as clear_price, toDate('1990-01-01') as clear_date, lre2.total_floor_area as total_floor_area, -1 as time_to_clear, lre2.date as listed_date, lre2.date as date, 0 as time_in_market, concat('lrew_', lre2.transaction_id) as id, '' as display_status,
    $(join(map(res -> "geoToH3(lon, lat, $res) as h3_$res", H3_PERMITTED_RESOLUTIONS), ','))
    from (select uprn, postcode, price, date, number_habitable_rooms + 1 as number_habitable_rooms, total_floor_area, epc.property_type as epc_property_type, property_type, transaction_id
    from (select uprn, price, date, postcode, property_type, transaction_id from land_registry_england where date > '$earliest_lre_date' order by date desc) lre
    LEFT OUTER JOIN epc_lite epc
    ON lre.uprn = epc.uprn) lre2
    left outer join uprn_os um on lre2.uprn = um.uprn
    left join postcode_meta pm on lower(pm.postcode) = lower(lre2.postcode)
    left join (select distinct(uprn), lat, lon, bedrooms+1 as bedrooms from vw_rm_listing_events_with_uprns where uprn > 0 and bedrooms is not null) pct on pct.uprn = lre2.uprn
    """)

    # duplicates are reappearing here somehow
    # why fix what we can patch
    land_reg_all = land_reg_all[.!nonunique(land_reg_all, :id, keep=:first), :]

    # on 21/07/2024 this view was empty, which is suspicious. how can that be possible? probably because of the circular dependency that was removed in jan 2025
    # on 14/01/2025 instead it was full of missings
    land_reg_all.bedrooms = replace(land_reg_all.bedrooms, missing => -1)
    land_reg_all.number_habitable_rooms = replace(land_reg_all.number_habitable_rooms, missing => -1)
    unknown_beds = @view land_reg_all[(land_reg_all.bedrooms .== -1) .&& (land_reg_all.number_habitable_rooms .> 0), :]
    unknown_beds.bedrooms = getfield.(predict_bedsbaths.(unknown_beds.number_habitable_rooms, unknown_beds.epc_property_type), :bedrooms)


    maybelast(x) = length(x) > 0 ? last(x) : nothing
    # merge listing events
    target_properties = combine(groupby(target_properties, [:id, :channel]), property -> begin
                # ~50% of properties never get this set
                sale_date = property[in.(property.display_status, Ref(["Let agreed", "Sold STC"])), :date] |> maybelast
                # we're using first listed date -> first sold date, so we will miss any relisted properties. would be better to split on sale dates to track multiple relistings
                recent_date = isnothing(sale_date) ? first(property.date) : sale_date # should probably use last() here?
                recent_or_sold = property[property.date .== recent_date, :] |> first
                listed_date = last(property).date
                # include exit date - don't need since date is exit date is date if time in market exists
                time_in_market = isnothing(sale_date) ? -1 : round(sale_date - listed_date, Day).value
                (listed_date = listed_date, time_in_market = time_in_market, recent_or_sold...)
    end)

    # rm.130332701 is weird looking: eyeballing it it should be listed on 2023-01-03 and let on 2023-01-19 but it gets clear_date = listed_date even though time_in_market is correct
    # wait, clear_date is land registry sale date, shit. we need 'date'

    # why do i have missings suddenly >:((
    target_properties.bathrooms = replace(passmissing(Int64).(target_properties.bathrooms), missing => -1)
    target_properties.bedrooms = replace(passmissing(Int64).(target_properties.bedrooms), missing => -1)
    target_properties.number_habitable_rooms = replace(passmissing(Int64).(target_properties.number_habitable_rooms), missing => -1)

    for table in [target_properties, land_reg_all]
        table.month = month.(table.date)
        table.week = week.(table.date)
        table.year = year.(table.date)
        table.quarter = quarterofyear.(table.date)
        table.total_floor_area = replace(passmissing(Float64).(table.total_floor_area), missing => 0.0)
        table.price_per_sqm .= 0.0
        nonzero_area = @view table[table.total_floor_area .> 0, :]
        nonzero_area.price_per_sqm = nonzero_area.price ./ nonzero_area.total_floor_area
    end

    leftjoin!(target_properties, land_reg, on=:uprn)

    target_properties.clear_date = collect(Missings.replace(target_properties.clear_date, Date(1990)))
    target_properties.clear_price = Int64.(collect(Missings.replace(target_properties.clear_price, -1)))
    target_properties.time_to_clear .= -1


    # properties that have truly sold
    sold = @view target_properties[(target_properties.clear_date .> target_properties.listed_date) .&& (target_properties.channel .== "RES_BUY"), :] # exclude lettings
    sold.time_to_clear = getfield.(round.(sold.clear_date .- sold.listed_date, Day), :value)

    # # todo: make this more robust
    # blah = Set(names(target_properties))
    # blah2 = Set(names(land_reg_all))
    # setdiff(blah, blah2)
    land_reg_all.property_subtype .= ""


    target_properties = vcat(target_properties, land_reg_all[!, Symbol.(names(target_properties))])

    # get rid of DecFPs, where do they even come from?
    target_properties.price_per_sqm = Float64.(target_properties.price_per_sqm)
    target_properties.price = Float64.(target_properties.price)

    # bedrooms became "Any" somehow once
    target_properties.bedrooms = Int.(target_properties.bedrooms)

    # somehow missings keep creeping in
    target_properties.uprn = replace(target_properties.uprn, missing => 0)


    # # Manual sanity check: these two tables should be roughly the same before upload
    combine(groupby(target_properties, [:year, :month]), nrow)
    select_df(con(), "SELECT count(*), year, month from properties_collapsed group by all order by year asc, month asc")

    PROP_COLLAPSE_TABLE = "properties_collapsed"

    # # only need to run if schema changes
    # # errors are good otherwise because something unexpected happened
    # execute(con(), """
    #     DROP TABLE IF EXISTS $PROP_COLLAPSE_TABLE
    # """)
    # execute(con(), """
    # CREATE TABLE IF NOT EXISTS $PROP_COLLAPSE_TABLE
    #     $(tablespec(chtypes(target_properties)))
    # ENGINE = MergeTree()
    # ORDER BY (channel, property_type, bedrooms, bathrooms, h3_7, h3_11, price, date, intHash32(date), uprn) -- this order is more annoying for humans but better for computer
    # SAMPLE BY intHash32(date) -- only 75% of dates are unique, does it matter?
    # """)
    execute(con(), "TRUNCATE TABLE IF EXISTS $PROP_COLLAPSE_TABLE")

    # trunc errors about int32 are probably dates that are too early for clickhouse to cope with
    insert(con(), PROP_COLLAPSE_TABLE, [df2dict(target_properties[:, Not(:number_habitable_rooms)])]) # takes like, 3 minutes
end


# `docker exec server sh -c "run ch-reload-rm-events"` - kill and rehydrate ch events
