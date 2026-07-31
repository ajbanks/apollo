#!/bin/julia

using Serialization, TranscodingStreams, CodecZstd, ClickHouse, StatsBase, JSON
import XGBoost

"Write a Julia object to disk using Zstd compression"
function write_zstd(filename, data)
    io = open(filename, "w")
    io = TranscodingStream(ZstdCompressor(), io)
    serialize(io, data)
    close(io)
end

"Read a Zstd-compressed Julia object from disk"
function read_zstd(filename)
    io = open(filename)
    io = TranscodingStream(ZstdDecompressor(), io)
    data = deserialize(io)
    close(io)
    data
end

"""
Convert a categorical DataFrame to a series of one hot columns in place
"""
column2onehot!(df, col_name; prefix="one_hot_") = begin
    names = unique(df[!,col_name])
    one_hot_cols = Symbol.(prefix.*names)
    transform!(groupby(df, col_name), g -> begin
        NamedTuple(Symbol(prefix*n) => g[!, col_name] .== n for n in names)
    end)
    (one_hot_cols, df)
end

"Convert an XGBoost Booster object to a UInt8 array, preserving missingness"
function boost2uint(booster)
    io = IOBuffer()
    XGBoost.save(booster, io)
    s = take!(io)# |> String
    close(io)
    s
end
boost2uint(b::Missing) = missing

"Convert a UInt8 array to a XGBoost Booster object, preserving missingness"
uint2boost(str::Vector{UInt8}) = XGBoost.load(XGBoost.Booster, str)
uint2boost(x::Missing) = missing
uint2boost(x::XGBoost.Booster) = x

"Bounding box for the UK"
UK_POLYGON = "[(-14.015517, 49.674), (-14.015517, 61.061), (2.0919117, 61.061), (2.0919117, 49.674)]"
# todo: add more vertices
# investigate further use of https://clickhouse.com/docs/en/sql-reference/functions/geo
# esp h3 / s2 indices. sparse h3 index could make better division than postcode

CLICKHOUSE_USER = get(ENV,"CLICKHOUSE_USER", "admin")
CLICKHOUSE_DB = get(ENV,"CLICKHOUSE_DB", "pristine")
CLICKHOUSE_DB_RAW = get(ENV,"CLICKHOUSE_DB_RAW", "raw")
CLICKHOUSE_PASSWORD = get(ENV,"CLICKHOUSE_PASSWORD", "")
CLICKHOUSE_NATIVE_PORT = parse(Int,get(ENV,"CLICKHOUSE_NATIVE_PORT", "9000"))
CLICKHOUSE_HOST = get(ENV,"CLICKHOUSE_HOST", "localhost")
TRAINING_CHANNEL = get(ENV,"TRAINING_CHANNEL", "RES_BUY")
MAX_CLICKHOUSE_QUERY_SIZE = 10_000
H3_PERMITTED_RESOLUTIONS = [11, 9, 7]

"Connect to the ClickHouse server"
con() = connect(CLICKHOUSE_HOST, CLICKHOUSE_NATIVE_PORT; database=CLICKHOUSE_DB, username=CLICKHOUSE_USER, password = CLICKHOUSE_PASSWORD)

"Connect to the raw ClickHouse database"
con_raw() = connect(CLICKHOUSE_HOST, CLICKHOUSE_NATIVE_PORT; database=CLICKHOUSE_DB_RAW, username=CLICKHOUSE_USER, password = CLICKHOUSE_PASSWORD)

"Convert an array of strings to a ClickHouse tuple"
julia2clickhouse(v) = begin
    "('" * join(v, "', '", ) * "')"
end

"Convert a dataframe into a dict for use with ClickHouse.insert"
df2dict(df) = Dict(n => c for (n,c) in Iterators.zip(Symbol.(names(df)), eachcol(df)))

"Get column names => type for ClickHouse from dataframe"
chtypes(df) = Dict(zip(names(df), maybeNullableElString.(eachcol(df))))

toChArrayStr(t) = begin
    if (t <: AbstractArray)
        return "Array($(eltype(t)))"
    end
    return string(t)
end

maybeNullableElString(column) = begin
    t = eltype(column)
    return if (nonmissingtype(t) == t)
        toChArrayStr(t)
    else
        "Nullable($(toChArrayStr(nonmissingtype(t))))"
    end
end

"Convert dict of type strings to ClickHouse table specification"
tablespec(types) = "(" * join(("$k $v" for (k,v) in types), ", ") * ")"

"Make a function ignore all missing data"
headinsand(f, x) = begin
    x = skipmissing(x)
    isempty(x) && return missing
    f(x)
end
headinsand(f) = x -> headinsand(f, x) # or Base.Fix1(headinsand, f)

# can use groupby via combine(groupby(df, :channel), d -> addquantiles!(d, :entry_to_agreed_days))
"Add [column]_quantile to a dataframe. If jiggle=true, no ties are allowed"
addquantiles!(df, column; jiggle=false) = begin
    if (!jiggle) 
        raw = ecdf(df[!, column]).(df[!, column])
        raw = raw .- minimum(raw)
        raw = raw ./ maximum(raw)
        return df[!, Symbol(string(column) * "_quantile")] = raw
    end
    l = size(df,1)
    tdf = copy(df[!, [column]])
    tdf.id = 1:l
    sort!(tdf, column)
    tdf.q = (1:l)./l
    sort!(tdf, :id)
    return df[!, Symbol(string(column) * "_quantile")] = tdf.q
end

"Get actual-value labels for quantiles. Fudge 0/1 to 0.0001/0.9999"
quantilelabels(array; middle = [0.2, 0.4, 0.6, 0.8], nonlinear=false, n=8) = begin
    !nonlinear && return ([0, middle..., 1], round.(quantile.(Ref(array), [0.0001, middle..., 0.9999]), sigdigits=2))
    f = ecdf(array)
    vs = range(quantile(array, 0.0001), quantile(array, 0.9999), n)
    qs = f.(vs)
    return (qs, round.(vs, sigdigits=2))
end

using Interpolations
"Get actual-value scale from normalised values, fudging 0/1"
function jsonscale(df, normalised, actual)
    d = @view df[.!nonunique(df, normalised, keep=:first), [normalised, actual]]
    sort!(d, normalised)
    f = linear_interpolation(d[!,normalised], d[!,actual], extrapolation_bc=Flat())
    JSON.json(Dict("scale" => Dict(zip([0, 0.2, 0.4, 0.6, 0.8, 1], round.(f.([0.0001, 0.2, 0.4, 0.6, 0.8, 0.9999]), sigdigits=2)))))
end


"Convert an EPC age band to an integer"
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

"Stick columns at the front for easy viewing"
atfront(df, cols) = DataFrames.select(df, cols..., Not(cols...))
