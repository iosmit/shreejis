// Local development server for POS system
// Serves static files from the build directory

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'build', '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Proxy endpoint to fetch CSV from Google Sheets (keeps URL hidden)
// MUST be defined BEFORE static files and catch-all route
app.get('/api/products', async (req, res) => {
    try {
        const storeProductsUrl = process.env.STORE_PRODUCTS;
        
        if (!storeProductsUrl) {
            console.error('STORE_PRODUCTS URL not configured in environment');
            return res.status(500).json({ error: 'STORE_PRODUCTS URL not configured' });
        }

        console.log('Fetching CSV from:', storeProductsUrl);
        
        // Fetch CSV from Google Sheets (server-side, URL is hidden)
        const response = await fetch(storeProductsUrl);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`);
        }

        const csvText = await response.text();
        console.log('CSV fetched successfully, length:', csvText.length);

        // Return CSV with proper headers
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes
        res.send(csvText);
    } catch (error) {
        console.error('Error fetching products CSV:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch products' });
    }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'build')));

// Serve index.html for all other routes (SPA routing)
// MUST be last to not interfere with API routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 POS Server running on http://localhost:${PORT}`);
    console.log(`📦 Serving files from: ${path.join(__dirname, 'build')}`);
    console.log(`\n💡 Open http://localhost:${PORT} in your browser to test the POS system`);
});

