/**
 * @counted/ingestion-adapter-geoip — country from an address, locally.
 *
 * The bundled table is generated from the five regional internet registries'
 * delegated statistics by `scripts/build-country-table.ts`. It is committed and
 * is not drift-checked: the registries republish daily, so a check against a
 * fresh download would fail every morning for reasons nobody caused. Rebuild it
 * deliberately with `bun run geo:build`.
 *
 * This package holds the *only* code in the system that reads an IP address.
 * Nothing it exports returns one.
 */

export { addressKey, V6_KEY_BITS, type AddressKey } from "./address";
export { BundledGeoLocator, loadCountryTable, TABLE_PATH } from "./locator";
export {
  countryOfKey,
  decodeCountryTable,
  MAGIC,
  VERSION,
  type CountryTable,
} from "./table";
