#!/bin/julia

# todo: only pull columns we need to join / train model to limit memory usage
# investigate zero bathroom properties. are they bedsit style or just data error?
#
# todo: check whether performance improves on missings by randomly hiding data. i think it doesn't, see orig paper section 3.4 https://arxiv.org/pdf/1603.02754.pdf
#      -> i think totally hiding data is better
#      -> at the moment the model seems to assume that missing floor area means "minimum floor area"
#
# look at importance https://dmlc.github.io/XGBoost.jl/dev/features/#Feature-Importance
# (but i think that is model wide rather than SHAP / Shapley)
#
# predict.jl works with sales; just need to write the code for training the lettings models too
#
#
# for kpis: can do moving averages etc directly in clickhouse https://clickhouse.com/docs/en/sql-reference/functions/time-window-functions

using DataFrames, TranscodingStreams, CodecZstd, StatsBase, Serialization
import MLJ, XGBoost, MLJBase, ThreadsX, Dates
include((@__DIR__) * "/../lib.jl")

start_time = Dates.now()

string_table = Dict(
    "RES_LET" => "lettings",
    "RES_BUY" => "sales",
)

USE_LAND_REG = get(ENV,"USE_LAND_REG", "true")

function quantile_error(quant=0.5)
    return function(predictions, truth)
        return quantile(abs.(predictions.-truth), quant)
    end
end

listings_query(channel) = """
select uprn, price, id, event_timestamp, lat, lon, property_type, bedrooms, bathrooms, postcode
-- select * except (point, commercial, residential, development, students, auction)
from vw_rm_listing_events_with_uprns pl
-- from property_listings pl -- use pristine db once finished
where channel = '$channel'
and property_type != ''
and property_type != 'caravan'
and not commercial
-- and listing_update_reason = 'new'
and uprn > 0
-- and pointInPolygon((lat, lon), $UK_POLYGON) -- don't understand how to make a tuple here
"""

println("Pulling $TRAINING_CHANNEL listings from ClickHouse (~2 minutes)")
sales_query = listings_query(TRAINING_CHANNEL) # for lettings, 700k listings.
# STU_LET gets bad results, ~20% error for some places, high as 80% for others.
# is that because people are listing e.g. 7 bedrooms but showing per room rents?
# median for listing with <= 5 bedrooms is £975. median for >= 6 bedrooms is £995 ....
# unsupervised clustering with two clusters to determine per bedroom vs per property?
# or try to mine descriptions to see if it's per_room?
listings = select_df(con(), sales_query) # todo: use pristine db instead
sort!(listings, :event_timestamp)
listings = listings[.!nonunique(listings, :id, keep=:last), :] # only keep the most recent event for each property

# todo: check if including land registry data improves accuracy. u no wot, include LR data anyway always

# # atm not using any epc data
# epc_query = """
# select * from epc_data_england
# --where postcode = 'PO37 7NS'
# """
# epcs = select_df(con(), epc_query)


# todo: train without any LR data too -> consider replacing with council tax?

uprns_parts = Iterators.map(julia2clickhouse, Iterators.partition(listings.uprn, MAX_CLICKHOUSE_QUERY_SIZE))
sales = DataFrame(uprn=[missing])
if USE_LAND_REG == "true"
    println("Pulling corresponding land registry data from ClickHouse (~2 minutes)")
    # have to split it up into multiple queries of about 10k each
    # kinda slow, ~5 minutes, maybe we should just join in memory in julia
    # it makes sense if we're only pulling a few, but if we're training on everything then much quicker to just pull everything and
    # run it in julia
    #  - https://github.com/JuliaDatabases/ClickHouse.jl/blob/8d7c8d7380658c4f4f1bcbfcab3000695a6ffeee/src/Query.jl#L215C5-L215C5 - this function looks pretty optimisable
    # could be quicker in clickhouse if we groupby postcodes/postcodesector and only pull one postcode at a time?
    sales = reduce(vcat, ThreadsX.map(uprns -> begin # 100 seconds to get 700k properties
            lr_query = """
                select uprn, price, date
                -- select * except new_build
                from land_registry_england
                where uprn in $uprns
            """
            select_df(con(), lr_query)
    end, uprns_parts))

    sort!(sales, :date)
    sales = sales[.!nonunique(sales, :uprn, keep=:last), :] # only keep the most recent event for each property
