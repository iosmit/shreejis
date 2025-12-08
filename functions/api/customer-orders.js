// Cloudflare Pages Function to proxy customer orders CSV requests
// This keeps the Google Sheets URL hidden from client-side code

export async function onRequestGet(context) {
    try {
        // Get the CUSTOMERS_ORDERS from environment variables
        const customerOrdersUrl = context.env.CUSTOMERS_ORDERS;
        
        if (!customerOrdersUrl) {
            console.error('CUSTOMERS_ORDERS not configured in environment');
            return new Response(
                JSON.stringify({ error: 'CUSTOMERS_ORDERS not configured' }),
                {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                }
            );
        }

        console.log('Fetching customer orders CSV from:', customerOrdersUrl);
        
        // Fetch CSV from Google Sheets (server-side, URL is hidden)
        const response = await fetch(customerOrdersUrl, {
            headers: {
                'Accept': 'text/csv',
                'User-Agent': 'Mozilla/5.0 (compatible; POS-System/1.0)'
            },
            redirect: 'follow'
        });
        
        if (!response.ok) {
            throw new Error(`Failed to fetch customer orders CSV: ${response.status} ${response.statusText}`);
        }

        const csvText = await response.text();
        console.log('Customer orders CSV fetched successfully, length:', csvText.length);

        // Verify it's actually CSV, not HTML
        if (csvText.trim().startsWith('<!DOCTYPE') || csvText.trim().startsWith('<html')) {
            console.error('Received HTML instead of CSV. The Google Sheets URL may not be published correctly.');
            return new Response(
                JSON.stringify({ 
                    error: 'Received HTML instead of CSV. Please ensure the Google Sheet is published as CSV and the URL is correct.' 
                }),
                {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                }
            );
        }

        // Return CSV with proper headers
        return new Response(csvText, {
            status: 200,
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
    } catch (error) {
        console.error('Error fetching customer orders CSV:', error);
        return new Response(
            JSON.stringify({ error: error.message || 'Failed to fetch customer orders' }),
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

