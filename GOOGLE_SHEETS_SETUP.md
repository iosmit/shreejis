# Google Sheets Receipt Storage Setup

This guide will help you set up automatic saving of receipts to Google Sheets.

## Step 1: Create a Google Sheet

1. Open your Google Sheet (or create a new one)
2. Make sure you have a sheet named **"Customer Receipts"** (case-sensitive)
   - If it doesn't exist, the script will create it automatically with headers
3. Create a sheet named **"Customer Orders"** (case-sensitive)
   - This sheet stores pending customer orders before approval
   - The script will create it automatically if it doesn't exist
4. The script will automatically add headers if the sheets are new:
   - **Customer Receipts**: **CUSTOMER** (column 1) | **RECEIPT** (column 2, and additional RECEIPT columns as needed)
   - **Customer Orders**: **CUSTOMER** (column 1) | **PASSWORD** (column 2) | **ORDER** (column 3)

## Step 2: Create Google Apps Script

1. In your Google Sheet, go to **Extensions** → **Apps Script**
2. Delete any default code and paste the following:

```javascript
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    
    if (action === 'updatePayment') {
      return handleUpdatePayment(data);
    } else if (action === 'deleteReceipt') {
      return handleDeleteReceipt(data);
    } else if (action === 'deleteCustomer') {
      return handleDeleteCustomer(data);
    } else if (action === 'saveOrder') {
      return handleSaveOrder(data);
    } else if (action === 'approveOrder') {
      return handleApproveOrder(data);
    } else {
      // Default action: save receipt
      return handleSaveReceipt(data);
    }
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({success: false, error: error.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    const action = e.parameter.action;
    
    if (action === 'getReceipts') {
      return handleGetReceipts(e.parameter.customer);
    } else if (action === 'getAllCustomers') {
      return handleGetAllCustomers();
    }
    
    return ContentService.createTextOutput(JSON.stringify({success: false, error: 'Invalid action'}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({success: false, error: error.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function handleSaveReceipt(data) {
  // Get the specific sheet named "Customer Receipts"
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName('Customer Receipts');
  
  // Create the sheet if it doesn't exist
  if (!sheet) {
    sheet = spreadsheet.insertSheet('Customer Receipts');
    // Add headers: CUSTOMER | RECEIPT | RECEIPT | ...
    sheet.getRange(1, 1).setValue('CUSTOMER');
    sheet.getRange(1, 2).setValue('RECEIPT');
    // Make header row bold
    const headerRange = sheet.getRange(1, 1, 1, 2);
    headerRange.setFontWeight('bold');
  }
  
  // Get receipt data
  const storeName = data.storeName || '';
  const customerName = data.customerName || '';
  const date = data.date || '';
  const time = data.time || '';
  const grandTotal = data.grandTotal || 0;
  const items = data.items || [];
  const profitMargin = data.profitMargin || 0;
  
  // Create receipt JSON object
  const receiptJson = JSON.stringify({
    date: date,
    time: time,
    customerName: customerName || 'Walk-in',
    items: items,
    grandTotal: grandTotal,
    profitMargin: profitMargin,
    storeName: storeName,
    payments: {
      cash: 0,
      online: 0
    },
    remainingBalance: grandTotal
  });
  
  const displayCustomerName = customerName || 'Walk-in';
  
  // Find the customer row (row with customer name in column 1)
  let customerRow = null;
  const lastRow = sheet.getLastRow();
  
  if (lastRow >= 1) {
    // Check all rows (starting from row 2, since row 1 is header)
    for (let i = 2; i <= lastRow; i++) {
      const rowCustomerName = sheet.getRange(i, 1).getValue();
      if (rowCustomerName === displayCustomerName) {
        customerRow = i;
        break;
      }
    }
  }
  
  if (customerRow) {
    // Customer exists - shift all existing receipts to the right
    // Latest receipt always goes in column 2
    const lastCol = sheet.getLastColumn();
    
    // Shift all existing receipts one column to the right (from right to left)
    for (let col = lastCol; col >= 2; col--) {
      const sourceValue = sheet.getRange(customerRow, col).getValue();
      if (sourceValue !== '' && sourceValue !== null) {
        // Shift this receipt to the next column
        sheet.getRange(customerRow, col + 1).setValue(sourceValue);
      }
    }
    
    // If we need a new receipt column, add header
    const newLastCol = Math.max(lastCol + 1, 3); // At least column 3 after shift
    if (newLastCol > lastCol) {
      sheet.getRange(1, newLastCol).setValue('RECEIPT');
      sheet.getRange(1, newLastCol).setFontWeight('bold');
    }
    
    // Add new receipt in column 2 (latest receipt)
    sheet.getRange(customerRow, 2).setValue(receiptJson);
  } else {
    // New customer - add new row with customer name and first receipt
    const newCustomerRow = lastRow + 1;
    
    // Add customer name in column 1
    sheet.getRange(newCustomerRow, 1).setValue(displayCustomerName);
    
    // Ensure we have at least 2 columns (CUSTOMER and RECEIPT)
    const lastCol = sheet.getLastColumn();
    if (lastCol < 2) {
      sheet.getRange(1, 2).setValue('RECEIPT');
      sheet.getRange(1, 2).setFontWeight('bold');
    }
    
    // Add receipt in column 2 (first receipt column)
    sheet.getRange(newCustomerRow, 2).setValue(receiptJson);
  }
  
  // Update stock quantities after saving receipt
  try {
    updateStockQuantities(spreadsheet, items);
  } catch (stockError) {
    // Log error but don't fail the receipt save
    console.error('Error updating stock:', stockError);
  }
  
  return ContentService.createTextOutput(JSON.stringify({success: true}))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleGetReceipts(customerName) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName('Customer Receipts');
  
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({success: true, receipts: []}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return ContentService.createTextOutput(JSON.stringify({success: true, receipts: []}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // Find the customer row
  let customerRow = null;
  for (let i = 2; i <= lastRow; i++) {
    const rowCustomerName = sheet.getRange(i, 1).getValue();
    if (rowCustomerName === customerName) {
      customerRow = i;
      break;
    }
  }
  
  if (!customerRow) {
    return ContentService.createTextOutput(JSON.stringify({success: true, receipts: []}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // Get all receipts for this customer (starting from column 2)
  const lastCol = sheet.getLastColumn();
  const receipts = [];
  
  for (let col = 2; col <= lastCol; col++) {
    const receiptValue = sheet.getRange(customerRow, col).getValue();
    if (receiptValue && receiptValue !== '') {
      try {
        const receipt = JSON.parse(receiptValue);
        receipts.push(receipt);
      } catch (e) {
        // Skip invalid JSON
        console.error('Error parsing receipt JSON:', e);
      }
    }
  }
  
  return ContentService.createTextOutput(JSON.stringify({success: true, receipts: receipts}))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleUpdatePayment(data) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName('Customer Receipts');
  
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({success: false, error: 'Sheet not found'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  const customerName = data.customerName;
  const receiptIndex = data.receiptIndex;
  const payments = data.payments;
  
  // Find the customer row
  const lastRow = sheet.getLastRow();
  let customerRow = null;
  
  for (let i = 2; i <= lastRow; i++) {
    const rowCustomerName = sheet.getRange(i, 1).getValue();
    if (rowCustomerName === customerName) {
      customerRow = i;
      break;
    }
  }
  
  if (!customerRow) {
    return ContentService.createTextOutput(JSON.stringify({success: false, error: 'Customer not found'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // Get all receipts for this customer
  const lastCol = sheet.getLastColumn();
  const receipts = [];
  const receiptColumns = [];
  
  for (let col = 2; col <= lastCol; col++) {
    const receiptValue = sheet.getRange(customerRow, col).getValue();
    if (receiptValue && receiptValue !== '') {
      try {
        const receipt = JSON.parse(receiptValue);
        receipts.push(receipt);
        receiptColumns.push(col);
      } catch (e) {
        // Skip invalid JSON
      }
    }
  }
  
  if (receiptIndex < 0 || receiptIndex >= receipts.length) {
    return ContentService.createTextOutput(JSON.stringify({success: false, error: 'Invalid receipt index'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // Update the receipt with payment information
  const receipt = receipts[receiptIndex];
  
  // Merge payment data into existing receipt (preserve existing data)
  if (!receipt.payments) {
    receipt.payments = {};
  }
  receipt.payments.cash = payments.cash || 0;
  receipt.payments.online = payments.online || 0;
  
  // Calculate remaining balance
  const totalPaid = (receipt.payments.cash || 0) + (receipt.payments.online || 0);
  receipt.remainingBalance = receipt.grandTotal - totalPaid;
  
  // Save the updated receipt back to the sheet
  const targetCol = receiptColumns[receiptIndex];
  sheet.getRange(customerRow, targetCol).setValue(JSON.stringify(receipt));
  
  return ContentService.createTextOutput(JSON.stringify({success: true}))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleDeleteReceipt(data) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName('Customer Receipts');
  
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({success: false, error: 'Sheet not found'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  const customerName = data.customerName;
  const receiptIndex = data.receiptIndex;
  
  // Find the customer row
  const lastRow = sheet.getLastRow();
  let customerRow = null;
  
  for (let i = 2; i <= lastRow; i++) {
    const rowCustomerName = sheet.getRange(i, 1).getValue();
    if (rowCustomerName === customerName) {
      customerRow = i;
      break;
    }
  }
  
  if (!customerRow) {
    return ContentService.createTextOutput(JSON.stringify({success: false, error: 'Customer not found'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // Get all receipt columns for this customer
  const lastCol = sheet.getLastColumn();
  const receiptColumns = [];
  
  for (let col = 2; col <= lastCol; col++) {
    const receiptValue = sheet.getRange(customerRow, col).getValue();
    if (receiptValue && receiptValue !== '') {
      receiptColumns.push(col);
    }
  }
  
  if (receiptIndex < 0 || receiptIndex >= receiptColumns.length) {
    return ContentService.createTextOutput(JSON.stringify({success: false, error: 'Invalid receipt index'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // Get the column index of the receipt to delete
  let receiptCol = receiptColumns[receiptIndex];
  
  // Clear the receipt cell
  sheet.getRange(customerRow, receiptCol).clearContent();
  
  // Shift remaining receipts to fill the gap (move receipts from right to left)
  for (let col = receiptCol + 1; col <= lastCol; col++) {
    const nextValue = sheet.getRange(customerRow, col).getValue();
    if (nextValue && nextValue !== '') {
      // Move this receipt to the previous column
      sheet.getRange(customerRow, receiptCol).setValue(nextValue);
      sheet.getRange(customerRow, col).clearContent();
      receiptCol = col; // Update receiptCol for next iteration
    }
  }
  
  return ContentService.createTextOutput(JSON.stringify({success: true}))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleDeleteCustomer(data) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName('Customer Receipts');
  
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({success: false, error: 'Sheet not found'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  const customerName = data.customerName;
  
  // Find the customer row
  const lastRow = sheet.getLastRow();
  let customerRow = null;
  
  for (let i = 2; i <= lastRow; i++) {
    const rowCustomerName = sheet.getRange(i, 1).getValue();
    if (rowCustomerName === customerName) {
      customerRow = i;
      break;
    }
  }
  
  if (!customerRow) {
    return ContentService.createTextOutput(JSON.stringify({success: false, error: 'Customer not found'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // Delete the entire row
  sheet.deleteRow(customerRow);
  
  return ContentService.createTextOutput(JSON.stringify({success: true}))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleGetAllCustomers() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName('Customer Receipts');
  
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({success: true, customers: []}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return ContentService.createTextOutput(JSON.stringify({success: true, customers: []}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // Get all customer names from column 1 (starting from row 2)
  const customers = [];
  const seen = new Set();
  
  for (let i = 2; i <= lastRow; i++) {
    const customerName = sheet.getRange(i, 1).getValue();
    if (customerName && customerName !== '' && !seen.has(customerName)) {
      seen.add(customerName);
      customers.push(customerName);
    }
  }
  
  return ContentService.createTextOutput(JSON.stringify({success: true, customers: customers}))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleSaveOrder(data) {
  // Get the specific sheet named "Customer Orders"
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName('Customer Orders');
  
  // Create the sheet if it doesn't exist
  if (!sheet) {
    sheet = spreadsheet.insertSheet('Customer Orders');
    // Add headers: CUSTOMER | PASSWORD | ORDER
    sheet.getRange(1, 1).setValue('CUSTOMER');
    sheet.getRange(1, 2).setValue('PASSWORD');
    sheet.getRange(1, 3).setValue('ORDER');
    // Make header row bold
    const headerRange = sheet.getRange(1, 1, 1, 3);
    headerRange.setFontWeight('bold');
  }
  
  // Get order data
  const customerName = data.customerName || '';
  const storeName = data.storeName || '';
  const date = data.date || '';
  const time = data.time || '';
  const grandTotal = data.grandTotal || 0;
  const items = data.items || [];
  const profitMargin = data.profitMargin || 0;
  
  // Create order JSON object (same format as receipt)
  const orderJson = JSON.stringify({
    date: date,
    time: time,
    customerName: customerName,
    items: items,
    grandTotal: grandTotal,
    profitMargin: profitMargin,
    storeName: storeName,
    payments: {
      cash: 0,
      online: 0
    },
    remainingBalance: grandTotal
  });
  
  // Find the customer row (row with customer name in column 1)
  let customerRow = null;
  const lastRow = sheet.getLastRow();
  
  if (lastRow >= 1) {
    // Check all rows (starting from row 2, since row 1 is header)
    for (let i = 2; i <= lastRow; i++) {
      const rowCustomerName = sheet.getRange(i, 1).getValue();
      if (rowCustomerName === customerName) {
        customerRow = i;
        break;
      }
    }
  }
  
  if (customerRow) {
    // Customer exists - update the order in column 3
    sheet.getRange(customerRow, 3).setValue(orderJson);
  } else {
    // New customer - add new row
    const newCustomerRow = lastRow + 1;
    
    // Add customer name in column 1
    sheet.getRange(newCustomerRow, 1).setValue(customerName);
    
    // Password column (column 2) should already be set in the Customer Orders sheet
    // We don't set it here - it's managed separately
    
    // Add order in column 3
    sheet.getRange(newCustomerRow, 3).setValue(orderJson);
  }
  
  return ContentService.createTextOutput(JSON.stringify({success: true}))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleApproveOrder(data) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const ordersSheet = spreadsheet.getSheetByName('Customer Orders');
  const receiptsSheet = spreadsheet.getSheetByName('Customer Receipts');
  
  if (!ordersSheet) {
    return ContentService.createTextOutput(JSON.stringify({success: false, error: 'Customer Orders sheet not found'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  const customerName = data.customerName;
  const approved = data.approved;
  
  // Find the customer row in Customer Orders sheet
  const lastRow = ordersSheet.getLastRow();
  let customerRow = null;
  
  for (let i = 2; i <= lastRow; i++) {
    const rowCustomerName = ordersSheet.getRange(i, 1).getValue();
    if (rowCustomerName === customerName) {
      customerRow = i;
      break;
    }
  }
  
  if (!customerRow) {
    return ContentService.createTextOutput(JSON.stringify({success: false, error: 'Customer order not found'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // Get the order JSON from column 3
  const orderJson = ordersSheet.getRange(customerRow, 3).getValue();
  
  if (!orderJson || orderJson === '') {
    return ContentService.createTextOutput(JSON.stringify({success: false, error: 'No order found for customer'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  if (approved) {
    // Approved: Move order to Customer Receipts sheet
    // Create Customer Receipts sheet if it doesn't exist
    let receiptsSheet = spreadsheet.getSheetByName('Customer Receipts');
    if (!receiptsSheet) {
      receiptsSheet = spreadsheet.insertSheet('Customer Receipts');
      receiptsSheet.getRange(1, 1).setValue('CUSTOMER');
      receiptsSheet.getRange(1, 2).setValue('RECEIPT');
      const headerRange = receiptsSheet.getRange(1, 1, 1, 2);
      headerRange.setFontWeight('bold');
    }
    
    // Parse order JSON
    let orderData;
    try {
      orderData = typeof orderJson === 'string' ? JSON.parse(orderJson) : orderJson;
    } catch (e) {
      return ContentService.createTextOutput(JSON.stringify({success: false, error: 'Invalid order JSON'}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Find the customer row in Customer Receipts sheet
    const receiptsLastRow = receiptsSheet.getLastRow();
    let receiptsCustomerRow = null;
    
    if (receiptsLastRow >= 1) {
      for (let i = 2; i <= receiptsLastRow; i++) {
        const rowCustomerName = receiptsSheet.getRange(i, 1).getValue();
        if (rowCustomerName === customerName) {
          receiptsCustomerRow = i;
          break;
        }
      }
    }
    
    if (receiptsCustomerRow) {
      // Customer exists - shift all existing receipts to the right
      const lastCol = receiptsSheet.getLastColumn();
      
      // Shift all existing receipts one column to the right (from right to left)
      for (let col = lastCol; col >= 2; col--) {
        const sourceValue = receiptsSheet.getRange(receiptsCustomerRow, col).getValue();
        if (sourceValue !== '' && sourceValue !== null) {
          receiptsSheet.getRange(receiptsCustomerRow, col + 1).setValue(sourceValue);
        }
      }
      
      // If we need a new receipt column, add header
      const newLastCol = Math.max(lastCol + 1, 3);
      if (newLastCol > lastCol) {
        receiptsSheet.getRange(1, newLastCol).setValue('RECEIPT');
        receiptsSheet.getRange(1, newLastCol).setFontWeight('bold');
      }
      
      // Add new receipt in column 2 (latest receipt)
      receiptsSheet.getRange(receiptsCustomerRow, 2).setValue(orderJson);
    } else {
      // New customer in receipts - add new row
      const newReceiptsCustomerRow = receiptsLastRow + 1;
      
      // Add customer name in column 1
      receiptsSheet.getRange(newReceiptsCustomerRow, 1).setValue(customerName);
      
      // Ensure we have at least 2 columns
      const lastCol = receiptsSheet.getLastColumn();
      if (lastCol < 2) {
        receiptsSheet.getRange(1, 2).setValue('RECEIPT');
        receiptsSheet.getRange(1, 2).setFontWeight('bold');
      }
      
      // Add receipt in column 2
      receiptsSheet.getRange(newReceiptsCustomerRow, 2).setValue(orderJson);
    }
    
    // Update stock quantities after approving order
    try {
      updateStockQuantities(spreadsheet, orderData.items || []);
    } catch (stockError) {
      console.error('Error updating stock:', stockError);
    }
  }
  
  // Remove order from Customer Orders sheet (whether approved or disapproved)
  // Clear the order column (column 3)
  ordersSheet.getRange(customerRow, 3).clearContent();
  
  // Optionally, you can also remove the entire row if you want to clean up
  // Uncomment the next line if you want to delete the row entirely:
  // ordersSheet.deleteRow(customerRow);
  
  return ContentService.createTextOutput(JSON.stringify({success: true}))
    .setMimeType(ContentService.MimeType.JSON);
}

function updateStockQuantities(spreadsheet, items) {
  // Find the products sheet - try common names first, then first sheet
  let productsSheet = null;
  const sheetNames = ['Products List', 'Sheet1', 'Products', 'Product List', 'Store Products'];
  
  for (const name of sheetNames) {
    productsSheet = spreadsheet.getSheetByName(name);
    if (productsSheet) break;
  }
  
  // If not found, try the first sheet (index 0)
  if (!productsSheet) {
    const sheets = spreadsheet.getSheets();
    if (sheets.length > 0) {
      // Skip "Customer Receipts" sheet if it exists
      for (let i = 0; i < sheets.length; i++) {
        if (sheets[i].getName() !== 'Customer Receipts') {
          productsSheet = sheets[i];
          break;
        }
      }
      // If only Customer Receipts exists, use first sheet anyway
      if (!productsSheet && sheets.length > 0) {
        productsSheet = sheets[0];
      }
    }
  }
  
  if (!productsSheet) {
    console.error('Products sheet not found');
    return;
  }
  
  // Get header row to find column indices
  const headerRow = 1;
  const lastCol = productsSheet.getLastColumn();
  const headers = productsSheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];
  
  // Find column indices (case-insensitive)
  let productColIndex = -1;
  let stockColIndex = -1;
  
  for (let i = 0; i < headers.length; i++) {
    const header = String(headers[i] || '').trim().toUpperCase();
    if (header === 'PRODUCT' || header === 'PRODUCT NAME' || header === 'ITEM') {
      productColIndex = i + 1; // Column index is 1-based
    }
    if (header === 'STOCK INFO' || header === 'STOCK' || header === 'QUANTITY' || header === 'QTY') {
      stockColIndex = i + 1; // Column index is 1-based
    }
  }
  
  if (productColIndex === -1) {
    console.error('PRODUCT column not found in products sheet');
    return;
  }
  
  if (stockColIndex === -1) {
    console.error('STOCK INFO column not found in products sheet');
    return;
  }
  
  // Get all product data
  const lastRow = productsSheet.getLastRow();
  if (lastRow < 2) {
    console.error('No product data found');
    return;
  }
  
  // Create a map of product names to row numbers for quick lookup
  const productMap = {};
  for (let row = 2; row <= lastRow; row++) {
    const productName = String(productsSheet.getRange(row, productColIndex).getValue() || '').trim();
    if (productName) {
      // Store both exact match and uppercase match for flexibility
      productMap[productName] = row;
      productMap[productName.toUpperCase()] = row;
    }
  }
  
  // Update stock for each item in the receipt
  for (const item of items) {
    const itemName = String(item.name || '').trim();
    const quantity = parseFloat(item.quantity || 0);
    
    if (!itemName || quantity <= 0) {
      continue;
    }
    
    // Try to find the product row
    let productRow = productMap[itemName] || productMap[itemName.toUpperCase()];
    
    // If not found, try case-insensitive search
    if (!productRow) {
      for (const [key, row] of Object.entries(productMap)) {
        if (key.toUpperCase() === itemName.toUpperCase()) {
          productRow = row;
          break;
        }
      }
    }
    
    if (!productRow) {
      console.warn('Product not found in sheet:', itemName);
      continue;
    }
    
    // Get current stock value
    const currentStockCell = productsSheet.getRange(productRow, stockColIndex);
    const currentStock = parseFloat(currentStockCell.getValue() || 0);
    
    // Calculate new stock (decrement by quantity sold)
    const newStock = Math.max(0, currentStock - quantity);
    
    // Update stock value
    currentStockCell.setValue(newStock);
    
    console.log(`Updated stock for ${itemName}: ${currentStock} -> ${newStock} (sold ${quantity})`);
  }
}
```

