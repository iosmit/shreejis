// Customers CSV URL - using proxy endpoint to keep URL hidden
const CUSTOMERS_URL = '/api/customers';

// Cache keys - must match customers.js
const CUSTOMERS_CACHE_KEY = 'customersCache';
const CUSTOMERS_CACHE_TIMESTAMP_KEY = 'customersCacheTimestamp';
const PRODUCTS_CACHE_KEY = 'storeProductsCache'; // For calculating profit margin
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes in milliseconds

class ReportManager {
    constructor() {
        this.allReceipts = [];
        this.filteredReceipts = [];
        this.currentFilter = {
            type: 'all',
            value: null
        };
        this.products = []; // Store products for profit margin calculation
        this.init();
    }
    
    // Load products from cache for profit margin calculation
    loadProductsFromCache() {
        try {
            const cachedData = localStorage.getItem(PRODUCTS_CACHE_KEY);
            if (!cachedData) {
                return false;
            }
            
            const parsedProducts = JSON.parse(cachedData);
            
            if (!Array.isArray(parsedProducts) || parsedProducts.length === 0) {
                return false;
            }
            
            this.products = parsedProducts;
            return true;
        } catch (error) {
            console.error('Error loading products from cache:', error);
            return false;
        }
    }
    
    // Calculate profit margin for a receipt on-the-fly
    calculateProfitMarginForReceipt(receipt) {
        if (!receipt.items || !Array.isArray(receipt.items)) {
            return 0;
        }
        
        let totalProfitMargin = 0;
        
        receipt.items.forEach(item => {
            // Get purchase cost from item (if stored) or from products list
            let purchaseCost = 0;
            
            if (item.purchaseCost !== undefined && item.purchaseCost !== null) {
                purchaseCost = parseFloat(item.purchaseCost) || 0;
            } else {
                // Look up purchase cost from products list
                const product = this.products.find(p => p.name === item.name);
                if (product && product.purchaseCost !== undefined) {
                    purchaseCost = parseFloat(product.purchaseCost) || 0;
                }
            }
            
            // Calculate profit margin for this item
            const itemRate = parseFloat(item.rate) || 0;
            const itemQuantity = parseFloat(item.quantity) || 0;
            const profitPerUnit = itemRate - purchaseCost;
            const profitMargin = profitPerUnit * itemQuantity;
            totalProfitMargin += profitMargin;
        });
        
        return totalProfitMargin;
    }

    async init() {
        this.setupEventListeners();
        // Load products from cache for profit margin calculation
        this.loadProductsFromCache();
        await this.loadReceipts();
        // calculateAndDisplayStats() is called in loadReceipts() after data is loaded
    }

    setupEventListeners() {
        const filterType = document.getElementById('filterType');
        const applyFilterBtn = document.getElementById('applyFilterBtn');
        const clearFilterBtn = document.getElementById('clearFilterBtn');
        const dayFilter = document.getElementById('dayFilter');
        const monthFilter = document.getElementById('monthFilter');
        const yearFilter = document.getElementById('yearFilter');

        filterType.addEventListener('change', () => {
            this.handleFilterTypeChange(filterType.value);
        });

        applyFilterBtn.addEventListener('click', () => {
            this.applyFilter();
        });

        clearFilterBtn.addEventListener('click', () => {
            this.clearFilter();
        });
    }

    handleFilterTypeChange(filterType) {
        const dayFilter = document.getElementById('dayFilter');
        const monthFilter = document.getElementById('monthFilter');
        const yearFilter = document.getElementById('yearFilter');

        // Hide all filters
        dayFilter.style.display = 'none';
        monthFilter.style.display = 'none';
        yearFilter.style.display = 'none';

        // Show relevant filter
        if (filterType === 'day') {
            dayFilter.style.display = 'block';
        } else if (filterType === 'month') {
            monthFilter.style.display = 'block';
        } else if (filterType === 'year') {
            yearFilter.style.display = 'block';
        }
    }

    applyFilter() {
        const filterType = document.getElementById('filterType').value;
        let filterValue = null;

        if (filterType === 'day') {
            const dayInput = document.getElementById('filterDay').value;
            if (!dayInput) {
                alert('Please select a day');
                return;
            }
            filterValue = dayInput;
        } else if (filterType === 'month') {
            const monthInput = document.getElementById('filterMonth').value;
            if (!monthInput) {
                alert('Please select a month');
                return;
            }
            filterValue = monthInput;
        } else if (filterType === 'year') {
            const yearInput = document.getElementById('filterYear').value;
            if (!yearInput) {
                alert('Please enter a year');
                return;
            }
            filterValue = yearInput;
        }

        this.currentFilter = {
            type: filterType,
            value: filterValue
        };

        this.filterReceipts();
        this.calculateAndDisplayStats();
    }

