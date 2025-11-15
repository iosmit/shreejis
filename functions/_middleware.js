// CORS middleware for Cloudflare Functions
export async function onRequest(context) {
    const response = await context.next();

    // Add CORS headers
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight requests
    if (context.request.method === 'OPTIONS') {
        return new Response(null, {
            status: 200,
            headers: response.headers
        });
    }

    return response;
}

