# @counted/ingestion-adapter-geoip

Country from a request address, in-process. The only package in the repository
that reads an IP address, and nothing it exports returns one.

```ts
import { BundledGeoLocator } from "@counted/ingestion-adapter-geoip";

const geo = BundledGeoLocator.bundled();
geo.countryOf("8.8.8.8");        // "US"
geo.countryOf("2a00:1450::1");   // "IE"
geo.countryOf("10.0.0.1");       // null
```

## Why it works this way

**No network call.** `GeoLocator` is synchronous, and that is the contract
rather than an implementation detail: a `Promise` would leave the door open to a
geolocation *service*, which would put a round trip on the ingest hot path and
hand a third party the address of every one of a customer's users. The signature
makes that impossible to write.

**Two letters out, nothing else.** There is no method that returns a city, a
region, a latitude, an ASN, or the address back. Nothing downstream can ask for
more than a country because there is nothing more to ask for. The address is an
argument to one function and is unreachable after it returns.

**`null` is a real answer.** A private range, an unparseable header, address
space no registry has delegated, and a block held across the European Union
rather than in one country all come back `null`. Callers must not distinguish
them — they are one fact, *we do not know* — and each would otherwise become a
bucket in a chart that reads like a place.

## What it costs to be wrong

The table is built from the five regional internet registries' delegated
statistics, so the answer is **allocation-level**. An address inside a block a
multinational carrier registered in one country reads as that country wherever
the person physically is, and a VPN reads as its exit node. Country-level
registry lookup is right most of the time and is systematically wrong for large
roaming carriers.

That is the accuracy this product buys with a lookup that never leaves the
process, and it is why the dimension is `country` and not `city`. A country
breakdown is a coarse, honest slice. It is not a location.

## The table

`data/ip-country.bin` — about 950 KiB, ~150k IPv4 boundaries and ~136k IPv6,
delta-encoded varints. It decodes into two typed arrays in a few milliseconds at
startup; a lookup is one binary search and allocates nothing.

IPv6 is keyed on the top 48 bits. Registry delegations are /48 or shorter (three
records in the whole dataset are longer, and the generator drops rather than
widens them), and 48 bits is the largest integer still exact in a double — a
BigInt key would be correct and would allocate per event.

Rebuild it with `bun run geo:build` from the repository root. It is **committed
and never drift-checked**: the registries republish daily, so a
`git diff --exit-code` against a fresh download would fail every morning for
reasons nobody caused. `BundledGeoLocator.generatedAt` exposes the build date so
a caller can log the age at startup, which `apps/api/src/main.ts` does.

Registry data is published by the RIRs for open use, which is what lets the
table live in an MIT repository with no attribution clause and no per-lookup
service. A commercial database would be more precise about *where in a country*
an address is — the question this product deliberately never asks.