3. Click **Save** (💾) and give your project a name (e.g., "Receipt Webhook")
4. Click **Deploy** → **New deployment**
5. Select type: **Web app**
6. Set:
   - Description: "Receipt Webhook"
   - Execute as: **Me**
   - Who has access: **Anyone**
7. Click **Deploy**
8. Copy the **Web app URL** (it will look like: `https://script.google.com/macros/s/.../exec`)

## Step 3: Publish Customer Orders Sheet as CSV

1. In your Google Sheet, go to the **Customer Orders** sheet
2. Click **File** → **Share** → **Publish to web**
3. Select:
   - **Link**: Entire document
   - **Sheet**: Customer Orders
   - **Format**: CSV
4. Click **Publish**
5. Copy the published CSV URL (it will look like: `https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/gviz/tq?tqx=out:csv&gid=...`)
6. Alternatively, you can use this format: `https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/gviz/tq?tqx=out:csv&sheet=Customer%20Orders`
   - Replace `YOUR_SHEET_ID` with your Google Sheet ID (found in the sheet URL)

## Step 4: Configure Environment Variables

1. Create or edit `.env` file in the `build` directory
2. Add the following lines:
   ```
   SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
   CUSTOMERS_ORDERS=https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/gviz/tq?tqx=out:csv&sheet=Customer%20Orders
   ```
   - Replace `YOUR_SCRIPT_ID` with the actual web app URL you copied from Step 2
   - Replace `YOUR_SHEET_ID` with your Google Sheet ID (found in the sheet URL)
   - Use the CSV URL you copied from Step 3 for `CUSTOMERS_ORDERS`