end

epcs = reduce(vcat, ThreadsX.map(uprns -> begin # 100 seconds to get 700k properties
        lr_query = """
            select uprn, inspection_date as date, total_floor_area
            from epc_data_england
            where uprn in $uprns
            and total_floor_area > 0
        """
        select_df(con(), lr_query)
end, uprns_parts))

sort!(epcs, :date)
epcs = epcs[.!nonunique(epcs, :uprn, keep=:last), :] # only keep the most recent inspection for each property


td2unix = x -> x.instant.periods.value
# ztd2unix = x -> x.utc_datetime.instant.periods.value

k = leftjoin(listings, sales, on=:uprn, renamecols = "_listings" => "_sales", matchmissing=:notequal)
if USE_LAND_REG == "true" 
    dropmissing!(k, :price_sales)
    k.lprice_sales = log.(Float64.(k.price_sales))
    k.date_unix_sales = td2unix.(k.date_sales)
end
k = leftjoin(k, epcs[!, Not(:date)], on=:uprn)
dropmissing!(k, :total_floor_area) # 36k total EPCS out of 26 million
# gives us 2 million properties to play with, uses about 30GB RAM. probably wise to add a zram swap file just in case?
# (the sensible thing to do would be to get the postcodes, then only load one postcode a time into memory)
#
# for lettings:
# i don't understand how we have 700k listings, 400k sales, but when we drop_missings we get 700k.
# we must therefore have multiple listings per property -> the id is not always reused

# rightmove is bad
k = k[k.price_listings .> 1, :]

k.lprice_listings = log.(k.price_listings)
k.date_unix_listings = td2unix.(k.event_timestamp_listings)
k.nlat_listings = k.lat_listings
k.nlon_listings = k.lon_listings
k.postcode_area = getfield.(match.(r"^[A-Z]*", k.postcode_listings),:match)
k.total_floor_area = Float64.(k.total_floor_area)

for type in unique(k.property_type_listings)
    k[!,Symbol("is_"*type)] = k.property_type_listings .== type
end

XGBoostRegressor = MLJ.@load XGBoostRegressor pkg="XGBoost"

# just for testing
# using Dates
# df = k
# k = @view df[df.event_timestamp_listings .< Date(2024,7), :]
# nk = @view df[df.event_timestamp_listings .>= Date(2024,7), :]

println("Training models...")
predictions = Float64[]
ground_truths = Float64[]
FEATURES = [:nlat_listings,:nlon_listings, :total_floor_area, :bathrooms_listings, :bedrooms_listings, :date_unix_listings]
FEATURES = USE_LAND_REG === "true" ? [FEATURES..., :date_unix_sales, :lprice_sales] : FEATURES
FEATURES = [FEATURES..., Symbol.("is_" .* unique(k.property_type_listings))...]
models_df = combine(groupby(k, :postcode_area), postcode_area -> begin
    first = postcode_area.event_timestamp_listings[1]
    last = postcode_area.event_timestamp_listings[end]
    relevant_columns_only = postcode_area[!,[FEATURES...,:lprice_listings, :event_timestamp_listings]]
    @info "Starting $(postcode_area.postcode_area[1]) at $(Dates.now())"

    try
        folds = 5
        test_size = Dates.Month(1) # Dates.Day(3) maybe more realistic since we update the model often?
        interval = (last - test_size - first) / Dates.Millisecond(folds) |> floor |> Dates.Millisecond
        ends = first:interval:(last - test_size) |> collect
        tests = DataFrame()
        for (i,e) in enumerate(ends[2:end])
            @info "Training/testing fold $i of $folds"
            fold = relevant_columns_only[relevant_columns_only.event_timestamp_listings .< e, :]
            test = copy(relevant_columns_only[e .<= relevant_columns_only.event_timestamp_listings .<= e + test_size, :])
            X = fold[!,FEATURES]
            y = fold.lprice_listings
            b = XGBoost.xgboost((X,y),max_depth=10,num_round=100, watchlist=(;))
            test.pred = XGBoost.predict(b,test[!,FEATURES])
            tests = vcat(tests, test)
        end # error increases from 80% within +/- 15% to 80% within +/- 20%. Switched to 75% quantile error to make comparable
        errors_beds = combine(groupby(tests, :bedrooms_listings), [:pred, :lprice_listings] => quantile_error(0.75) => :error)
        errors = quantile_error(0.75)(tests.pred, tests.lprice_listings)
        global predictions = vcat(predictions, tests.pred)
        global ground_truths = vcat(ground_truths, tests.lprice_listings)
        @info "Training/testing on all data"
        X = relevant_columns_only[!,FEATURES]
        y = relevant_columns_only.lprice_listings
        b = XGBoost.xgboost((X,y),max_depth=10,num_round=100, watchlist=(;))
        return DataFrame(error_p80=Ref(errors),error_p80_beds=Ref(errors_beds), model=[boost2uint(b)],features=[names(X)])
    catch(e)
        @warn(e)
        return DataFrame(error_p80=missing,error_p80_beds=DataFrame(), model=missing,features=missing)
    end
end)
global_quantile_errors = map(x -> "$x, $(round(quantile_error(x)(predictions, ground_truths); sigdigits=3))", [0.5, 0.75, 0.8, 0.9])
println("Models trained. Global quantile errors [quantile, max % error]: $global_quantile_errors")
model_errors_filename = (@__DIR__)*"/models_bin/models_errors_$(USE_LAND_REG === "true" ? "" : "no_landreg_")$(get(string_table,TRAINING_CHANNEL,TRAINING_CHANNEL)).csv"
write(model_errors_filename, join(["quantile, max_perc_error", global_quantile_errors...], "\n"))

