#!/bin/julia

include("./predict.jl")

man = Dict(
    "lat" => "54.45834410476058",
    "lon" => "-2.211351045865188",
    "bathrooms" => "2",
    "bedrooms"=>"6",
    "date" => string(Dates.today()),
    "prop_type" => "semi_detached", # | bungalow | detached | flat | maisonette | semi_detached | terraced | terraced_bungalow
    "postcode" => "M14 5PT",
    "last_sale_price" => "195000",
    "last_sale_date" => "2014"
)

# http get request
# http://localhost:39821/avm?lat=54.45834410476058&lon=-2.211351045865188&bathrooms=2&bedrooms=6&prop_type=semi_detached&postcode=M14 5PT&last_sale_price=195000&last_sale_date=2014&date=2024-01-01

iow = Dict(
    "lat" => "50.62902",
    "lon" => "-1.18183",
    "bathrooms" => "2",
    "bedrooms"=> "3",
    "date" => string(Dates.today()),
    "prop_type" => "semi_detached", # | bungalow | detached | flat | maisonette | semi_detached | terraced | terraced_bungalow
    "postcode" => "PO37 7NS",
    "total_floor_area" => "120",
    "last_sale_price" => "69950",
    "last_sale_date" => "1997-11-03",
)

# todo: add lat/lon
rea = Dict(
    "bathrooms" => "2",
    "bedrooms"=>"2",
    "date" => string(Dates.today()),
    "prop_type" => "flat", # | bungalow | detached | flat | maisonette | semi_detached | terraced | terraced_bungalow
    "postcode" => "RG6 1FP",
    "last_sale_price" => "295000",
    "last_sale_date" => "2021-03-17",
)

rea2 = Dict(
    "bathrooms" => "1",
    "bedrooms"=>"3",
    "date" => string(Dates.today()),
    "prop_type" => "semi_detached", # | bungalow | detached | flat | maisonette | semi_detached | terraced | terraced_bungalow
    "postcode" => "RG30 2NY",
    # "last_sale_price" => "213000",
    # "last_sale_date" => "2008-01-11",
    "last_sale_price" => "385000",
    "last_sale_date" => "2021-09-30",
)

@show predict_prop(iow)
@show predict_prop(man)
@show predict_prop(rea) # Nico says this should be about 300k
@show predict_prop(rea2) # Nico says this should be about 385k
@show predict_rents(iow)
@show predict_rents(man)
