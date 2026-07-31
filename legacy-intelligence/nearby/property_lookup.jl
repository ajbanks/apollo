#!/bin/julia
using DataFrames, Dates, Statistics, ThreadsX
include((@__DIR__) * "/../lib.jl")
include((@__DIR__) * "/../avm/predict.jl") # load the models (this is tail wagging dog but don't worry for now)
include((@__DIR__) * "/../habitable_rooms/habitable_rooms.jl")

# wot we want to know
# bedrooms -> rm
# bathrooms -> rm
# number of rooms -> epc
# floor area -> epc
# garden size -> epc & inspire w/ property type
# property type -> epc
# construction date -> epc


######
#
# this table is no longer used by this code ... but the table is used by the KPI mix reweighting code. so keep it for now
#
######

#     # todo: investigate missing postcodes e.g. AL1 1BT - seem to be missing from codepoint too. could guess?
#     # nb: built form is the type of building, property_type is e.g. whether it's a flat. so you can have a flat in a terrace etc
#     #
#     # nb: in "left join ... on ...", the clauses after on act like a where except they're executed before the join. in theory. can't get it to work.
#     
#     # step 1 grab data
#     # uniqueness is a problem for another day
#     epc = select_df(con(), """
#         select if(uprn = 0, pm.lat, e.lat) as lat, if(uprn = 0, pm.lon, e.lon) as lon, e.uprn, geoToH3(lon, lat, 11) as h3_11, postcode, e.* from 
#         (select lat, lon, uprn, postcode, total_floor_area, number_habitable_rooms, property_type, tenure, construction_age_band, built_form from epc_data_england epe left join uprn_os uo on epe.uprn = uo.uprn where epe.epc_type = 'domestic') e
#         left join postcode_meta pm on e.postcode = pm.postcode
#     """)
#     
#     epc.construction_age = ThreadsX.map(construction_age_band_wrangler, epc.construction_age_band)
#     function tenure_wrangler(tenure)
#         t = replace(lowercase(tenure), "rented" => "rental")
#         return t in ["owner-occupied", "rental (private)", "rental (social)"] ? t : ""
#     end
#     epc.tenure_canon = ThreadsX.map(tenure_wrangler, epc.tenure)
#     epc.number_habitable_rooms = replace(epc.number_habitable_rooms, missing => -1)
#     epc.construction_age = replace(epc.construction_age, nothing => 0)
#     dropmissing!(epc)
#     
#     # todo: here? estimate location of missing postcodes
#     # k = combine(groupby(epc, :postcode), :lat => first)
#     # mean(k.lat_first .== 0) # 1.7% - do we care?
#     
#     epc_upload = @view epc[!, [:h3_11, :uprn, :lat, :lon, :number_habitable_rooms, :total_floor_area, :property_type, :tenure_canon, :construction_age, :built_form]]
#     
#     
#     # only need to run if schema changes
#     # # errors are good otherwise because something unexpected happened
#     execute(con(), """
#         DROP TABLE IF EXISTS CANON_EPC_HOMES_ENGLAND
#     """)
#     execute(con(), """
#     CREATE TABLE IF NOT EXISTS CANON_EPC_HOMES_ENGLAND
#         $(tablespec(chtypes(epc_upload)))
#     ENGINE = MergeTree()
#     ORDER BY (h3_11, uprn, built_form, property_type, number_habitable_rooms, tenure_canon, construction_age, total_floor_area) -- this order is more annoying for humans but better for computer
#     """)
#     execute(con(), "TRUNCATE TABLE IF EXISTS CANON_EPC_HOMES_ENGLAND")
#     
#     insert(con(), "CANON_EPC_HOMES_ENGLAND", [df2dict(epc_upload)])



######
#
# actual lookup experiment
#
######

# in order of priority for narrowing
missingness_ordered = [
    "property_type" => "", # e.g. semi-detached bungalow, too narrow, see special threshold
    "num_habitable_rooms" => -1,
    "total_floor_area" => 0.0,
    # "ownership_type" => "", # not worth it
    # "occupation_type" => "",
    # "extensions" => 0,
    "year_built_normalised" => 0.0,
    "council_tax_band" => 0,
]
missingness = Dict(missingness_ordered)

special_thresholds = Dict(
    "total_floor_area" => t -> "($(t[1]) > $(t[2]*0.8) and $(t[1]) < $(t[2]*1.2))",
    "year_built_normalised" => t -> "($(t[1]) > $(t[2]*0.99) and $(t[1]) < $(t[2]*1.01))", # todo: this needs to be logarithmic based on today
    "property_type" => t -> t[2] == "flat" ? "($(t[1]) = 'flat')" : "($(t[1]) != 'flat')",
)

