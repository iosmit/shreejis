// Cloudflare Pages Function to verify password
// Password is stored as PASSWORD environment variable in Cloudflare Pages secrets
// Also checks customer passwords from CUSTOMERS_ORDERS CSV

export async function onRequestPost(context) {
    try {
        const { password } = await context.request.json();
        
        if (!password) {
            return new Response(
                JSON.stringify({ success: false, error: 'Password is required' }),
                {
                    status: 400,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                }
            );
        }

        const storePassword = context.env.PASSWORD;
        
        if (!storePassword) {
            console.error('PASSWORD not configured in environment');
            return new Response(
                JSON.stringify({ success: false, error: 'Password verification not configured' }),
                {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                }
            );
        }

        // Check if it's the store password
        if (password === storePassword) {
            return new Response(
                JSON.stringify({ success: true, type: 'store' }),
                {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                }
            );
        }

        // Check if it's a customer order password
        const customerOrdersUrl = context.env.CUSTOMERS_ORDERS;
        if (customerOrdersUrl) {
            try {
                const response = await fetch(customerOrdersUrl, {
                    headers: {
                        'Accept': 'text/csv',
                        'User-Agent': 'Mozilla/5.0 (compatible; POS-System/1.0)'
                    },
                    redirect: 'follow'
                });
                
                if (response.ok) {
                    const csvText = await response.text();
                    
                    // Simple CSV parsing (assuming first row is header, comma-separated)
                    const lines = csvText.split('\n').filter(line => line.trim());
                    if (lines.length > 1) {
                        // Skip header row, check each data row
                        for (let i = 1; i < lines.length; i++) {
                            const line = lines[i];
                            // Parse CSV line (handle quoted values)
                            const columns = [];
                            let current = '';
                            let inQuotes = false;
                            
                            for (let j = 0; j < line.length; j++) {
                                const char = line[j];
                                if (char === '"') {
                                    inQuotes = !inQuotes;
                                } else if (char === ',' && !inQuotes) {
                                    columns.push(current.trim());
                                    current = '';
                                } else {
                                    current += char;
                                }
                            }
                            columns.push(current.trim()); // Add last column
                            
                            if (columns.length >= 2) {
                                const customerName = columns[0] || '';
                                const customerPassword = columns[1] || '';
                                
                                if (customerPassword && customerPassword.trim() === password.trim()) {
                                    return new Response(
                                        JSON.stringify({ 
                                            success: true, 
                                            type: 'customer',
                                            customerName: customerName.trim()
                                        }),
                                        {
                                            status: 200,
                                            headers: {
                                                'Content-Type': 'application/json',
                                                'Access-Control-Allow-Origin': '*'
                                            }
                                        }
                                    );
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Error checking customer passwords:', error);
                // Continue to return incorrect password
            }
        }

        // Password not found
        return new Response(
            JSON.stringify({ success: false, error: 'Incorrect password' }),
            {
                status: 401,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            }
        );
    } catch (error) {
        console.error('Error verifying password:', error);
        return new Response(
            JSON.stringify({ success: false, error: error.message || 'Failed to verify password' }),
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
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    });
}