    clearFilter() {
        document.getElementById('filterType').value = 'all';
        document.getElementById('filterDay').value = '';
        document.getElementById('filterMonth').value = '';
        document.getElementById('filterYear').value = '';
        this.handleFilterTypeChange('all');
        
        this.currentFilter = {
            type: 'all',
            value: null
        };

        this.filterReceipts();
        this.calculateAndDisplayStats();
    }

    filterReceipts() {
        if (this.currentFilter.type === 'all') {
            this.filteredReceipts = [...this.allReceipts];
            return;
        }

        this.filteredReceipts = this.allReceipts.filter(receipt => {
            if (!receipt.date) return false;

            const receiptDate = this.parseDateString(receipt.date);
            if (!receiptDate) return false;

            if (this.currentFilter.type === 'day') {
                // Filter by specific day (YYYY-MM-DD format)
                const filterDate = new Date(this.currentFilter.value);
                return this.isSameDay(receiptDate, filterDate);
            } else if (this.currentFilter.type === 'month') {
                // Filter by month (YYYY-MM format)
                const filterYear = parseInt(this.currentFilter.value.split('-')[0]);
                const filterMonth = parseInt(this.currentFilter.value.split('-')[1]) - 1;
                return receiptDate.getFullYear() === filterYear && 
                       receiptDate.getMonth() === filterMonth;
            } else if (this.currentFilter.type === 'year') {
                // Filter by year
                const filterYear = parseInt(this.currentFilter.value);
                return receiptDate.getFullYear() === filterYear;
            }

            return false;
        });
    }

    parseDateString(dateStr) {
        if (!dateStr) return null;
        
        // Try to parse DD/MM/YYYY format
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
            const year = parseInt(parts[2], 10);
            return new Date(year, month, day);
        }
        