fallback_threshold = t -> "($(t[1]) = '$(t[2])')"

special_thresholds_julia = Dict(
    "total_floor_area" => t -> (x -> t* 0.8 < x < t*1.2),
    "year_built_normalised" => t -> (x -> t * 0.99 < x < t*1.01), # todo: this needs to be logarithmic based on today
    "property_type" => t -> (x -> t == "flat" ? x == "flat" : x != "flat"),
)

fallback_threshold = t -> "($(t[1]) = '$(t[2])')"
fallback_threshold_julia = t -> (x -> t == x)

# uprn = 100020187939 # already seem to have found a property that had an extension added
# uprn = 100020187938 # get pretty rubbish results for this, is it in the middle of nowhere
# uprn = 100020187937  # nothing known
# uprn = 100020187939 # already seem to have found a property that had an extension added
# uprn = 100040064476
# uprn = 25060840 # problematic - +100% - 50% error

row2d(row) = Dict(names(row) .=> string.(values(row)))
function doavm(uprn)
    try
        column_types = Dict(
            "property_type" => :categorical,
            "year_built_normalised" => :quantitative,
            "num_habitable_rooms" => :quantitative,
            "occupation_type" => :categorical,
            "ownership_type" => :categorical,
            "council_tax_band" => :quantitative, # need reverse lookup to character
            "total_floor_area" => :quantitative,
            "flat_storey_count" => :quantitative,
            "floor_level_int" => :quantitative,
            "plot_area_sqm" => :quantitative,
            "garden_area_sqm" => :quantitative,
            "new_build" => :categorical,
            "extensions" => :quantitative,
            "bedrooms" => :quantitative,
            "postcode" => :categorical,
            "has_garden" => :categorical,
            "has_parking" => :categorical,
        ) # columns that we want to estimate, orthogonal to AVM

        pos = first(select_df(con(), "select lat, lon from uprn_os where uprn = $uprn"))
        known = select_df(con(), "select * from properties_area where uprn = $uprn")
        if size(known,1) != 0
            try
                leftjoin!(known, select_df(con(), "select distinct on (uprn) uprn, date(date) as last_sale_date, price as last_sale_price from land_registry_england where uprn in $(julia2clickhouse(known.uprn)) order by date desc"), on=:uprn)
            catch(e)
                @warn (uprn, e) # mostly just errors where no land registry data
            end
        end
        using_land_reg =  ("last_sale_price" in names(known)) && (!ismissing(first(known).last_sale_price))
        need = using_land_reg ? [:bathrooms, :bedrooms, :property_type, :total_floor_area, :postcode, :last_sale_date, :last_sale_price] : [:bathrooms, :bedrooms, :property_type, :total_floor_area, :postcode]

        # can skip all the imputation / MC methods if we already know everything
        if size(known, 1) > 0 && !any(ismissing.(values(known[1, need])))
            known_deets = row2d(known[1, need])
            known_deets["date"] = string(Dates.today())
            known_deets["lat"] = string(pos.lat)
            known_deets["lon"] = string(pos.lon)
            wider_known = Dict(k => v for (k,v) in row2d(known[1, Symbol.(keys(column_types))]) if v !== "missing") # this is dumb
            if haskey(known_deets, "property_type")
                known_deets["prop_type"] = known_deets["property_type"]
                delete!(known_deets, "property_type")
            end
            if haskey(wider_known, "property_type")
                wider_known["prop_type"] = wider_known["property_type"]
                delete!(wider_known, "property_type")
            end
            return (sales=predict_sales(known_deets), rents=predict_rents(known_deets), imputed=Dict(), known=wider_known)
        end

        narrowing_ordered = if size(known,2) > 0
            knowndict = []
            for k in map(x->x[1], missingness_ordered)
                maybe = skipmissing(known[!, Symbol(k)]) |> collect
                if length(maybe) > 0
                    push!(knowndict, k => first(maybe))
                end
            end
            knowndict
        else
            []
        end
        narrowing_dict = Dict(narrowing_ordered)
        # function dict2where(dict)
        #     " and " * mapreduce(t -> get(special_thresholds, t[1], fallback_threshold)(t), (l,r) -> join((l,r), " and "), pairs(filter(t -> !ismissing(t[2]) && t[2] > get(missingness, t[1], -1), dict)))
        # end
        # narrowing = dict2where(narrowing_dict)

        # if location is estimated from postcode, is h3 11 big enough?
        # get everything then narrow later
        # h3EdgeLengthKm(11)*dist if need km
        nearby_properties = select_df(con(), "select h3Distance(geoToH3($(pos.lon), $(pos.lat), 11), h3_11) dist, * from properties_area where type = 'domestic' and h3_11 in h3kRing(geoToH3($(pos.lon), $(pos.lat), 11),40) order by dist") # max distance ~1km away
        nearby_properties_big = nearby_properties

        # if using land reg
        if using_land_reg
            leftjoin!(nearby_properties, mapreduce(
                uprns -> select_df(con(), "select distinct on (uprn) uprn, date(date) as last_sale_date, price as last_sale_price from land_registry_england where uprn in $uprns order by date desc"),
                vcat,
                Iterators.map(julia2clickhouse, Iterators.partition(nearby_properties.uprn, MAX_CLICKHOUSE_QUERY_SIZE)),
            ), on=:uprn)
            dropmissing!(nearby_properties, :last_sale_price)
        end

        # land reg ends

        for (k,v) in filter(t -> !ismissing(t[2]) && t[2] > get(missingness, t[1], -1), narrowing_ordered)
            threshold = get(special_thresholds_julia, k, fallback_threshold_julia)(v)
            p = nearby_properties[Missings.replace(passmissing.(threshold).(nearby_properties[!, Symbol(k)]), 0)|>collect, :]
            if (size(p,1) >= 10)
                nearby_properties = p
            end
        end
        nearby_properties = nearby_properties[nearby_properties.dist .<= nearby_properties[min(10, size(nearby_properties,2)), :dist], :] # get at least 10 results
        # probably want a separate "get everything we know about a property" api and a "fill in the gaps" API, that way users can add things they know but we don't

        for r in eachrow(nearby_properties)
            if (ismissing(r.bedrooms) || ismissing(r.bathrooms))
                if !ismissing(r.num_habitable_rooms)
                    bb = predict_bedsbaths(r.num_habitable_rooms, r.property_type)
                    r.bedrooms = bb.bedrooms
                    r.bathrooms = bb.bathrooms
                else # oh no
                    try
                        bb = dropmissing(nearby_properties_big[Missings.replace(passmissing.(special_thresholds_julia["total_floor_area"](r.total_floor_area)).(nearby_properties_big[!, :total_floor_area]), 0)|>collect, [:bedrooms, :bathrooms]])
                        r.bedrooms = ceil(median(bb.bedrooms)) |> Int
                        r.bathrooms = ceil(median(bb.bathrooms)) |> Int
                    catch(e)
                        ;
                    end
                end
            end
        end

        # todo: consider using last sale date / price where available anyway

        # # returns e.g.
        # Dict{String, Tuple{AbstractVector, AbstractVector{Float64}}} with 7 entries:
        #   "occupation_type"       => (Union{Missing, String}["owner"], [0.75])
        #   "property_type"         => (Union{Missing, String}["terraced", "semi_detached", "end_of_terrace", "maisonette", "flat"], [0.325, 0.25, 0.15, 0.125, 0.075])
        #   "ownership_type"        => (Union{Missing, String}["freehold", missing], [0.725, 0.175])
        #   "council_tax_band"      => ([3.0, 3.0, 3.0, 4.0, 4.9], [0.025, 0.25, 0.5, 0.75, 0.975])
        #   "num_habitable_rooms"   => ([2.95, 4.0, 4.0, 5.0, 6.025], [0.025, 0.25, 0.5, 0.75, 0.975])
        #   "total_floor_area"      => ([61.3775, 77.46, 88.0, 95.5, 115.014], [0.025, 0.25, 0.5, 0.75, 0.975])
        #   "year_built_normalised" => ([1900.0, 1914.0, 1914.0, 1958.0, 1986.0], [0.025, 0.25, 0.5, 0.75, 0.975])

        # somewhere in all this we should use the fact that we know when UPRNs share a single INSPIRE freehold plot

        # counciltax2char(n) = Char(Int(round(n)) + 64)
        # counciltax2char.(getindex(k["council_tax_band"],1))

        # avm

        # need:
        choices = dropmissing(nearby_properties[!, need])
        # randomly sample as if the variables are independent as absolute last resort when we don't have enough data
        if size(choices, 1) <= 10
            choices = DataFrame(Dict(n => sample(collect(skipmissing(nearby_properties[!, n])), 100) for n in need));
        end
        rename!(choices, :property_type => :prop_type)
        # or do we use some combination of the two

        known_deets = merge(Dict( # may cause weird behaviour at boundaries where lat/lon and postcode don't match
            "lat" => string(pos.lat),
            "lon" => string(pos.lon),
            "date" => string(Dates.today()),
        ), Dict(k => string(v) for (k,v) in narrowing_dict if Symbol(k) in need))

        # rename prop_type because somehow somewhere it got renamed
        if haskey(known_deets, "property_type")
            known_deets["prop_type"] = known_deets["property_type"]
            delete!(known_deets, "property_type")
        end

        attempts = map(c -> merge(row2d(c), known_deets), eachrow(choices)) # is it sound to merge them like this?

        function mc_func(f)
            mc = f.(attempts)
            lower, med, upper = quantile(getfield.(mc, :estimate), [0.125, 0.5, 0.875])
            uncertainty = median(getfield.(mc, :central_error))
            lower, upper = (min(lower, med/uncertainty), max(upper, med*uncertainty))
            uncertainty = mean((med/lower, upper/med))
            return api_mimic = (estimate = med, low = lower, high = upper, central_error = uncertainty)
        end

        # best guesses: currently limited to middle 95% of data
        best_guesses = Dict(k => begin
            if column_types[k] == :quantitative
                quantiles = [0.025, 0.25, 0.5, 0.75, 0.975]
                maybequantiles = headinsand(v -> quantile(v, quantiles), nearby_properties[!, Symbol(k)])
                maybequantiles = ismissing(maybequantiles) ? [missing for _ in quantiles] : maybequantiles
                (maybequantiles, quantiles)
            elseif column_types[k] == :categorical
                type_counts = combine(groupby(nearby_properties, Symbol(k)), nrow)
                type_counts.perc = type_counts.nrow ./ sum(type_counts.nrow)
                sort!(type_counts, :perc, rev=true)
                c = @view type_counts[cumsum(type_counts.perc) .< 0.95, :]
                c = size(c, 1) < 2 ? type_counts[1:min(2, size(type_counts, 1)), :] : c
                (c[!, Symbol(k)], c.perc)
            end
        end for (k,v) in column_types) # todo: only return non-known

        if haskey(best_guesses, "property_type")
            best_guesses["prop_type"] = best_guesses["property_type"]
            delete!(best_guesses, "property_type")
        end
        not_guesses = size(known, 1) == 0 ? Dict() : Dict(k => v for (k,v) in row2d(known[1, Symbol.(keys(column_types))]) if v !== "missing") # this is dumb
        best_guesses = Dict(k=>v for (k,v) in best_guesses if !haskey(not_guesses, k))
        
        # this one column is an absolute nightmare
        if haskey(not_guesses, "property_type")
            not_guesses["prop_type"] = not_guesses["property_type"]
            delete!(not_guesses, "property_type")
        end
        if haskey(best_guesses, "prop_type") && haskey(not_guesses, "prop_type")
            delete!(best_guesses, "prop_type")
        end

        quant_guesses = Dict(k => v for (k,v) in best_guesses if get(column_types,k,:unknown) == :quantitative)
        cat_guesses = Dict(k => v for (k,v) in best_guesses if get(column_types,k,:unknown) != :quantitative) # != here is stupid fix for prop_type
        (sales=mc_func(predict_sales), rents=mc_func(predict_rents), imputed=Dict("categorical" => cat_guesses, "quantitative" => quant_guesses), known=not_guesses)
    catch (e)
        return (error = string(e), )
    end
