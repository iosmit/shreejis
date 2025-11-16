// Customers CSV URL - using proxy endpoint to keep URL hidden
const CUSTOMERS_URL = '/api/customers';

// Cache keys
const CUSTOMERS_CACHE_KEY = 'customersCache';
const CUSTOMERS_CACHE_KEY_PARSED = 'customersCache_parsed';
const CUSTOMERS_CACHE_TIMESTAMP_KEY = 'customersCacheTimestamp';
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes in milliseconds

class CustomersManager {
    constructor() {
        this.customers = [];
        this.filteredCustomers = [];
        this.receipts = [];
        this.currentCustomer = null;
        this.currentReceipt = null;
        this.currentReceiptIndex = null;
        this.cacheRefreshInterval = null;
        this.init();
    }

    async init() {
        this.setupEventListeners();
        
        // Load from cache first
        const hasCache = this.loadCustomersFromCache();
        
        if (!hasCache) {
            await this.loadCustomers(true); // Load and cache
        }
        
        // Fetch fresh data in background
        this.loadCustomers(true).catch(error => {
            console.warn('Background customers cache refresh failed:', error);
        });
        
        // Set up periodic cache refresh (every 5 minutes)
        this.setupPeriodicRefresh();
    }
    
    // Set up periodic refresh every 5 minutes
    setupPeriodicRefresh() {
        // Clear any existing interval
        if (this.cacheRefreshInterval) {
            clearInterval(this.cacheRefreshInterval);
        }
        
        // Refresh cache every 5 minutes - flush old cache and replace with fresh data
        this.cacheRefreshInterval = setInterval(() => {
            console.log('Periodic customers cache refresh triggered - flushing and replacing cache');
            this.flushAndRefreshCache();
        }, CACHE_DURATION_MS);
    }
    
    // Flush old cache and replace with fresh data
    async flushAndRefreshCache() {
        try {
            // Clear old cache
            localStorage.removeItem(CUSTOMERS_CACHE_KEY);
            localStorage.removeItem(CUSTOMERS_CACHE_KEY_PARSED);
            localStorage.removeItem(CUSTOMERS_CACHE_TIMESTAMP_KEY);
            
            console.log('Customers cache flushed, fetching fresh data...');
            
            // Fetch fresh data and save to cache
            await this.loadCustomers(true);
            
            console.log('Customers cache refreshed with fresh data');
        } catch (error) {
            console.error('Error flushing and refreshing customers cache:', error);
        }
    }
    
