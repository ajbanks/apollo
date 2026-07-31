#!/bin/julia
using DataFrames, XGBoost, Dates
import Base.parse
include((@__DIR__) * "/../lib.jl")

# Hydrate models
models_sales_df = read_zstd((@__DIR__)*"/models_bin/models_sales.zstd.jls")
models_sales_df.model = uint2boost.(models_sales_df.model)
models_lettings_df = read_zstd((@__DIR__)*"/models_bin/models_lettings.zstd.jls")
models_lettings_df.model = uint2boost.(models_lettings_df.model)
models_sales_nolr_df = read_zstd((@__DIR__)*"/models_bin/models_no_landreg_sales.zstd.jls")
models_sales_nolr_df.model = uint2boost.(models_sales_nolr_df.model)
models_lettings_nolr_df = read_zstd((@__DIR__)*"/models_bin/models_no_landreg_lettings.zstd.jls")
models_lettings_nolr_df.model = uint2boost.(models_lettings_nolr_df.model)

PROP_TYPES = ["flat", "bungalow", "detached", "flat", "maisonette", "end_of_terrace", "semi_detached", "terraced", "terraced_bungalow", ""]

"Make parse preserve missingness"
parse(a,b) = Base.parse(a,b)
parse(_,x::Missing) = missing # todo: consider adding Missings library then using the passmissing function instead

"Conversion functions for property details to named tuples of model column names to values"
CONVERSION = Dict(
    "lat" => v -> (nlat_listings=parse(Float64,v),),
    "lon" => v -> (nlon_listings=parse(Float64,v),),
    "bathrooms" => v -> (bathrooms_listings=parse(Int,v),),
    "bedrooms" => v -> (bedrooms_listings=parse(Int,v),),
    "date" => v -> (date_unix_listings=DateTime(v, "yyyy-mm-dd").instant.periods.value,),
    "prop_type" => v -> merge(NamedTuple(Symbol("is_" * k) => false for k in PROP_TYPES), NamedTuple{(Symbol("is_" * v),)}(true)),
    "postcode" => v -> NamedTuple(), # unused in each model for now
    "last_sale_price" => v -> (lprice_sales=log(parse(Float64, v)),),
    "last_sale_date" => v -> (date_unix_sales=DateTime(v, "yyyy-mm-dd").instant.periods.value,), # todo: allow missing
    "total_floor_area" => v -> (total_floor_area=(parse(Float64, v)),),
)

"Convert a property details dictionary to a DataFrame with columns in exactly the same order as a model"
function details2df(prop_details, model_row)
    props = DataFrame(NamedTuple(Symbol(f) => Float64[] for f in model_row.features))
    allowmissing!(props)
    push!(props,mapreduce(kv -> CONVERSION[kv[1]](kv[2]),merge, collect(prop_details)); cols=:subset)
end

function predict_prop(prop_details; models_df=models_sales_df, sigdigits=8)
    postcode_area = match.(r"^[A-Z]*", prop_details["postcode"]).match
    row = models_df[models_df.postcode_area .== postcode_area,:]
    prop_df = details2df(prop_details, row[1,:])
    estimate = exp(XGBoost.predict(row.model[1], prop_df)[1]) |> Float64 # xgboost does f32
    error = 1.0
    try
        error = exp(row.error_p80_beds[1][row.error_p80_beds[1].bedrooms_listings .== prop_df.bedrooms_listings, :error] |> first)
    catch(e)
        # handle properties so rare that there are no training examples with the same number of bedrooms
        # todo: make this error bigger, e.g. use worst case error from above
        # @warn (e)
        error = exp(row.error_p80[1])
    end
    return map(v->round(v,sigdigits=sigdigits), (estimate=estimate, low=estimate/error, high=estimate*error, central_error=error))
end

predict_sales(prop_details) = ismissing(get(prop_details, "last_sale_price", missing)) ? predict_prop(prop_details, models_df=models_sales_nolr_df) : predict_prop(prop_details, models_df=models_sales_df)

"Placeholder function to match predict_sales"
predict_rents(prop_details) = ismissing(get(prop_details, "last_sale_price", missing)) ? predict_prop(prop_details, models_df=models_lettings_nolr_df) : predict_prop(prop_details, models_df=models_lettings_df)

# todo: make into a module to prevent leakage of internal variables
