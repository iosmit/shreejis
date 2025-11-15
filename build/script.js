// Store Products CSV URL - will be replaced by generate-config.js
const STORE_PRODUCTS_URL = '{{STORE_PRODUCTS}}';

// Cache keys
const PRODUCTS_CACHE_KEY = 'storeProductsCache';
const CACHE_TIMESTAMP_KEY = 'storeProductsCacheTimestamp';
const LAST_VIEW_KEY = 'storeProductsLastView';
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes in milliseconds

class POSSystem {
    constructor() {
        this.products = [];
        this.cart = [];
        this.init();
    }

    async init() {
        this.setupEventListeners();
        
        // Check if we should fetch fresh data
        if (this.shouldFetchFreshData()) {
            // Cache is old or doesn't exist, fetch fresh data
            console.log('Fetching fresh data...');
            await this.loadProducts();
        } else {
            // Cache is fresh, load from cache
            if (this.loadProductsFromCache()) {
                console.log('Using cached products (cache is fresh)');
                this.displayProductsList();
                this.handleSearch('');
                this.updateLastViewTime();
            } else {
                // No cache exists, fetch fresh data
                await this.loadProducts();
            }
        }
    }
    
    // Check if we should fetch fresh data (cache is old or doesn't exist)
    shouldFetchFreshData() {
        try {
            const cacheTimestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
            
            // If no cache timestamp, fetch fresh data
            if (!cacheTimestamp) {
                return true;
            }
            
            const cacheTime = parseInt(cacheTimestamp, 10);
            const now = Date.now();
            const timeSinceCache = now - cacheTime;
            
            // If cache is older than 5 minutes, fetch fresh data
            return timeSinceCache >= CACHE_DURATION_MS;
        } catch (error) {
            console.error('Error checking cache timestamp:', error);
            return true; // On error, fetch fresh data to be safe
        }
    }
    
    // Update last view timestamp
    updateLastViewTime() {
        try {
            localStorage.setItem(LAST_VIEW_KEY, Date.now().toString());
        } catch (error) {
            console.error('Error updating last view time:', error);
        }
    }
    
    // Check if cache exists
    cacheExists() {
        try {
            const cachedData = localStorage.getItem(PRODUCTS_CACHE_KEY);
            return cachedData !== null;
        } catch (error) {
            return false;
        }
    }
    
    // Load products from cache
    loadProductsFromCache() {
        try {
            const cachedData = localStorage.getItem(PRODUCTS_CACHE_KEY);
            if (!cachedData) {
                return false;
            }
            
            const data = JSON.parse(cachedData);
            console.log('Loading products from cache:', data.length);
            
            this.products = data;
            
            // Update last view time when loading from cache
            this.updateLastViewTime();
            
            return true;
        } catch (error) {
            console.error('Error loading from cache:', error);
            return false;
        }
    }
    