end

# homes england test data
# using JSON
# sample_data = JSON.parsefile("./homes_england_sample/bid-sample-processed.json")
# # uprns = Iterators.flatten(
# #     [parse.(Int, map(x->x["uprn"], sample_data["empty_sample"])),
# #     parse.(Int, map(x->x["uprn"], sample_data["random_sample"])),
# #     parse.(Int, map(x->x["uprn"], sample_data["with_no_epc"])),
# #     parse.(Int, map(x->x["uprn"], sample_data["full_sample"])),]
# # ) |> collect
# uprns = map(x -> parse(Int, x["uprn"]), sample_data)

# sample_json = JSON.json(ThreadsX.map(u -> (uprn = u, avm = doavm(u), calculation_date = now()), uprns))
# write("sample_corrected.json", sample_json)

# # number of modelled storey heights
# j = JSON.parse(sample_json)
# # 1 - mean(x->isnothing(x[1]), filter(x->length(x)>0, map(d -> get(d["avm"]["imputed"], "floor_level_int", []), j)))
# # mean(map(d -> haskey(d["avm"]["known"], "floor_level_int"), j))

# quant_known_modelled(key) = begin
#     modelled = sum(x->length(x) > 0 && !isnothing(x[1]) && !isnothing(x[1][3]), map(d -> get(d["avm"]["imputed"], key, []), j)) / length(j)
#     known = sum(x->length(x) == 0, map(d -> get(d["avm"]["imputed"], key, []), j)) / length(j)
#     (known = known, modelled=max(min(modelled, (1-known-0.001)), 0.0))
# end

