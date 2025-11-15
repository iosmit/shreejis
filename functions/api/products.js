// Cloudflare Pages Function to proxy CSV requests
// This keeps the Google Sheets URL hidden from client-side code

export async function onRequestGet(context) {
    try {
        // Get the STORE_PRODUCTS URL from environment variables
        const storeProductsUrl = context.env.STORE_PRODUCTS;
        
        if (!storeProductsUrl) {
            return new Response(
                JSON.stringify({ error: 'STORE_PRODUCTS URL not configured' }),
                {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                }
            );
        }

        // Fetch CSV from Google Sheets (server-side, URL is hidden)
        const response = await fetch(storeProductsUrl);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`);
        }

        const csvText = await response.text();

        // Return CSV with proper headers
        return new Response(csvText, {
            status: 200,
            headers: {
                'Content-Type': 'text/csv',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
            }
        });
    } catch (error) {
        console.error('Error fetching products CSV:', error);
        return new Response(
            JSON.stringify({ error: error.message || 'Failed to fetch products' }),
            {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            }
        );
    }
}

// Handle OPTIONS for CORS preflight
export async function onRequestOptions() {
    return new Response(null, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    });
}