## Step 5: Test

1. Start your server: `npm start`
2. **Test Receipt Saving**: Add items to cart and click "Checkout"
3. **Test Order System**: 
   - Login with a customer password (from Customer Orders sheet)
   - Add items to cart and click "Place Order"
   - Check Customer Orders sheet - the order should appear
   - Go to Customers page - you should see a badge on the customer
   - Click the badge to approve/disapprove the order
4. Check your Google Sheets - the data should appear automatically

## Data Format

Receipts are organized horizontally by customer:
- **Header Row**: CUSTOMER | RECEIPT | RECEIPT | RECEIPT | ...
- **Each customer row**: Customer Name | Receipt 1 JSON | Receipt 2 JSON | Receipt 3 JSON | ...
- **Latest receipt is always in column 2** (first RECEIPT column)
- **Each receipt cell contains full receipt information in JSON format**

### Structure:
```
CUSTOMER  | RECEIPT                                    | RECEIPT                                    | RECEIPT
John Doe  | {"date":"15/11/2025","time":"10:30...     | {"date":"15/11/2025","time":"09:24...     | ...
Jane Smith| {"date":"15/11/2025","time":"11:00...     | ...                                        | ...
```

### JSON Format in Each Receipt Cell:
```json
{
  "date": "15/11/2025",
  "time": "10:30 pm",
  "customerName": "JOHN DOE",
  "items": [
    {"name": "Item1", "quantity": 2, "rate": 100.00, "total": 200.00},
    {"name": "Item2", "quantity": 1, "rate": 50.00, "total": 50.00}
  ],
  "grandTotal": 250.00,
  "profitMargin": 150.00,
  "storeName": "SHREEJI'S STORE",
  "payments": {
    "cash": 0,
    "online": 0
  },
  "remainingBalance": 250.00
}
```

