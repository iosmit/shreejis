// Cloudflare Pages Function to save receipt to Google Sheets

export async function onRequestPost(context) {
    try {
        const requestData = await context.request.json();
        
        console.log('Received receipt data:', JSON.stringify(requestData).substring(0, 200));
        
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

        console.log('Sending receipt to Google Sheets webhook...');
        
        // Create abort controller for timeout (mobile networks can be slow)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            console.warn('Request timeout - aborting save receipt request');
            controller.abort();
        }, 25000); // 25 second timeout
        
        try {
            const response = await fetch(sheetsWebhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (compatible; POS-System/1.0)'
                },
                body: JSON.stringify(requestData),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Google Sheets webhook returned error:', response.status, errorText);
                throw new Error(`Failed to save receipt: ${response.status} ${response.statusText}`);
            }

            const result = await response.json();
            console.log('Receipt saved successfully to Google Sheets:', result);
            
            return new Response(JSON.stringify({ success: true, message: 'Receipt saved successfully', ...result }),
                {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0'
                    }
                }
            );
        } catch (fetchError) {
            clearTimeout(timeoutId);
            
            if (fetchError.name === 'AbortError') {
                console.error('Request to Google Sheets timed out');
                return new Response(
                    JSON.stringify({ success: false, error: 'Request timed out - please check your network connection' }),
                    {
                        status: 500,
                        headers: {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        }
                    }
                );
            }
            
            throw fetchError;
        }
    } catch (error) {
        console.error('Error saving receipt to Google Sheets:', error);
        console.error('Error stack:', error.stack);
        return new Response(
            JSON.stringify({ 
                success: false,
                error: error.message || 'Failed to save receipt' 
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

