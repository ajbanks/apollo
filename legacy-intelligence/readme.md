# Installing dependencies

```bash
cd . # this directory
juliaup add +$(grep julia_version Manifest.toml | cut -d' ' -f3- | sed 's|"||g')
julia +$(grep julia_version Manifest.toml | cut -d' ' -f3- | sed 's|"||g') --project=. -e 'using Pkg; Pkg.instantiate()'
```

# Running

```bash
julia +$(grep julia_version Manifest.toml | cut -d' ' -f3- | sed 's|"||g') --project=. api.jl
```

# Environment variables

- `JULIA_API_PORT`: port to listen on, default 39821

# Routes

- `GET /ping`: returns `"pong"`

- `GET /avm`:
    query parameters:
        - postcode: mandatory
        - lat: optional
        - lon: optional
        - date: optional, yyyy-mm-dd or yyyy-mm or yyyy, defaults to today's date in that format
        - bathrooms: optional
        - bedrooms: optional
        - prop_type: optional, one of ["flat", "bungalow", "detached", "flat", "maisonette", "semi_detached", "terraced", "terraced_bungalow"], defaults to semi_detached
        - last_sale_price: optional, but model might give nonsense answers without
        - last_sale_date: optional, yyyy-mm-dd (e.g. 2021-05-07) but can accept yyyy (2021) or yyyy-mm (2021-05) without much loss of accuracy

    returns:
        - estimate:
            - {sales, rent}: {estimate, low, high, central_error=[80% of properties within low=estimate/central_error, high=estimate*central_error]}
                - more quantiles of error may be added later
        - details:
            - query parameters with defaults applied
                - date field returns time since epoch, will become a string later

- `GET /rooms`:
    query parameters:
        - bedrooms: mandatory,
        - bathrooms: optional,
        - prop_type: optional, one of ["flat", "bungalow", "detached", "flat", "maisonette", "semi_detached", "terraced", "terraced_bungalow"], defaults to semi_detached

    returns:
        - rooms: number of habitable rooms on EPC

- `GET /bedroomsbathrooms`:
    query parameters:
        - rooms: mandatory, number of habitable rooms from EPC
        - prop_type_epc: optional, one of ["House", "Flat", "Bungalow", "Maisonette", "Park Home"], defaults to House.

    returns:
        - bedrooms
        - bathrooms

- `GET /uprn`: query paramenter: `uprns`: comma-separated list of UPRNs, returns a JSON object of `{uprn => {sales, rents, known, imputed}}`

- `GET /updateleads`: no parameters, updates the hot_leads and vw_hot_leads_new_today tables/views. takes approx 10 minutes. returns e.g. `{"time":"2025-04-24T13:42:45.842","finished":true}`

- `GET /updatekpis`: no parameters, updates the location_kpis_V3_3* tables. takes approx 2-3 hours! returns e.g. `{"time":"2025-04-24T13:42:45.842","finished":true}`


# Development

- need to run `]pin --all` in REPL each time a dependency is added for reproducibility


# Retraining the model

Retraining the model will update the relevant file in avm/models_bin/. It is quite noisy on STDOUT.

## Environment variables

The `TRAINING_CHANNEL` is the most important; it specifies whether to train for letting (RES_LET) or sales (RES_BUY). Other channels might work but are untested and not accessible from the API.

Note that `CLICKHOUSE_NATIVE_PORT` is the native port instead of the HTTP port.

```julia
CLICKHOUSE_USER = get(ENV,"CLICKHOUSE_USER", "admin")
CLICKHOUSE_DB = get(ENV,"CLICKHOUSE_DB", "default")
CLICKHOUSE_DB_RAW = get(ENV,"CLICKHOUSE_DB", "raw")
CLICKHOUSE_PASSWORD = get(ENV,"CLICKHOUSE_PASSWORD", "")
CLICKHOUSE_NATIVE_PORT = parse(Int,get(ENV,"CLICKHOUSE_NATIVE_PORT", "9000"))
CLICKHOUSE_HOST = get(ENV,"CLICKHOUSE_HOST", "localhost")
TRAINING_CHANNEL = get(ENV,"TRAINING_CHANNEL", "RES_BUY")
```

## Training

```bash
env TRAINING_CHANNEL=RES_BUY julia --project=. avm/train.jl # takes about 10GB of RAM and 10 minutes
env TRAINING_CHANNEL=RES_LET julia --project=. avm/train.jl # 10GB RAM, 5 minutes
env USE_LAND_REG=false TRAINING_CHANNEL=RES_BUY julia --project=. avm/train.jl # train models without 'last sold' data
env USE_LAND_REG=false TRAINING_CHANNEL=RES_LET julia --project=. avm/train.jl
```

## Testing

```bash
julia --project=. avm/test.jl
```

Should spit out some reasonable prices without any warnings, e.g.

```bash
predict_prop(iow) = (estimate = 396490.97, low = 340249.38, high = 462029.03, central_error = 1.1652952)
predict_prop(man) = (estimate = 412425.38, low = 366766.91, high = 463767.82, central_error = 1.1244891)
predict_prop(rea) = (estimate = 299325.91, low = 273373.64, high = 327741.91, central_error = 1.0949333)
predict_prop(rea2) = (estimate = 405121.56, low = 369996.56, high = 443581.1, central_error = 1.0949333)
predict_rents(iow) = (estimate = 1143.233, low = 1015.8764, high = 1286.5559, central_error = 1.1253663)
predict_rents(man) = (estimate = 1955.345, low = 1716.0918, high = 2227.9543, central_error = 1.1394175)
```
