/** JSON API transport. Bodyless requests must not advertise an empty JSON document. */
export function cloudClient(baseUrl: string, token: string, fetcher: typeof fetch = fetch) {
  return async (path: string, method: string, body?: unknown): Promise<unknown> => {
    const response = await fetcher(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`${method} ${path} failed with ${String(response.status)}`);
    return response.status === 204 ? null : ((await response.json()) as unknown);
  };
}