**Important**: When a new receipt is added for an existing customer, all existing receipts are shifted one column to the right, and the new (latest) receipt is always placed in column 2.

## Customer Orders Sheet

The **Customer Orders** sheet stores pending orders from customers before they are approved:

### Structure:
```
CUSTOMER  | PASSWORD | ORDER
John Doe  | pass123  | {"date":"15/11/2025","time":"10:30...}
Jane Smith| pass456  | {"date":"15/11/2025","time":"11:00...}
```

### Columns:
- **CUSTOMER** (column 1): Customer name
- **PASSWORD** (column 2): Customer order password (used for customer login)
  - **Important**: You must manually add customer names and passwords to this sheet
  - Each customer should have a unique password
  - Customers use this password to log in to the order page
- **ORDER** (column 3): Order JSON (same format as receipt JSON)
  - This column is automatically populated when a customer places an order
  - It's cleared when the order is approved or disapproved

### How It Works:
1. **Customer Places Order**: When a customer places an order through the order page, it's saved to the Customer Orders sheet
2. **Store Views Orders**: The store can see pending orders as badges on the customers page
3. **Approve/Disapprove**: 
   - **Approve**: Order is moved from Customer Orders to Customer Receipts (as newest receipt) and stock is updated
   - **Disapprove**: Order is removed from Customer Orders sheet only