# cat_known_modelled(key) = begin
#     modelled = sum(x->length(x) > 0 && !isnothing(x[1]) && !isnothing(x[1][1]), map(d -> get(d["avm"]["imputed"], key, []), j)) / length(j)
#     known = sum(x->length(x) == 0, map(d -> get(d["avm"]["imputed"], key, []), j)) / length(j)
#     (known = known, modelled=max(min(modelled, (1-known-0.001)), 0.0))
# end

# column_types = Dict(
#     "prop_type" => :categorical,
#     "year_built_normalised" => :quantitative,
#     "num_habitable_rooms" => :quantitative,
#     "occupation_type" => :categorical,
#     "ownership_type" => :categorical,
#     "council_tax_band" => :quantitative, # need reverse lookup to character
#     "total_floor_area" => :quantitative,
#     "flat_storey_count" => :quantitative,
#     "floor_level_int" => :quantitative,
#     "plot_area_sqm" => :quantitative,
#     "garden_area_sqm" => :quantitative,
#     "new_build" => :categorical,
#     "extensions" => :quantitative,
#     "bedrooms" => :quantitative,
#     "postcode" => :categorical,
#     "has_garden" => :categorical,
#     "has_parking" => :categorical,
# ) # columns that we want to estimate, orthogonal to AVM

