#!/bin/julia
using Mux, JSON, Dates, DataFrames
import HTTP, ThreadsX

include((@__DIR__)*"/avm/predict.jl")
# include((@__DIR__)*"/kpis/kpis.jl")

include((@__DIR__)*"/habitable_rooms/habitable_rooms.jl")

include((@__DIR__)*"/nearby/property_lookup.jl")

include((@__DIR__)*"/hot_leads/hot_leads.jl")

include((@__DIR__)*"/kpis/kpis.jl")

queryparams(req) = HTTP.URIs.queryparams(req[:query])

API_VERSION = "0.0.6"
PORT = get(ENV, "JULIA_API_PORT", 39821)
IN_PRODUCTION = !isinteractive()

json_response(obj; headers = Dict()) = Dict(:body => String(JSON.json(obj)), :headers => merge(Dict(
    "Content-Type" => "application/json",
    "Cache-Control" => "max-age=$(IN_PRODUCTION ? 60*60*24 : 0)", # cache for a day in production, never in dev
), headers))


@app app = (
    IN_PRODUCTION ? Mux.prod_defaults : Mux.defaults,
    route("version", req ->
        return json_response(
            Dict("version" => API_VERSION);
            headers = Dict("Cache-Control" => "max-age=0"), # we will never want to cache this
        )
    ),
    route("ping", req -> json_response("pong")),
    route("querytest", req -> json_response(queryparams(req))),
    route("avm", req -> begin
            defaults = Dict(
                "lat" => missing,
                "lon" => missing,
                "bathrooms" => missing,
                "bedrooms"=> missing,
                "date" => string(Dates.today()),
                "prop_type" => "semi_detached",
                "postcode" => missing,
                "total_floor_area" => missing,
                #"last_sale_price" # easier to leave them out than set as missing
                #"last_sale_date"
            )
            d = merge(defaults, queryparams(req))
            ismissing(d["postcode"]) && throw("Postcode missing. Cannot proceed")
            return json_response(Dict(
                "estimate" => Dict(
                    "sales" => Dict(predict_sales(d)|>pairs),
                    "rent" => Dict(predict_rents(d)|>pairs),
                ),
                "details" => d,
            ))
        end
    ),
    route("uprn", req -> begin
            d = queryparams(req)
            uprns = parse.(Int,split(d["uprns"], ","))
            results = Dict(zip(uprns, ThreadsX.map(uprn -> doavm(uprn), uprns)))
            return json_response(results)
        end
    ),
    route("rooms", req -> begin
            defaults = Dict(
                "bedrooms" => missing,
                "bathrooms" => missing,
                "prop_type" => "semi_detached",
            )
            d = merge(defaults, queryparams(req))
            return json_response(Dict(
                "rooms" => predict_rooms(parse(Int,d["bedrooms"]), parse(Int,d["bathrooms"]), d["prop_type"])
            ))
        end
    ),
    route("bedroomsbathrooms", req -> begin
            defaults = Dict(
                "rooms" => missing,
                "prop_type_epc" => "House",
            )
            d = merge(defaults, queryparams(req))
            return json_response(Dict(
                predict_bedsbaths(parse(Int,d["rooms"]), d["prop_type_epc"]) |> pairs
            ))
        end
    ),
    route("updateleads", req -> begin
            done = update_hot_leads() # takes 5-10 minutes
            return json_response(Dict(
                "finished" => done,
                "time" => Dates.now(),
            ))
        end
    ),
    route("updatekpis", req -> begin
            done = update_kpis() # takes aaaaaages
            return json_response(Dict(
                "finished" => done,
                "time" => Dates.now(),
            ))
        end
    ),
    # route("kpis", req -> begin
    #         defaults = Dict(
    #             "date" => Date(Dates.now())|>string,
    #             "type" => "country",
    #             "grouping" => "quarter", # "month", "week"
    #             "byrow" => "true",
    #         )
    #         d = merge(defaults, queryparams(req))
    #         return json_response(Dict(
    #                 "kpis" => kpis(d["date"], d["type"], d["grouping"]) |> ((d["byrow"] == "true") ? eachrow : identity)
    #         ))
    #     end
    # ),
    Mux.notfound(),
)

server_task = serve(app, PORT)

IN_PRODUCTION && wait(server_task)
