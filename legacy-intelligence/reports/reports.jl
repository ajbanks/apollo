#!/bin/julia

include((@__DIR__) * "/../lib.jl")
using DataFrames, Dates

####
# 
# enfield council BRMA rents
#
####
import XLSX
df = select_df(con(), """
    select name, code, y, least_of_5_or_bedrooms beds_squashed, price_percentile_30, price_percentile_50, sample_size from location_kpis_V3_3 kpi
    left join (select distinct on (code) code, name from location_h3 where type = 'brma25' and res = 7) lh on kpi.code = lh.code
    where type = 'brma25' and property_type is null and q = 3 and m IS null and y is not null and rolling_year is null and channel = 'RES_LET' and property_type is null and bedrooms is null and (least_of_5_or_bedrooms between 0 and 5) order by code, y, beds_squashed
""")

# check that extra grouping columns haven't been missed
all(combine(groupby(df, [:code, :y, :beds_squashed]), nrow => :n).n .== 1) || @error "Enfield: duplicate rows detected - check grouping columns";

# rename columns to follow enfield's spec
rename!(df, Dict(
    :name => "BRMA Name",
    :code => "BRMA Code",
    :y => "Year",
    :beds_squashed => "Beds",
    :price_percentile_50 => "Average Market Rent",
    :price_percentile_30 => "30th Percentile Average Market Rent",
    :sample_size => "Number of Properties"
))

# sample: inner east london and isle of wight
XLSX.writetable("out/propexum-enfield-brma-sample-$(Dates.today()).xlsx", "BRMA rents" => df[in.(df[!, Symbol("BRMA Code")], Ref(["BRMA14274", "BRMA18000"])), [Symbol("BRMA Name"), Symbol("BRMA Code"), :Year, :Beds, Symbol("Average Market Rent"), Symbol("30th Percentile Average Market Rent"), Symbol("Number of Properties")]] ; overwrite=true)

# real deal
XLSX.writetable("out/propexum-enfield-brma-full-$(Dates.today()).xlsx", "BRMA rents" => df[!, [Symbol("BRMA Name"), Symbol("BRMA Code"), :Year, :Beds, Symbol("Average Market Rent"), Symbol("30th Percentile Average Market Rent"), Symbol("Number of Properties")]]; overwrite=true)




####
#
# bungalow people
#
####

# 1. want to make a house price index using land reg, h3_5 and rolling years
# 2. need to keep the most recent price from the index handy because we'll need it to turn the old prices into current prices

df_i = select_df(con(), """
    with
    median_prices as (select median(price) price, h3, rolling_year from (
        select uprn, price, toInt16(ceil((toDate(date) - today()) / 365)) as rolling_year, geoToH3(lon, lat, 5) h3 from land_registry_england lre
        left join uprn_os um on um.uprn = lre.uprn
        where true
        and uprn > 0 
        and rolling_year >= -10
    ) group by all)
    select price/pmax p_index, pmax, h3, rolling_year from median_prices mp
    inner join (select argMax(price, rolling_year) pmax, h3 from median_prices group by h3) maxp on maxp.h3 = mp.h3
""") # done :)

# 3. only bungalows
df_b  = select_df(con(), """
    select median(price) price, h3, rolling_year, built_form, count(*) n from (
        select lre.uprn uprn, price/total_floor_area price, toInt16(ceil((toDate(date) - today()) / 365)) as rolling_year, geoToH3(lon, lat, 5) h3, built_form from land_registry_england lre
        inner join uprn_os um on um.uprn = lre.uprn
        inner join epc_data_england epe on epe.uprn = um.uprn
        where true
        and lre.uprn > 0 
        and epe.total_floor_area > 0
        and epc_type = 'domestic'
        and epe.property_type = 'Bungalow'
        and rolling_year >= -10
    ) group by all
""") # done :)

# population density
df_p = select_df(con(), """
    select h3ToParent(h3, 5) h3, medianExactWeighted(population, toUInt32(round(population)))/h3HexAreaKm2(7) density from population_h3 where res = 7 group by all
""")

# fuas
df_fua = select_df(con(), """
    select h3ToParent(h3, 5) h3, anyHeavy(code) code, anyHeavy(name) name from location_h3 where res = 7 and type = 'fuas' group by all
""")

df = leftjoin!(leftjoin!(leftjoin(df_b, df_i, on = [:h3, :rolling_year], renamecols = "_bungalow" => "_index"), df_p, on = :h3), df_fua, on = :h3)
dropmissing!(df)
df.price_inflated = (df.price_bungalow ./ df.p_index_index)
# addquantiles!(df, :density) # land weighted
sort!(df, :density)
df.density_quantile = cumsum(df.density) ./ sum(df.density) # population weighted
df.density_percentile = round.(df.density_quantile, digits = 1)
quantilelabels(df.density)

result = combine(groupby(df, [:built_form_bungalow, :density_percentile]), :price_inflated => median => :price_inflated, :n_bungalow => sum, :density => mean => :density, :price_inflated => std => :price_inflated_std)
result.error = result.price_inflated_std ./ sqrt.(result.n_bungalow_sum)
sort!(result, :density_percentile)
result = result[in.(result.built_form_bungalow, Ref(["Detached", "Mid-Terrace", "Semi-Detached", "End-Terrace"])), :]

using Plots
labels = quantilelabels(result.density)
plot(result.density_percentile, result.price_inflated, group=result.built_form_bungalow, ribbon=result.error, xticks=(labels[1], Int.(round.(labels[2]))), xlabel="Population weighted population density / km²", ylabel="Sale price / m², current prices")

rebased = leftjoin(result#=[result.built_form_bungalow .!= "Detached", :]=#, result[result.built_form_bungalow .== "Detached", :], on=:density_percentile, renamecols = "" => "_detached")
rebased.price_inflated_rebased = (1 .- rebased.price_inflated ./ rebased.price_inflated_detached) .* 100
# rebased.error_rebased = rebased.error ./ std(rebased.price_inflated_detached # can't remember how to do error propagation
plot(rebased.density_percentile, rebased.price_inflated_rebased, group=rebased.built_form_bungalow, xticks=(labels[1], Int.(round.(labels[2]))), xlabel="Population weighted population density / km²", ylabel="Sale price/m² vs detached, %", legend=:bottomleft)




# look at specific cities to make Simon happy
result = combine(groupby(df, [:built_form_bungalow, :name]), :price_inflated => median => :price_inflated, :n_bungalow => sum, :density => mean => :density, :price_inflated => std => :price_inflated_std)
result.error = result.price_inflated_std ./ sqrt.(result.n_bungalow_sum)
result = result[in.(result.built_form_bungalow, Ref(["Detached", "Mid-Terrace", "Semi-Detached"])) .&& in.(result.name, Ref(["Sheffield", "Manchester", "York"])), :]

using StatsPlots
groupedbar(result.name, result.price_inflated, group=result.built_form_bungalow, ylabel="Sale price / m², current prices", margins=10*Plots.mm)
rebased = leftjoin(result[result.built_form_bungalow .!= "Detached", :], result[result.built_form_bungalow .== "Detached", :], on=:name, renamecols = "" => "_detached")
rebased.price_inflated_rebased = (1 .- rebased.price_inflated ./ rebased.price_inflated_detached) .* 100
# rebased.error_rebased = rebased.error ./ std(rebased.price_inflated_detached # can't remember how to do error propagation
groupedbar(rebased.name, rebased.price_inflated_rebased, group=rebased.built_form_bungalow, ylabel="Sale price/m² discount vs detached, %", xrot=45, margins=10*Plots.mm)
