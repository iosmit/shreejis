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
app.use(express.static(path.join(__dirname, 'build')));

// Proxy endpoint to fetch CSV from Google Sheets (keeps URL hidden)
app.get('/api/products', async (req, res) => {
    try {
        const storeProductsUrl = process.env.STORE_PRODUCTS;
        
        if (!storeProductsUrl) {
            return res.status(500).json({ error: 'STORE_PRODUCTS URL not configured' });
        }

        // Fetch CSV from Google Sheets (server-side, URL is hidden)
        const response = await fetch(storeProductsUrl);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`);
        }

        const csvText = await response.text();

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

// Serve index.html for all routes (SPA routing)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 POS Server running on http://localhost:${PORT}`);
    console.log(`📦 Serving files from: ${path.join(__dirname, 'build')}`);
    console.log(`\n💡 Open http://localhost:${PORT} in your browser to test the POS system`);
});

