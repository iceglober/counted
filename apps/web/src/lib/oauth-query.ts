export const oauthQuery = (query: Record<string, string | string[] | undefined>): string => {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (Array.isArray(value)) value.forEach((one) => params.append(name, one));
    else if (value !== undefined) params.set(name, value);
  }
  return params.toString();
};