### Order JSON Format:
Same as receipt JSON format, but stored in Customer Orders sheet:
```json
{
  "date": "15/11/2025",
  "time": "10:30 pm",
  "customerName": "JOHN DOE",
  "items": [
    {"name": "Item1", "quantity": 2, "rate": 100.00, "total": 200.00},
    {"name": "Item2", "quantity": 1, "rate": 50.00, "total": 50.00}
  ],
  "grandTotal": 250.00,
  "profitMargin": 150.00,
  "storeName": "SHREEJI'S STORE",
  "payments": {
    "cash": 0,
    "online": 0
  },
  "remainingBalance": 250.00
}
```

## Stock Management

The script automatically updates stock quantities when receipts are generated:

1. **Products Sheet**: The script looks for a sheet containing products (prioritizes "Products List", then tries "Sheet1", "Products", "Product List", or the first sheet)
2. **Required Columns**: 
   - **PRODUCT** (or "PRODUCT NAME", "ITEM") - Product name column
   - **STOCK INFO** (or "STOCK", "QUANTITY", "QTY") - Stock quantity column (next to PURCHASE COST)
3. **How it works**: 
   - When a receipt is saved, the script finds each product in the receipt
   - It decrements the STOCK INFO column by the quantity sold
   - Stock cannot go below 0 (negative stock is prevented)
