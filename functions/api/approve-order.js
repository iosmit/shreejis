// Cloudflare Pages Function to approve or disapprove an order

export async function onRequestPost(context) {
    try {
        const requestData = await context.request.json();
        const { customerName, approved } = requestData;
        
        if (!customerName || approved === undefined) {
            return new Response(
                JSON.stringify({ error: 'Missing required fields' }),
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

        // Send approve/disapprove request to Google Apps Script
        const response = await fetch(sheetsWebhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: 'approveOrder',
                customerName: customerName,
                approved: approved
            })
        });
        
        if (!response.ok) {
            throw new Error(`Failed to ${approved ? 'approve' : 'disapprove'} order: ${response.status} ${response.statusText}`);
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
        console.error('Error approving/disapproving order:', error);
        return new Response(
            JSON.stringify({ error: error.message || 'Failed to process order' }),
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

