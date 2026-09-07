/**
 * GeoLocator — the country an address is in, answered locally.
 *
 * A port for two reasons that are both about what it must *not* be able to do.
 *
 * **It is synchronous, and that is the contract, not an implementation detail.**
 * A `Promise` here would leave the door open to an implementation that calls a
 * geolocation service per event, which would put a network round trip on the
 * ingest hot path and hand a third party the address of every one of a
 * customer's users. The signature makes that impossible to write.
 *
 * **It takes a string and returns a country, so the address does not survive
 * the call.** There is no locator method that returns a city, a region, a
 * latitude, an ASN or a normalised address. Nothing downstream can ask for
 * more than two letters, because there is nothing more to ask for.
 *
 * The implementation is `@counted/ingestion-adapter-geoip`, which binary-
 * searches a bundled registry-derived prefix table. Swapping it for a commercial
 * database is a constructor change; swapping it for a service is a rewrite, on
 * purpose.
 */

import type { CountryCode } from "@counted/ingestion-domain";

export interface GeoLocator {
  /**
   * The country of one address, or `null` when it cannot be placed.
   *
   * `null` is the answer for a private range, an unparseable string, address
   * space no registry has delegated, and a block held across the European Union
   * rather than in one country. The caller must not distinguish them: they are
   * one fact — we do not know — and each would otherwise become a bucket in a
   * chart that reads like a place.
   */
  countryOf(address: string): CountryCode | null;
}
