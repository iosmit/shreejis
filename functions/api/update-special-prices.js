// Cloudflare Pages Function to update special prices for a customer

export async function onRequestPost(context) {
    try {
        const requestData = await context.request.json();
        const { customerName, specialPrices } = requestData;
        
        if (!customerName) {
            return new Response(
                JSON.stringify({ success: false, error: 'Customer name is required' }),
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
                JSON.stringify({ success: false, error: 'SHEETS_WEBHOOK_URL not configured' }),
                {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                }
            );
        }

        // Send update request to Google Apps Script
        const response = await fetch(sheetsWebhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: 'updateSpecialPrices',
                customerName: customerName,
                specialPrices: specialPrices || {}
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Google Sheets webhook returned error:', response.status, errorText);
            throw new Error(`Failed to update special prices: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();

        return new Response(
            JSON.stringify(result),
            {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0'
                }
            }
        );
    } catch (error) {
        console.error('Error updating special prices:', error);
        return new Response(
            JSON.stringify({ 
                success: false,
                error: error.message || 'Failed to update special prices' 
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
}

// Handle OPTIONS for CORS preflight
export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    });
}