    // Load customers from cache
    loadCustomersFromCache() {
        try {
            const cachedCustomers = localStorage.getItem(CUSTOMERS_CACHE_KEY_PARSED);
            const cachedCsv = localStorage.getItem(CUSTOMERS_CACHE_KEY);
            
            if (cachedCustomers && cachedCsv) {
                this.customers = JSON.parse(cachedCustomers);
                this.filteredCustomers = [...this.customers];
                console.log(`Loaded ${this.customers.length} customers from cache`);
                this.displayCustomers();
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error loading customers from cache:', error);
            return false;
        }
    }
    
    // Save customers to cache
    saveCustomersToCache(csvText, customers) {
        try {
            localStorage.setItem(CUSTOMERS_CACHE_KEY, csvText);
            localStorage.setItem(CUSTOMERS_CACHE_KEY_PARSED, JSON.stringify(customers));
            localStorage.setItem(CUSTOMERS_CACHE_TIMESTAMP_KEY, Date.now().toString());
            console.log(`Saved ${customers.length} customers to cache`);
            return true;
        } catch (error) {
            console.error('Error saving customers to cache:', error);
            return false;
        }
    }
    
    // Update customers cache with payment information
    updateCustomersCacheWithPayment(customerName, receiptIndex, payments) {
        try {
            // Get cached CSV data
            const cachedCsv = localStorage.getItem(CUSTOMERS_CACHE_KEY);
            if (!cachedCsv) {
                console.warn('No customers cache found to update');
                return;
            }
            
            // Parse the CSV
            Papa.parse(cachedCsv, {
                header: true,
                skipEmptyLines: true,
                complete: (results) => {
                    // Find the customer row
                    let customerRow = null;
                    
                    for (let i = 0; i < results.data.length; i++) {
                        const row = results.data[i];
                        const rowCustomerName = row.CUSTOMER || row.customer || row.Customer || '';
                        if (rowCustomerName && rowCustomerName.trim().toUpperCase() === customerName.toUpperCase()) {
                            customerRow = row;
                            break;
                        }
                    }
                    
                    if (!customerRow) {
                        console.warn('Customer not found in cache for payment update');
                        return;
                    }
                    
                    // Find receipt columns
                    const receiptColumns = results.meta.fields.filter(f => f.toUpperCase().startsWith('RECEIPT'));
                    if (receiptColumns.length === 0) {
                        console.warn('No receipt columns found in cache');
                        return;
                    }
                    
                    // Get the receipt at the specified index (receiptIndex corresponds to column position)
                    // Receipt columns are: RECEIPT (index 0), RECEIPT2 (index 1), etc.
                    let receiptField = null;
                    if (receiptIndex === 0) {
                        receiptField = receiptColumns[0]; // First receipt column
                    } else {
                        // Find the receipt column at the specified index
                        const receiptFieldName = receiptIndex === 1 ? 'RECEIPT' : `RECEIPT${receiptIndex}`;
                        receiptField = receiptColumns.find(col => col.toUpperCase() === receiptFieldName.toUpperCase());
                        if (!receiptField && receiptColumns[receiptIndex]) {
                            receiptField = receiptColumns[receiptIndex];
                        }
                    }
                    
                    if (!receiptField || !customerRow[receiptField]) {
                        console.warn('Receipt not found in cache at specified index');
                        return;
                    }
                    
                    // Parse existing receipt JSON
                    let receiptData;
                    try {
                        const receiptJson = customerRow[receiptField];
                        // Handle double-encoded JSON
                        receiptData = typeof receiptJson === 'string' ? JSON.parse(receiptJson) : receiptJson;
                        if (typeof receiptData === 'string') {
                            receiptData = JSON.parse(receiptData);
                        }
                    } catch (e) {
                        console.error('Error parsing receipt JSON from cache:', e);
                        return;
                    }
                    
                    // Update payment information
                    receiptData.payments = {
                        cash: payments.cash || 0,
                        online: payments.online || 0
                    };
                    const totalPaid = receiptData.payments.cash + receiptData.payments.online;
                    receiptData.remainingBalance = receiptData.grandTotal - totalPaid;
                    
                    // Save back to cache
                    customerRow[receiptField] = JSON.stringify(receiptData);
                    
                    // Convert back to CSV and save
                    const updatedCsv = Papa.unparse(results.data, {
                        header: true,
                        columns: results.meta.fields
                    });
                    
                    // Update cache
                    localStorage.setItem(CUSTOMERS_CACHE_KEY, updatedCsv);
                    localStorage.setItem(CUSTOMERS_CACHE_TIMESTAMP_KEY, Date.now().toString());
                    
                    console.log('Updated customers cache with payment information');
                },
                error: (error) => {
                    console.error('Error updating customers cache with payment:', error);
                }
            });
        } catch (error) {
            console.error('Error updating customers cache with payment:', error);
        }
    }

    setupEventListeners() {
        const backToCustomersBtn = document.getElementById('backToCustomersBtn');
        const closePaymentModal = document.getElementById('closePaymentModal');
        const cancelPaymentBtn = document.getElementById('cancelPaymentBtn');
        const paymentForm = document.getElementById('paymentForm');
        const customerSearch = document.getElementById('customerSearch');

        backToCustomersBtn.addEventListener('click', () => {
            this.showCustomersView();
        });

        closePaymentModal.addEventListener('click', () => {
            this.closePaymentModal();
        });

        cancelPaymentBtn.addEventListener('click', () => {
            this.closePaymentModal();
        });

        paymentForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.savePayment();
        });

        // Customer search functionality
        if (customerSearch) {
            customerSearch.addEventListener('input', (e) => {
                this.handleCustomerSearch(e.target.value);
            });
        }

