export {};

type DenoRuntime = {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const denoRuntime = (globalThis as typeof globalThis & { Deno: DenoRuntime }).Deno;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const getAuthenticatedUser = async (authorization: string) => {
  const supabaseUrl = denoRuntime.env.get('SUPABASE_URL');
  const anonKey = denoRuntime.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) throw new Error('Supabase authentication is not configured.');
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authorization },
  });
  if (!response.ok) return null;
  return await response.json();
};

const verifyAdultVendor = async (userId: string, authorization: string) => {
  const supabaseUrl = denoRuntime.env.get('SUPABASE_URL');
  const anonKey = denoRuntime.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) throw new Error('Supabase database access is not configured.');
  const query = new URLSearchParams({
    id: `eq.${userId}`,
    select: 'id,is_verified,ai_adult_confirmed',
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/vendors?${query}`, {
    headers: { apikey: anonKey, Authorization: authorization },
  });
  if (!response.ok) throw new Error('Could not verify vendor eligibility.');
  const rows = await response.json();
  const vendor = Array.isArray(rows) ? rows[0] : null;
  if (!vendor) return { allowed: false, status: 404, error: 'Vendor profile not found.' };
  if (vendor.ai_adult_confirmed !== true) {
    return { allowed: false, status: 403, error: 'Confirm that you are 18 or older before using AI assistance.' };
  }
  if (vendor.is_verified !== true) {
    return { allowed: false, status: 403, error: 'Your vendor account must be approved before using AI assistance.' };
  }
  return { allowed: true as const };
};

const generateDescription = async (apiKey: string, input: {
  name: string;
  category: string;
  ingredients: string;
}) => {
  const prompt = [
    'Write one appealing, concise menu description for a food-ordering app.',
    'Use only the facts explicitly supplied below. Never invent ingredients, allergens, preparation methods, origin, health claims, portion size, or availability.',
    'If ingredients are not supplied, describe only the dish name and category without implying specific ingredients.',
    'Return only the description, in one or two sentences, under 55 words.',
    `Dish name: ${input.name}`,
    `Category: ${input.category || 'Not specified'}`,
    `Vendor-provided ingredients/details: ${input.ingredients || 'None supplied'}`,
  ].join('\n');

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      model: 'gemini-3.8-flash',
      input: prompt,
      store: false,
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    console.error(
      'Gemini description request failed:',
      response.status,
      payload?.error?.status ?? 'unknown',
      payload?.error?.message ?? 'No error message returned',
    );
    throw new Error(response.status === 429
      ? 'AI usage limit reached. Please try again later.'
      : 'The AI description service is unavailable right now.');
  }
  const description = payload?.steps
    ?.filter((step: { type?: unknown }) => step.type === 'model_output')
    .flatMap((step: { content?: { type?: unknown; text?: unknown }[] }) => step.content ?? [])
    .map((part: { type?: unknown; text?: unknown }) => part.type === 'text' && typeof part.text === 'string' ? part.text : '')
    .join('')
    .trim();
  if (typeof description !== 'string' || !description || description.length > 600) {
    throw new Error('The AI did not return a usable description. Please try again.');
  }
  return description;
};

denoRuntime.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return jsonResponse({ error: 'Sign in to continue.' }, 401);

  try {
    const user = await getAuthenticatedUser(authorization);
    if (typeof user?.id !== 'string') return jsonResponse({ error: 'Unauthorized.' }, 401);
    const eligibility = await verifyAdultVendor(user.id, authorization);
    if (!eligibility.allowed) return jsonResponse({ error: eligibility.error }, eligibility.status);

    const body = await request.json();
    if (body?.action !== 'generate_menu_description') {
      return jsonResponse({ error: 'Unsupported AI action.' }, 400);
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const category = typeof body.category === 'string' ? body.category.trim() : '';
    const ingredients = typeof body.ingredients === 'string' ? body.ingredients.trim() : '';
    if (!name || name.length > 100 || category.length > 80 || ingredients.length > 500) {
      return jsonResponse({ error: 'Enter a dish name and keep its details within the field limits.' }, 400);
    }

    const apiKey = denoRuntime.env.get('GEMINI_API_KEY');
    if (!apiKey) throw new Error('AI is not configured. Set GEMINI_API_KEY in Supabase Edge Function secrets.');
    const description = await generateDescription(apiKey, { name, category, ingredients });
    return jsonResponse({ description });
  } catch (error) {
    console.error('Vendor AI assistant failed:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Could not generate a description.',
    }, 500);
  }
});
