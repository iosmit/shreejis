// Cloudflare Pages Function to get receipts for a customer

export async function onRequestGet(context) {
    try {
        const url = new URL(context.request.url);
        const customerName = url.searchParams.get('customer');
        
        if (!customerName) {
            return new Response(
                JSON.stringify({ error: 'Customer name is required' }),
                {
                    status: 400,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                }
            );
        }

        // Get the SHEETS_WEBHOOK_URL from environment variables
        const sheetsWebhookUrl = context.env.SHEETS_WEBHOOK_URL;
        
        if (!sheetsWebhookUrl) {
            return new Response(
                JSON.stringify({ error: 'SHEETS_WEBHOOK_URL not configured' }),
                {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                }
            );
        }

        // Get receipts for the customer from Google Sheets
        const getReceiptsUrl = sheetsWebhookUrl.replace('/exec', '') + '?action=getReceipts&customer=' + encodeURIComponent(customerName);

        const response = await fetch(getReceiptsUrl);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch receipts: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        return new Response(JSON.stringify(data), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
    } catch (error) {
        console.error('Error fetching receipts:', error);
        return new Response(
            JSON.stringify({ error: error.message || 'Failed to fetch receipts' }),
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