model_filename = (@__DIR__)*"/models_bin/models_$(USE_LAND_REG === "true" ? "" : "no_landreg_")$(get(string_table,TRAINING_CHANNEL,TRAINING_CHANNEL)).zstd.jls"

println("Writing models to $model_filename")
write_zstd(model_filename, models_df)
println("Done. $TRAINING_CHANNEL models written to $model_filename, time taken: $(round(Dates.now()-start_time, Dates.Minute))")

# # tkt column was added to let you dive in to detail on errors but
# # because it's training on the whole data it's really just telling
# # you which bits are overfit, which is opposite of what you want
# combine(groupby(models_df[1, :tkt], :bedrooms_listings), [:pred, :lprice_listings] => (l,r) -> quantile_error(0.8)(l,r))


# todo: stop using MLJ totally and just use MLJBase and XGBoost

# todo: train/test on temporal split to get better idea of accuracy, e.g. train on all but last month. then retrain with all data
#       -> but first, random test/train and then split down to have accuracy per property type / area etc.


# imp = XGBoost.importancetable(uint2boost(models_df[1, :model])) |> DataFrame
# fdict = Dict(zip(1:15, models_df[1, :features]))
# imp.name = get.(Ref(fdict), imp.feature, missing)
# # coverage is measure of number of times feature is used, weighted by how early it is in the tree
# sort!(imp, :total_cover, rev=true)

# # just for homes england
# FEATURES = [:nlat_listings,:nlon_listings, :total_floor_area, :bathrooms_listings, :bedrooms_listings, :date_unix_listings, :date_unix_sales, :lprice_sales, Symbol.("is_" .* unique(k.property_type_listings))...]
# results = combine(groupby(nk, :postcode_area), g -> begin
#         row = models_df[models_df.postcode_area .== g.postcode_area[1], :] |> first
#         m = uint2boost(row.model)
#         relevant_columns_only = @view g[!,[FEATURES...,:lprice_listings, :event_timestamp_listings]]
#         DataFrame(actual=exp.(g.lprice_listings), predicted=exp.(XGBoost.predict(m, relevant_columns_only[!, FEATURES])), postcode=g.postcode_area)
# end)

# combine(groupby(results, :postcode_area), g -> begin
#         median(abs.(1.0.-g.predicted./g.actual))
# end)

# using StatsPlots
# histogram(results.predicted./results.actual, xlims=(0,4))
# plot(ecdf(abs.(1.0 .- results.predicted./results.actual)), xlims=(0,1), xlabel="\$\\pm\$ fractional error from true value", ylabel="Fraction of results with at most this error", legend=:none)
# savefig("~/projects/homes_england_sep2024/avm_performance.pdf")