    // Save products to cache
    saveProductsToCache(products) {
        try {
            localStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify(products));
            localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
            this.updateLastViewTime(); // Update last view time when saving fresh data
            console.log('Saved products to cache:', products.length);
        } catch (error) {
            console.error('Error saving to cache:', error);
        }
    }

    setupEventListeners() {
        const searchInput = document.getElementById('productSearch');
        const checkoutBtn = document.getElementById('checkoutBtn');
        const clearCartBtn = document.getElementById('clearCartBtn');
        const closeReceipt = document.getElementById('closeReceipt');
        const printReceipt = document.getElementById('printReceipt');
        const newTransaction = document.getElementById('newTransaction');

        searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && this.searchResults.length > 0) {
                this.addToCart(this.searchResults[0]);
                searchInput.value = '';
                this.clearSearchResults();
            }
        });

        checkoutBtn.addEventListener('click', () => this.showReceipt());
        clearCartBtn.addEventListener('click', () => this.clearCart());
        closeReceipt.addEventListener('click', () => this.closeReceipt());
        printReceipt.addEventListener('click', () => window.print());
        newTransaction.addEventListener('click', () => {
            this.clearCart();
            this.closeReceipt();
        });

        // Close modal when clicking outside
        document.getElementById('receiptModal').addEventListener('click', (e) => {
            if (e.target.id === 'receiptModal') {
                this.closeReceipt();
            }
        });
    }

    async loadProducts() {
        const loadingOverlay = document.getElementById('loadingOverlay');
        loadingOverlay.style.display = 'flex';

        try {
            if (!STORE_PRODUCTS_URL || STORE_PRODUCTS_URL === 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR7f9Ungw0dtrY5x0RUeCpxdqe5dRiOYWBoQMMUYESZil607WXSTVYKyBxchrK_vY-NUMdsb5H4Iwgv/pub?gid=1244670162&single=true&output=csv' || STORE_PRODUCTS_URL.trim() === '') {
                throw new Error('STORE_PRODUCTS URL not configured. Please run generate-config.js or set environment variable.');
            }

            console.log('Fetching products from:', STORE_PRODUCTS_URL);
            
            // Use PapaParse to fetch and parse CSV (handles redirects automatically)
            Papa.parse(STORE_PRODUCTS_URL, {
                download: true,
                header: true,
                skipEmptyLines: true,
                complete: (results) => {
                    console.log('CSV parsed successfully:', results.data.length, 'rows');
                    
                    // Parse the CSV data into products
                    const newProducts = results.data
                        .filter(row => {
                            // Check if row has PRODUCT and RATE columns
                            const product = row.PRODUCT || row.product || '';
                            const rate = row.RATE || row.rate || '';
                            return product && product.trim() !== '' && rate && !isNaN(parseFloat(rate)) && parseFloat(rate) > 0;
                        })
                        .map(row => {
                            const product = (row.PRODUCT || row.product || '').trim();
                            const rate = parseFloat(row.RATE || row.rate || 0);
                            return {
                                name: product,
                                rate: rate
                            };
                        });
                    
                    if (newProducts.length === 0) {
                        throw new Error('No products found in CSV. Please check the CSV format. Expected columns: PRODUCT, RATE');
                    }
                    
                    // Update products
                    this.products = newProducts;
                    
                    // Save to cache
                    this.saveProductsToCache(this.products);
                    
                    console.log(`✓ Loaded ${this.products.length} products`);
                    loadingOverlay.style.display = 'none';
                    
                    // Show products and initialize search
                    this.displayProductsList();
                    this.handleSearch('');
                },
                error: (error) => {
                    console.error('Error loading products:', error);
                    loadingOverlay.style.display = 'none';
                    
                    // If we have cached data, use it instead of showing error
                    if (this.cacheExists() && this.products.length > 0) {
                        console.log('Using cached products due to fetch error');
                        this.displayProductsList();
                        this.handleSearch('');
                        return;
                    }
                    
                    alert(`Failed to load products:\n\n${error.message || 'Unknown error occurred'}\n\nPlease check:\n1. The STORE_PRODUCTS URL in your .env file\n2. Browser console for more details\n3. That the Google Sheet is published as CSV`);
                }
            });
        } catch (error) {
            console.error('Error loading products:', error);
            loadingOverlay.style.display = 'none';
            
            // If we have cached data, use it instead of showing error
            if (this.cacheExists() && this.products.length > 0) {
                console.log('Using cached products due to error');
                this.displayProductsList();
                this.handleSearch('');
                return;
            }
            
            const errorMessage = error.message || 'Unknown error occurred';
            alert(`Failed to load products:\n\n${errorMessage}\n\nPlease check:\n1. The STORE_PRODUCTS URL in your .env file\n2. Browser console for more details\n3. Network tab to see if the request succeeded`);
        }
    }

    parseCSV(csvText) {
        const lines = csvText.split('\n').filter(line => line.trim());
        const products = [];
        
        // Skip header row (PRODUCT,RATE or SR.,PRODUCT,RATE,QUANTITY,TOTAL)
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Parse CSV line (handling commas in product names)
            const columns = this.parseCSVLine(line);
            
            let product, rate;
            
            // Handle two formats:
            // Format 1: PRODUCT,RATE (2 columns)
            // Format 2: SR.,PRODUCT,RATE,QUANTITY,TOTAL (5 columns)
            if (columns.length >= 2) {
                if (columns.length === 2) {
                    // Format 1: PRODUCT,RATE
                    product = columns[0]?.trim();
                    rate = parseFloat(columns[1]?.trim());
                } else if (columns.length >= 3) {
                    // Format 2: SR.,PRODUCT,RATE,...
                    product = columns[1]?.trim(); // Column B (PRODUCT)
                    rate = parseFloat(columns[2]?.trim()); // Column C (RATE)
                }
                
                // Skip rows with empty product or invalid rate
                if (product && product.length > 0 && !isNaN(rate) && rate > 0) {
                    products.push({
                        name: product,
                        rate: rate
                    });
                } else {
                    // Debug: log skipped rows
                    console.debug('Skipped row:', { product, rate, columns: columns.length });
                }
            }
        }

        return products;
    }

    parseCSVLine(line) {
        const columns = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                columns.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        columns.push(current); // Add last column

        return columns;
    }

    searchResults = [];

    handleSearch(query) {
        const searchResultsDiv = document.getElementById('searchResults');
        
        if (!query.trim()) {
            // Show all products when search is empty
            this.searchResults = this.products.slice(0, 50); // Show first 50 products
            this.displaySearchResults(searchResultsDiv, '', false);
            this.displayProductsList(); // Update products list
            return;
        }

        const queryLower = query.toLowerCase();
        this.searchResults = this.products.filter(product => 
            product.name.toLowerCase().includes(queryLower)
        );

        if (this.searchResults.length === 0) {
            searchResultsDiv.innerHTML = '<div class="no-results">No products found</div>';
            searchResultsDiv.style.display = 'block';
            this.displayProductsList([]); // Clear products list
            return;
        }

        this.displaySearchResults(searchResultsDiv, query, true);
        this.displayProductsList(this.searchResults, query); // Update products list with filtered results
    }

    displayProductsList(productsToShow = null, searchQuery = '') {
        const productsListDiv = document.getElementById('productsList');
        const productsToDisplay = productsToShow || this.products;
        const maxProducts = 50;
        const displayProducts = productsToDisplay.slice(0, maxProducts);
        const hasMore = productsToDisplay.length > maxProducts;

        if (displayProducts.length === 0) {
            productsListDiv.innerHTML = '<div class="no-results" style="padding: 20px; text-align: center; color: #666666;">No products found</div>';
            return;
        }

        productsListDiv.innerHTML = displayProducts.map((product, index) => `
            <div class="product-item" data-index="${index}">
                <span class="product-item-name">${searchQuery ? this.highlightMatch(product.name, searchQuery) : product.name}</span>
                <span class="product-item-rate">₹${product.rate.toFixed(2)}</span>
            </div>
        `).join('') + (hasMore ? `<div class="more-results" style="padding: 12px; text-align: center; color: #666666; font-size: 14px; font-style: italic;">+ ${productsToDisplay.length - maxProducts} more products</div>` : '');

        // Add click handlers
        productsListDiv.querySelectorAll('.product-item').forEach(item => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index);
                this.addToCart(displayProducts[index]);
            });
        });
    }

    displaySearchResults(searchResultsDiv, query, highlight) {
        const maxResults = 50; // Limit display to 50 results
        const displayResults = this.searchResults.slice(0, maxResults);
        const hasMore = this.searchResults.length > maxResults;

        searchResultsDiv.innerHTML = displayResults.map((product, index) => `
            <div class="search-result-item" data-index="${index}">
                <span class="product-name">${highlight ? this.highlightMatch(product.name, query) : product.name}</span>
                <span class="product-rate">₹${product.rate.toFixed(2)}</span>
            </div>
        `).join('') + (hasMore ? `<div class="more-results">+ ${this.searchResults.length - maxResults} more products (refine your search)</div>` : '');

        searchResultsDiv.style.display = 'block';

        // Add click handlers
        searchResultsDiv.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index);
                this.addToCart(this.searchResults[index]);
                document.getElementById('productSearch').value = '';
                this.clearSearchResults();
            });
        });
    }

    highlightMatch(text, query) {
        const regex = new RegExp(`(${query})`, 'gi');
        return text.replace(regex, '<mark>$1</mark>');
    }

    clearSearchResults() {
        const searchInput = document.getElementById('productSearch');
        const searchResultsDiv = document.getElementById('searchResults');
        
        // If search input is empty, show all products again
        if (!searchInput.value.trim()) {
            searchResultsDiv.style.display = 'none';
            this.displayProductsList(); // Show all products in the list
        } else {
            // Otherwise, just hide the dropdown results
            searchResultsDiv.style.display = 'none';
            searchResultsDiv.innerHTML = '';
        }
    }

    addToCart(product) {
        const existingItem = this.cart.find(item => item.name === product.name);
        
        if (existingItem) {
            existingItem.quantity += 1;
        } else {
            this.cart.push({
                name: product.name,
                rate: product.rate,
                quantity: 1
            });
        }

        this.updateCartDisplay();
    }

    removeFromCart(index) {
        this.cart.splice(index, 1);
        this.updateCartDisplay();
    }

    updateQuantity(index, change) {
        const item = this.cart[index];
        item.quantity += change;
        
        if (item.quantity <= 0) {
            this.removeFromCart(index);
        } else {
            this.updateCartDisplay();
        }
    }

    updateCartDisplay() {
        const cartItemsDiv = document.getElementById('cartItems');
        const checkoutBtn = document.getElementById('checkoutBtn');
        const clearCartBtn = document.getElementById('clearCartBtn');

        if (this.cart.length === 0) {
            cartItemsDiv.innerHTML = '<p class="empty-cart">No items in cart</p>';
            checkoutBtn.disabled = true;
            clearCartBtn.disabled = true;
        } else {
            cartItemsDiv.innerHTML = this.cart.map((item, index) => `
                <div class="cart-item">
                    <div class="cart-item-info">
                        <span class="cart-item-name">${item.name}</span>
                        <span class="cart-item-rate">₹${item.rate.toFixed(2)} each</span>
                    </div>
                    <div class="cart-item-controls">
                        <button class="qty-btn" onclick="pos.updateQuantity(${index}, -1)">−</button>
                        <span class="cart-item-qty">${item.quantity}</span>
                        <button class="qty-btn" onclick="pos.updateQuantity(${index}, 1)">+</button>
                        <span class="cart-item-total">₹${(item.rate * item.quantity).toFixed(2)}</span>
                        <button class="remove-btn" onclick="pos.removeFromCart(${index})" title="Remove">×</button>
                    </div>
                </div>
            `).join('');
            checkoutBtn.disabled = false;
            clearCartBtn.disabled = false;
        }

        this.updateTotal();
    }

    updateTotal() {
        const grandTotal = this.cart.reduce((sum, item) => sum + (item.rate * item.quantity), 0);
        document.getElementById('grandTotal').textContent = `₹${grandTotal.toFixed(2)}`;
    }

    clearCart() {
        this.cart = [];
        this.updateCartDisplay();
    }

    showReceipt() {
        const receiptContent = document.getElementById('receiptContent');
        const modal = document.getElementById('receiptModal');
        
        const date = new Date().toLocaleString('en-IN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        const grandTotal = this.cart.reduce((sum, item) => sum + (item.rate * item.quantity), 0);

        receiptContent.innerHTML = `
            <div class="receipt">
                <div class="receipt-header">
                    <h3>Convenience Store</h3>
                    <p class="receipt-date">${date}</p>
                </div>
                <div class="receipt-items">
                    <table>
                        <thead>
                            <tr>
                                <th>Product</th>
                                <th>Qty</th>
                                <th>Rate</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this.cart.map(item => `
                                <tr>
                                    <td>${item.name}</td>
                                    <td>${item.quantity}</td>
                                    <td>₹${item.rate.toFixed(2)}</td>
                                    <td>₹${(item.rate * item.quantity).toFixed(2)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="receipt-total">
                    <div class="receipt-total-row">
                        <span>Grand Total:</span>
                        <span>₹${grandTotal.toFixed(2)}</span>
                    </div>
                </div>
                <div class="receipt-footer">
                    <p>Thank you for your purchase!</p>
                </div>
            </div>
        `;

        modal.style.display = 'block';
    }

    closeReceipt() {
        document.getElementById('receiptModal').style.display = 'none';
    }
}

// Initialize POS system when page loads
let pos;
window.addEventListener('DOMContentLoaded', () => {
    pos = new POSSystem();
});

