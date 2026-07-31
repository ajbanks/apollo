#!/bin/julia

using CSV, DataFrames

habitable_lookup = CSV.read((@__DIR__)*"/rooms2bedsbaths.csv", DataFrame)
bedsbaths_lookup = CSV.read((@__DIR__)*"/bedsbaths2rooms.csv", DataFrame)

"""
Given a rightmove property type and a number of bedrooms and bathrooms, predict
the total number of habitable rooms
"""
function predict_rooms(beds, baths, prop_type)
    try
        return habitable_lookup[(prop_type .== habitable_lookup.property_type) .& (beds .== habitable_lookup.bedrooms) .& (baths .== habitable_lookup.bathrooms), :NUMBER_HABITABLE_ROOMS] |> first
    catch (e)
        # Fallback to results of linear regression
        return max(1, round((beds - 0.5)*2) |> Int)
    end
end

"""
Given an EPC property type and a number of habitable rooms, predict
the total number of bedrooms and bathrooms
"""
function predict_bedsbaths(rooms, prop_type)
    try
        return bedsbaths_lookup[
            (prop_type .== bedsbaths_lookup.PROPERTY_TYPE) .& (rooms .== bedsbaths_lookup.NUMBER_HABITABLE_ROOMS), [:bedrooms, :bathrooms]
            ] |> first |> NamedTuple
    catch (e)
        # Fallback to results of linear regression
        return (bedrooms = max(1, round(rooms/2 + 0.5) |> Int), bathrooms = max(1, round(rooms/4 + 0.4) |> Int))
    end
end
