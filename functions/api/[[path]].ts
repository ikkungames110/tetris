// Keep the browser on the Pages origin. The API Worker is only reachable through
// this binding, so cookies need neither cross-site access nor a public API token.
export const onRequest = (context: {
  request: Request;
  env: { API: { fetch(request: Request): Promise<Response> } };
}): Promise<Response> => context.env.API.fetch(context.request);