        // Try to parse other formats
        const parsed = new Date(dateStr);
        return isNaN(parsed.getTime()) ? null : parsed;
    }

    isSameDay(date1, date2) {
        return date1.getFullYear() === date2.getFullYear() &&
               date1.getMonth() === date2.getMonth() &&
               date1.getDate() === date2.getDate();
    }

    async loadReceipts() {
        this.showLoading();
        try {
            // Always try to load from cache first
            let csvText = localStorage.getItem(CUSTOMERS_CACHE_KEY);
            
            if (!csvText || csvText.trim() === '') {
                // No cache available - fetch from server
                console.log('No customers cache found, fetching from server...');
                try {
                    const response = await fetch(`${CUSTOMERS_URL}?t=${Date.now()}`);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch receipts: ${response.status} ${response.statusText}`);
                    }
                    csvText = await response.text();
                    
                    // Validate that we got actual data
                    if (!csvText || csvText.trim() === '') {
                        throw new Error('Received empty response from server');
                    }
                    
                    // Save to cache
                    localStorage.setItem(CUSTOMERS_CACHE_KEY, csvText);
                    localStorage.setItem(CUSTOMERS_CACHE_TIMESTAMP_KEY, Date.now().toString());
                    console.log('Fetched and cached customers data from server');
                } catch (fetchError) {
                    console.error('Error fetching from server:', fetchError);
                    this.hideLoading();
                    this.showError(`Failed to load receipts from server: ${fetchError.message}. Please check your connection and try again.`);
                    return;
                }
            } else {
                console.log('Loading receipts from cache');
            }
            
            // Validate csvText before parsing
            if (!csvText || csvText.trim() === '') {
                throw new Error('No data available to parse');
            }
            
            // Parse CSV without headers to handle duplicate column names
            Papa.parse(csvText, {
                header: false,
                skipEmptyLines: true,
                quotes: true,
                escapeChar: '"',
                delimiter: ',',
                newline: '\n',
                complete: (rawResults) => {
                    try {
                        const receipts = [];
                        
                        // Check if we have valid data
                        if (!rawResults.data || rawResults.data.length === 0) {
                            console.log('No customer data found in CSV');
                            this.allReceipts = [];
                            this.filteredReceipts = [];
                            this.hideLoading();
                            this.calculateAndDisplayStats();
                            return;
                        }
                        
                        // First row is headers
                        const headers = rawResults.data[0] || [];
                        
                        // Find CUSTOMER column index
                        const customerColumnIndex = headers.findIndex(h => 
                            h && String(h).trim().toUpperCase() === 'CUSTOMER'
                        );
                        
                        if (customerColumnIndex === -1) {
                            console.warn('CUSTOMER column not found in CSV');
                            this.allReceipts = [];
                            this.filteredReceipts = [];
                            this.hideLoading();
                            this.calculateAndDisplayStats();
                            return;
                        }
                        
                        // Extract all receipts from all customers
                        for (let rowIndex = 1; rowIndex < rawResults.data.length; rowIndex++) {
                            const row = rawResults.data[rowIndex];
                            
                            // Iterate through all columns to find receipt columns
                            for (let colIndex = 0; colIndex < headers.length; colIndex++) {
                                const header = headers[colIndex];
                                const headerUpper = header ? String(header).trim().toUpperCase() : '';
                                
                                // Skip CUSTOMER column
                                if (headerUpper === 'CUSTOMER') {
                                    continue;
                                }
                                
                                // Check if this is a RECEIPT column
                                if (headerUpper.startsWith('RECEIPT')) {
                                    const receiptValue = row[colIndex];
                                    
                                    if (receiptValue && String(receiptValue).trim() !== '') {
                                        try {
                                            let receiptJson = String(receiptValue).trim();
                                            
                                            // Remove surrounding quotes if present
                                            if (receiptJson.startsWith('"') && receiptJson.endsWith('"')) {
                                                receiptJson = receiptJson.slice(1, -1);
                                            }
                                            // Unescape JSON (handle double quotes)
                                            receiptJson = receiptJson.replace(/""/g, '"');
                                            
                                            const receipt = JSON.parse(receiptJson);
                                            
                                            // Ensure profitMargin is a number if present
                                            if (receipt.profitMargin !== undefined) {
                                                receipt.profitMargin = parseFloat(receipt.profitMargin) || 0;
                                            }
                                            
                                            receipts.push(receipt);
                                        } catch (e) {
                                            console.error('Error parsing receipt JSON:', e);
                                            // Continue processing other receipts
                                        }
                                    }
                                }
                            }
                        }

                        console.log(`Loaded ${receipts.length} receipts`);
                        this.allReceipts = receipts;
                        this.filteredReceipts = [...receipts];
                        this.hideLoading();
                        this.calculateAndDisplayStats();
                    } catch (parseError) {
                        console.error('Error processing parsed data:', parseError);
                        this.hideLoading();
                        this.showError('Failed to process receipt data. Please try again.');
                    }
                },
                error: (error) => {
                    console.error('Error parsing receipts CSV:', error);
                    this.hideLoading();
                    this.showError(`Failed to parse receipt data: ${error.message || 'Unknown error'}. Please try again.`);
                }
            });
        } catch (error) {
            console.error('Error loading receipts:', error);
            this.hideLoading();
            this.showError(`Failed to load receipts: ${error.message || 'Unknown error'}. Please try again.`);
        }
    }

    calculateAndDisplayStats() {
        let totalSales = 0;
        let totalOutstanding = 0;
        let totalPaid = 0;
        let totalProfit = 0;

        // Ensure products are loaded for profit margin calculation
        if (this.products.length === 0) {
            this.loadProductsFromCache();
        }

        this.filteredReceipts.forEach(receipt => {
            const grandTotal = receipt.grandTotal || 0;
            const cashPayment = receipt.payments?.cash || 0;
            const onlinePayment = receipt.payments?.online || 0;
            const totalPayment = cashPayment + onlinePayment;
            const remainingBalance = receipt.remainingBalance !== undefined 
                ? receipt.remainingBalance 
                : (grandTotal - totalPayment);

            totalSales += grandTotal;
            totalPaid += totalPayment;
            totalOutstanding += Math.max(0, remainingBalance);
            
            // Calculate profit margin - use stored value if available, otherwise calculate
            let profitMargin = receipt.profitMargin;
            if (profitMargin === undefined || profitMargin === null) {
                profitMargin = this.calculateProfitMarginForReceipt(receipt);
            } else {
                profitMargin = parseFloat(profitMargin) || 0;
            }
            totalProfit += profitMargin;
        });

        document.getElementById('totalSales').textContent = `₹${this.formatCurrency(totalSales)}`;
        document.getElementById('totalOutstanding').textContent = `₹${this.formatCurrency(totalOutstanding)}`;
        document.getElementById('totalPaid').textContent = `₹${this.formatCurrency(totalPaid)}`;
        document.getElementById('totalProfit').textContent = `₹${this.formatCurrency(totalProfit)}`;
        
        // Update profit color based on value
        const profitElement = document.getElementById('totalProfit');
        if (totalProfit > 0) {
            profitElement.className = 'stat-value positive';
        } else if (totalProfit < 0) {
            profitElement.className = 'stat-value negative';
        } else {
            profitElement.className = 'stat-value';
        }
    }

    formatCurrency(amount) {
        return parseFloat(amount).toFixed(2);
    }

    showLoading() {
        const loadingOverlay = document.getElementById('loadingOverlay');
        loadingOverlay.classList.add('active');
    }

    hideLoading() {
        const loadingOverlay = document.getElementById('loadingOverlay');
        loadingOverlay.classList.remove('active');
    }

    showError(message) {
        const mainContent = document.querySelector('.main-content');
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        mainContent.insertBefore(errorDiv, mainContent.firstChild);
    }
}

// Initialize the report manager
const reportManager = new ReportManager();

