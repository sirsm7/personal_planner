function normalizeUrl(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/\/+$/, '');
}

export async function onRequestGet(context) {
  const env = context && context.env ? context.env : {};
  const supabaseUrl = normalizeUrl(env.SUPABASE_URL);
  const supabaseAnonKey = typeof env.SUPABASE_ANON_KEY === 'string' ? env.SUPABASE_ANON_KEY.trim() : '';
  const rawSchema = typeof env.SUPABASE_SCHEMA === 'string' ? env.SUPABASE_SCHEMA.trim() : '';
  const supabaseSchema = rawSchema !== '' ? rawSchema : 'pap';
  const gasEndpointUrl = normalizeUrl(env.GAS_ENDPOINT_URL);

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  };

  if (!supabaseUrl || !/^https?:\/\/.+/i.test(supabaseUrl) || !supabaseAnonKey) {
    return new Response(
      JSON.stringify({
        error: 'Missing or invalid required Supabase environment variables.'
      }),
      {
        status: 500,
        headers
      }
    );
  }

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(supabaseSchema)) {
    return new Response(
      JSON.stringify({
        error: 'Invalid SUPABASE_SCHEMA format.'
      }),
      {
        status: 500,
        headers
      }
    );
  }

  return new Response(
    JSON.stringify({
      SUPABASE_URL: supabaseUrl,
      SUPABASE_ANON_KEY: supabaseAnonKey,
      SUPABASE_SCHEMA: supabaseSchema,
      GAS_ENDPOINT_URL: gasEndpointUrl
    }),
    {
      status: 200,
      headers
    }
  );
}