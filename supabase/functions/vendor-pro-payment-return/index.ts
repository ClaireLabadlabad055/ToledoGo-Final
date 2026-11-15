type DenoRuntime = {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const denoRuntime = (globalThis as typeof globalThis & { Deno: DenoRuntime }).Deno;

const releaseCancelledCheckout = async (reference: string) => {
  const supabaseUrl = denoRuntime.env.get('SUPABASE_URL');
  const serviceKey = denoRuntime.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase service-role credentials are not configured.');
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/release_vendor_pro_checkout_by_reference`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_reference: reference }),
  });
  if (!response.ok) {
    console.error('Failed to release cancelled PayMongo checkout:', response.status, (await response.text()).slice(0, 240));
    throw new Error('Could not release the cancelled checkout reservation.');
  }
};

denoRuntime.serve(async (request) => {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const returnUrl = new URL(request.url);
  const status = returnUrl.searchParams.get('status');
  const succeeded = status === 'success';
  if (status === 'cancelled') {
    const reference = returnUrl.searchParams.get('reference');
    if (reference && /^TGPRO-[0-9a-f-]{36}$/i.test(reference)) {
      try {
        await releaseCancelledCheckout(reference);
      } catch {
        return new Response('The checkout was cancelled, but its reservation could not be cleared. Please contact support before retrying.', {
          status: 500,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }
    }
  }
  const title = succeeded ? 'Payment submitted' : 'Checkout cancelled';
  const message = succeeded
    ? 'PayMongo is processing your payment confirmation. Return to ToledoGo and refresh your vendor dashboard. Pro access is enabled only after payment is confirmed.'
    : 'No Pro payment was confirmed. You can return to ToledoGo and try again whenever you are ready.';
  const appUrl = `toledogo://vendor/dashboard?payment=${succeeded ? 'success' : 'cancelled'}`;

  return new Response(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <title>${title} | ToledoGo</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fff9f2; color: #292524; font: 16px system-ui, sans-serif; }
      main { box-sizing: border-box; width: min(92%, 32rem); padding: 2rem; border: 1px solid #eadfd5; border-radius: 1rem; background: white; }
      h1 { margin-top: 0; color: #7c2d12; }
      a { display: inline-block; margin-top: 1rem; padding: .8rem 1rem; border-radius: .6rem; background: #9a3412; color: white; text-decoration: none; font-weight: 600; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${message}</p>
      <a href="${appUrl}">Return to ToledoGo</a>
    </main>
    <script>
      window.location.replace(${JSON.stringify(appUrl)});
    </script>
  </body>
</html>`, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
});
