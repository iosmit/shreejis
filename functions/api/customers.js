// Cloudflare Pages Function to proxy customers CSV requests
// This keeps the Google Sheets URL hidden from client-side code

export async function onRequestGet(context) {
    try {
        // Get the CUSTOMERS_URL from environment variables
        const customersUrl = context.env.CUSTOMERS_URL;
        
        if (!customersUrl) {
            return new Response(
                JSON.stringify({ error: 'CUSTOMERS_URL not configured' }),
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
        const response = await fetch(customersUrl);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`);
        }

        const csvText = await response.text();

        // Return CSV with proper headers
        // Use no-cache to prevent browser/CDN from serving stale data
        return new Response(csvText, {
            status: 200,
            headers: {
                'Content-Type': 'text/csv',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
    } catch (error) {
        console.error('Error fetching customers CSV:', error);
        return new Response(
            JSON.stringify({ error: error.message || 'Failed to fetch customers' }),
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