        // Close modal when clicking outside
        const paymentModal = document.getElementById('paymentModal');
        paymentModal.addEventListener('click', (e) => {
            if (e.target === paymentModal) {
                this.closePaymentModal();
            }
        });
    }

    showLoading() {
        const loadingOverlay = document.getElementById('loadingOverlay');
        loadingOverlay.classList.add('active');
    }

    hideLoading() {
        const loadingOverlay = document.getElementById('loadingOverlay');
        loadingOverlay.classList.remove('active');
    }

    async loadCustomers(silent = false) {
        if (!silent) {
            this.showLoading();
        }
        try {
            const response = await fetch(`${CUSTOMERS_URL}?t=${Date.now()}`);
            if (!response.ok) {
                throw new Error(`Failed to fetch customers: ${response.status}`);
            }

            const csvText = await response.text();
            
            Papa.parse(csvText, {
                header: true,
                skipEmptyLines: true,
                quotes: true,
                escapeChar: '"',
                delimiter: ',',
                newline: '\n',
                complete: (results) => {
                    // Parse customers from CSV - extract unique customer names from CUSTOMER column
                    const customerSet = new Set();
                    
                    results.data.forEach((row, index) => {
                        // Try different possible column names (case-insensitive)
                        let customerName = '';
                        const rowKeys = Object.keys(row);
                        
                        // Find the customer column (could be CUSTOMER, customer, Customer, etc.)
                        for (const key of rowKeys) {
                            if (key.toUpperCase() === 'CUSTOMER') {
                                customerName = row[key];
                                break;
                            }
                        }
                        
                        // If still not found, try first column
                        if (!customerName && rowKeys.length > 0) {
                            customerName = row[rowKeys[0]];
                        }
                        
                        const trimmedName = String(customerName || '').trim();
                        
                        if (trimmedName && trimmedName !== '' && trimmedName.toUpperCase() !== 'CUSTOMER') {
                            customerSet.add(trimmedName);
                        }
                    });

                    this.customers = Array.from(customerSet).map(customerName => ({
                        name: customerName
                    }));
                    
                    // Initialize filtered customers with all customers
                    this.filteredCustomers = [...this.customers];
                    
                    // Save to cache
                    this.saveCustomersToCache(csvText, this.customers);

                    if (this.customers.length === 0) {
                        console.warn('No customers found in CSV');
                    }

                    this.displayCustomers();
                    if (!silent) {
                        this.hideLoading();
                    }
                },
                error: (error) => {
                    console.error('Error parsing customers CSV:', error);
                    if (!silent) {
                        this.hideLoading();
                        this.showError('Failed to load customers. Please try again.');
                    }
                }
            });
        } catch (error) {
            console.error('Error loading customers:', error);
            if (!silent) {
                this.hideLoading();
                this.showError('Failed to load customers. Please check your connection.');
            }
        }
    }

    async loadReceipts(customerName) {
        this.showLoading();
        try {
            // Try to load from cache first
            let csvText = localStorage.getItem(CUSTOMERS_CACHE_KEY);
            
            if (!csvText) {
                // Load receipts from the same CSV that has customers
                const response = await fetch(`${CUSTOMERS_URL}?t=${Date.now()}`);
                if (!response.ok) {
                    throw new Error(`Failed to fetch receipts: ${response.status}`);
                }
                csvText = await response.text();
                // Save to cache
                if (csvText) {
                    localStorage.setItem(CUSTOMERS_CACHE_KEY, csvText);
                }
            } else {
                console.log('Loading receipts from cache');
            }
            
            Papa.parse(csvText, {
                header: true,
                skipEmptyLines: true,
                quotes: true,
                escapeChar: '"',
                delimiter: ',',
                newline: '\n',
                complete: (results) => {
                    console.log('Parsing receipts for customer:', customerName);
                    
                    // Find the row for this customer
                    const customerRow = results.data.find(row => {
                        const rowCustomerName = row.CUSTOMER || row.customer || row.Customer || '';
                        return String(rowCustomerName).trim() === customerName;
                    });

                    if (!customerRow) {
                        console.warn('Customer not found in CSV:', customerName);
                        this.receipts = [];
                        this.currentCustomer = customerName;
                        this.displayReceipts();
                        this.hideLoading();
                        return;
                    }

                    // Extract all receipt columns (all columns except CUSTOMER)
                    // Store both the receipt data and its original column index
                    const receipts = [];
                    const rowKeys = Object.keys(customerRow);
                    
                    // Sort keys to maintain column order (RECEIPT, RECEIPT, RECEIPT, etc.)
                    const sortedKeys = rowKeys.sort((a, b) => {
                        // Keep CUSTOMER first, then RECEIPT columns in order
                        if (a.toUpperCase() === 'CUSTOMER') return -1;
                        if (b.toUpperCase() === 'CUSTOMER') return 1;
                        return a.localeCompare(b);
                    });
                    
                    let receiptColumnIndex = 0; // Track the column index (0-based, starting from first RECEIPT column)
                    
                    for (const key of sortedKeys) {
                        if (key.toUpperCase() !== 'CUSTOMER') {
                            const receiptValue = customerRow[key];
                            if (receiptValue && receiptValue.trim() !== '') {
                                try {
                                    // The receipt is stored as a JSON string, but it might be double-encoded
                                    let receiptJson = receiptValue;
                                    
                                    // Try to parse it - it might be a string that needs to be parsed
                                    if (typeof receiptJson === 'string') {
                                        // Remove surrounding quotes if present
                                        receiptJson = receiptJson.trim();
                                        if (receiptJson.startsWith('"') && receiptJson.endsWith('"')) {
                                            receiptJson = receiptJson.slice(1, -1);
                                        }
                                        // Unescape JSON (handle double quotes)
                                        receiptJson = receiptJson.replace(/""/g, '"');
                                        
                                        const receipt = JSON.parse(receiptJson);
                                        // Store the original column index with the receipt
                                        receipt._originalIndex = receiptColumnIndex;
                                        receipts.push(receipt);
                                    } else {
                                        receiptJson._originalIndex = receiptColumnIndex;
                                        receipts.push(receiptJson);
                                    }
                                    receiptColumnIndex++;
                                } catch (e) {
                                    console.error('Error parsing receipt JSON:', e);
                                    console.error('Receipt value:', receiptValue.substring(0, 200));
                                }
                            }
                        }
                    }

                    console.log(`Found ${receipts.length} receipts for ${customerName}`);
                    this.receipts = receipts;
                    this.currentCustomer = customerName;
                    this.displayReceipts();
                    this.hideLoading();
                },
                error: (error) => {
                    console.error('Error parsing receipts CSV:', error);
                    this.hideLoading();
                    this.showError('Failed to load receipts. Please try again.');
                }
            });
        } catch (error) {
            console.error('Error loading receipts:', error);
            this.hideLoading();
            this.showError('Failed to load receipts. Please try again.');
        }
    }

    handleCustomerSearch(searchTerm) {
        const term = searchTerm.trim().toLowerCase();
        
        if (term === '') {
            this.filteredCustomers = [...this.customers];
        } else {
            this.filteredCustomers = this.customers.filter(customer => {
                return customer.name.toLowerCase().includes(term);
            });
        }
        
        this.displayCustomers();
    }

    displayCustomers() {
        const customersList = document.getElementById('customersList');
        
        if (this.customers.length === 0) {
            customersList.innerHTML = `
                <div class="empty-state">
                    <h3>No customers found</h3>
                    <p>Customers will appear here once they have receipts.</p>
                </div>
            `;
            return;
        }
        
        if (this.filteredCustomers.length === 0) {
            customersList.innerHTML = `
                <div class="empty-state">
                    <h3>No customers found</h3>
                    <p>Try a different search term.</p>
                </div>
            `;
            return;
        }

        customersList.innerHTML = this.filteredCustomers.map(customer => `
            <div class="customer-card" onclick="customersManager.selectCustomer('${customer.name.replace(/'/g, "\\'")}')">
                <div class="customer-name">${this.escapeHtml(customer.name)}</div>
                <div class="customer-receipt-count">Click to view receipts</div>
            </div>
        `).join('');
    }

    async selectCustomer(customerName) {
        await this.loadReceipts(customerName);
        this.showReceiptsView();
    }

    displayReceipts() {
        const customerHeader = document.getElementById('customerHeader');
        const receiptsList = document.getElementById('receiptsList');

        // Calculate total unpaid amount across all receipts
        let totalUnpaid = 0;
        this.receipts.forEach(receipt => {
            if (receipt.remainingBalance !== undefined) {
                totalUnpaid += receipt.remainingBalance;
            } else {
                // Calculate remaining balance if not stored
                const totalPaid = (receipt.payments?.cash || 0) + (receipt.payments?.online || 0);
                const remaining = receipt.grandTotal - totalPaid;
                if (remaining > 0) {
                    totalUnpaid += remaining;
                }
            }
        });

        // Display customer name with total unpaid
        customerHeader.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                <span>Receipts for ${this.escapeHtml(this.currentCustomer)}</span>
                ${totalUnpaid > 0 ? `
                    <span style="font-size: 18px; font-weight: 700; color: #dc3545;">
                        Total Unpaid: ₹${this.formatCurrency(totalUnpaid)}
                    </span>
                ` : `
                    <span style="font-size: 18px; font-weight: 700; color: #28a745;">
                        All Paid
                    </span>
                `}
            </div>
        `;

        if (this.receipts.length === 0) {
            receiptsList.innerHTML = `
                <div class="empty-state">
                    <h3>No receipts found</h3>
                    <p>This customer has no receipts yet.</p>
                </div>
            `;
            return;
        }

        // Sort receipts by date (newest first) for display
        // But preserve the original index for payment updates
        const sortedReceipts = [...this.receipts].sort((a, b) => {
            const dateA = this.parseDate(a.date);
            const dateB = this.parseDate(b.date);
            if (dateA !== dateB) {
                return dateB - dateA;
            }
            // If same date, sort by time
            return (b.time || '').localeCompare(a.time || '');
        });

        receiptsList.innerHTML = sortedReceipts.map((receipt, index) => {
            const totalPaid = (receipt.payments?.cash || 0) + (receipt.payments?.online || 0);
            const remainingBalance = receipt.grandTotal - totalPaid;
            const paymentStatus = this.getPaymentStatus(receipt.grandTotal, totalPaid);

            return `
                <div class="receipt-card" onclick="customersManager.selectReceipt(${index})">
                    <div class="receipt-header">
                        <div>
                            <div class="receipt-date">${this.escapeHtml(receipt.date || 'N/A')}</div>
                            <div class="receipt-time">${this.escapeHtml(receipt.time || '')}</div>
                        </div>
                        <div class="receipt-total">₹${this.formatCurrency(receipt.grandTotal || 0)}</div>
                    </div>
                    <div class="receipt-payment-status payment-status-${paymentStatus}">
                        ${this.getPaymentStatusText(paymentStatus)}
                    </div>
                    ${remainingBalance > 0 ? `<div class="remaining-balance">Remaining: ₹${this.formatCurrency(remainingBalance)}</div>` : ''}
                </div>
            `;
        }).join('');
    }

    selectReceipt(index) {
        // Get the receipt from the sorted display array
        const sortedReceipts = [...this.receipts].sort((a, b) => {
            const dateA = this.parseDate(a.date);
            const dateB = this.parseDate(b.date);
            if (dateA !== dateB) {
                return dateB - dateA;
            }
            return (b.time || '').localeCompare(a.time || '');
        });
        
        this.currentReceipt = sortedReceipts[index];
        // Use the original column index stored in the receipt
        this.currentReceiptIndex = this.currentReceipt._originalIndex !== undefined 
            ? this.currentReceipt._originalIndex 
            : this.receipts.indexOf(this.currentReceipt);
        this.showPaymentModal();
    }

    showPaymentModal() {
        const modal = document.getElementById('paymentModal');
        const receiptSummary = document.getElementById('receiptSummary');
        const cashPayment = document.getElementById('cashPayment');
        const onlinePayment = document.getElementById('onlinePayment');

        // Display receipt summary
        const receipt = this.currentReceipt;
        const totalPaid = (receipt.payments?.cash || 0) + (receipt.payments?.online || 0);
        const remainingBalance = receipt.grandTotal - totalPaid;

        receiptSummary.innerHTML = `
            <div class="receipt-summary-item">
                <span class="receipt-summary-label">Date:</span>
                <span class="receipt-summary-value">${this.escapeHtml(receipt.date || 'N/A')}</span>
            </div>
            <div class="receipt-summary-item">
                <span class="receipt-summary-label">Time:</span>
                <span class="receipt-summary-value">${this.escapeHtml(receipt.time || 'N/A')}</span>
            </div>
            <div class="receipt-summary-item">
                <span class="receipt-summary-label">Grand Total:</span>
                <span class="receipt-summary-value">₹${this.formatCurrency(receipt.grandTotal || 0)}</span>
            </div>
            <div class="receipt-summary-item">
                <span class="receipt-summary-label">Items:</span>
                <span class="receipt-summary-value">${receipt.items?.length || 0}</span>
            </div>
            ${totalPaid > 0 ? `
                <div class="receipt-summary-item">
                    <span class="receipt-summary-label">Total Paid:</span>
                    <span class="receipt-summary-value">₹${this.formatCurrency(totalPaid)}</span>
                </div>
                <div class="receipt-summary-item">
                    <span class="receipt-summary-label">Remaining Balance:</span>
                    <span class="receipt-summary-value">₹${this.formatCurrency(remainingBalance)}</span>
                </div>
            ` : ''}
        `;

        // Set current payment values
        cashPayment.value = receipt.payments?.cash || 0;
        onlinePayment.value = receipt.payments?.online || 0;

        modal.classList.add('active');
    }

    closePaymentModal() {
        const modal = document.getElementById('paymentModal');
        modal.classList.remove('active');
    }

    async savePayment() {
        const cashPayment = parseFloat(document.getElementById('cashPayment').value) || 0;
        const onlinePayment = parseFloat(document.getElementById('onlinePayment').value) || 0;
        const totalPaid = cashPayment + onlinePayment;

        if (totalPaid > this.currentReceipt.grandTotal) {
            alert('Total payment cannot exceed the grand total.');
            return;
        }

        this.showLoading();
        try {
            const response = await fetch('/api/update-receipt-payment', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    customerName: this.currentCustomer,
                    receiptIndex: this.currentReceiptIndex !== undefined ? this.currentReceiptIndex : this.receipts.indexOf(this.currentReceipt),
                    payments: {
                        cash: cashPayment,
                        online: onlinePayment
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to update payment: ${response.status}`);
            }

            const result = await response.json();
            if (result.success) {
                // Update local receipt data
                this.currentReceipt.payments = {
                    cash: cashPayment,
                    online: onlinePayment
                };
                this.currentReceipt.remainingBalance = this.currentReceipt.grandTotal - totalPaid;
                
                // Update the receipts array with the new payment data
                const receiptIndex = this.receipts.findIndex(r => r._originalIndex === this.currentReceiptIndex);
                if (receiptIndex !== -1) {
                    this.receipts[receiptIndex].payments = this.currentReceipt.payments;
                    this.receipts[receiptIndex].remainingBalance = this.currentReceipt.remainingBalance;
                }
                
                // Update local cache with payment information
                this.updateCustomersCacheWithPayment(
                    this.currentCustomer,
                    this.currentReceiptIndex,
                    {
                        cash: cashPayment,
                        online: onlinePayment
                    }
                );
                
                // Refresh the receipts display to show updated payment info
                this.displayReceipts();
                this.closePaymentModal();
            } else {
                throw new Error(result.error || 'Failed to save payment');
            }
        } catch (error) {
            console.error('Error saving payment:', error);
            alert('Failed to save payment. Please try again.');
        } finally {
            this.hideLoading();
        }
    }

    showCustomersView() {
        document.getElementById('customersView').style.display = 'block';
        document.getElementById('receiptsView').classList.remove('active');
        this.currentCustomer = null;
        this.currentReceipt = null;
        this.currentReceiptIndex = null;
        this.receipts = [];
    }

    showReceiptsView() {
        document.getElementById('customersView').style.display = 'none';
        document.getElementById('receiptsView').classList.add('active');
    }

    getPaymentStatus(grandTotal, totalPaid) {
        if (totalPaid >= grandTotal) {
            return 'paid';
        } else if (totalPaid > 0) {
            return 'partial';
        } else {
            return 'unpaid';
        }
    }

    getPaymentStatusText(status) {
        switch (status) {
            case 'paid':
                return 'Paid';
            case 'partial':
                return 'Partial Payment';
            case 'unpaid':
                return 'Unpaid';
            default:
                return 'Unknown';
        }
    }

    parseDate(dateStr) {
        if (!dateStr) return 0;
        // Try to parse DD/MM/YYYY format
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            return new Date(parts[2], parts[1] - 1, parts[0]).getTime();
        }
        return new Date(dateStr).getTime() || 0;
    }

    formatCurrency(amount) {
        return parseFloat(amount).toFixed(2);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showError(message) {
        const customersList = document.getElementById('customersList');
        customersList.innerHTML = `
            <div class="error-message">
                ${this.escapeHtml(message)}
            </div>
        `;
    }
}

// Initialize the customers manager
const customersManager = new CustomersManager();

