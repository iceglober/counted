/** Stripe charges use two decimals for ISK/UGX despite their ISO display units.
 * https://docs.stripe.com/currencies#special-cases
 */
export function money(amount: number, currency: string): string {
  const code = currency.toUpperCase();
  const format = new Intl.NumberFormat("en-US", { style: "currency", currency: code });
  const decimals = ["ISK", "UGX", "HUF", "TWD"].includes(code) ? 2 : format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(amount / 10 ** decimals);
}