# Dict(k => v == :categorical ? cat_known_modelled(k) : quant_known_modelled(k) for (k,v) in column_types)

# TODO: 
# - do not ever use bedrooms > habitable rooms
# - add biggest radius used for comparables
# - mention comparable sample size
# - mention columns used for comparables
# - add force_imputation key
# - add why_imputation key - which keys were missing that meant we needed to do MC

# function diff_dict(dict1::AbstractDict, dict2::AbstractDict)
#     diff = Dict()
#     all_keys = union(keys(dict1), keys(dict2)) # Get all keys from both dictionaries

#     for key in all_keys
#         val1 = get(dict1, key, nothing) # Safely get value from dict1, default to nothing if key not present
#         val2 = get(dict2, key, nothing) # Safely get value from dict2, default to nothing if key not present

#         if val1 isa AbstractDict && val2 isa AbstractDict # If both values are dictionaries, recurse
#             sub_diff = diff_dict(val1, val2)
#             if !isempty(sub_diff) # Only add to diff if there are changes in the sub-dictionary
#                 diff[key] = sub_diff
#             end
#         elseif val1 != val2 # Values are not both dictionaries, compare directly
#             if haskey(dict1, key) && haskey(dict2, key) # Key exists in both and values are different
#                 diff[key] = Dict("previous" => val1, "corrected" => val2)
#             elseif haskey(dict1, key) # Key only in dict1 (removed from dict2 perspective)
#                 diff[key] = Dict("previous" => val1, "corrected" => nothing) # Indicate removal with nothing in "new"
#             elseif haskey(dict2, key) # Key only in dict2 (added from dict1 perspective)
#                 diff[key] = Dict("previous" => nothing, "corrected" => val2) # Indicate addition with nothing in "old"
#             end
#         end
#     end
#     return diff
# end
# using JSON
# sample_old = JSON.parsefile("./avm-sample.json")
# sample_new = JSON.parsefile("./sample_corrected.json")
# old_dict = Dict(v["uprn"] => v for v in sample_old)
# new_dict = Dict(v["uprn"] => v for v in sample_new)	


# function remove_keys_nested!(dict::AbstractDict, key_array::Vector{String})
#     keys_to_remove = String[] # Collect keys to remove to avoid issues during iteration

#     for (key, value) in dict
#         if key in key_array
#             push!(keys_to_remove, string(key)) # Convert key to string if not already, to match key_array type
#         elseif value isa AbstractDict
#             remove_keys_nested!(value, key_array) # Recursively process nested dictionaries
#         end
#     end

#     for key_to_remove in keys_to_remove
#         delete!(dict, key_to_remove)
#     end
#     return dict
# end

# write("avm_errata.json", JSON.json([begin v["uprn"] = k; v end for (k,v) in remove_keys_nested!(diff_dict(old_dict, new_dict), ["calculation_date", "known", "imputed"]) if (length(keys(v)) > 0) && (length(keys(v["avm"])) > 0)]))