4. **Product Matching**: Products are matched by name (case-insensitive)
   - If a product in the receipt isn't found in the products sheet, a warning is logged but the receipt is still saved

**Note**: Stock updates happen automatically after each receipt is saved. If stock update fails, the receipt is still saved successfully (errors are logged but don't block receipt saving).

## Customer Order Workflow

1. **Customer Login**: Customer enters their password (from Customer Orders sheet, column 2)
2. **Place Order**: Customer adds items to cart and clicks "Place Order"
3. **Order Saved**: Order is saved to Customer Orders sheet (column 3)
4. **Store Notification**: Badge appears on customer card in customers page
5. **Review Order**: Store clicks badge to view order details
6. **Approve/Disapprove**:
   - **Approve**: Order moves to Customer Receipts sheet, stock is updated
   - **Disapprove**: Order is removed from Customer Orders sheet

## Notes

- The webhook runs silently in the background - errors won't interrupt the receipt display
- If saving fails, check the browser console for error messages
- Make sure your Google Apps Script has permission to edit the sheet
- Stock updates require the products sheet to have PRODUCT and STOCK INFO columns
- Stock is only updated when an order is **approved**, not when it's placed
- Customer Orders sheet should be published as CSV for the `CUSTOMERS_ORDERS` environment variable
- Each customer should have a unique password in the Customer Orders sheet

