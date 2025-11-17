# Google Sheets Receipt Storage Setup

This guide will help you set up automatic saving of receipts to Google Sheets.

## Step 1: Create a Google Sheet

1. Open your Google Sheet (or create a new one)
2. Make sure you have a sheet named **"Customer Receipts"** (case-sensitive)
   - If it doesn't exist, the script will create it automatically with headers
3. The script will automatically add headers if the sheet is new:
   - **CUSTOMER** (column 1)
   - **RECEIPT** (column 2, and additional RECEIPT columns as needed)

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
  
  // Create receipt JSON object
  const receiptJson = JSON.stringify({
    date: date,
    time: time,
    customerName: customerName || 'Walk-in',
    items: items,
    grandTotal: grandTotal,
    storeName: storeName
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

## Step 3: Configure Environment Variable

1. Create or edit `.env` file in the `build` directory
2. Add the following line:
   ```
   SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
   ```
   Replace `YOUR_SCRIPT_ID` with the actual web app URL you copied

## Step 4: Test

1. Start your server: `npm start`
2. Add items to cart and click "Checkout"
3. Check your Google Sheet - the receipt data should appear automatically

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
  "storeName": "SHREEJI'S STORE"
}
```

**Important**: When a new receipt is added for an existing customer, all existing receipts are shifted one column to the right, and the new (latest) receipt is always placed in column 2.

## Notes

- The webhook runs silently in the background - errors won't interrupt the receipt display
- If saving fails, check the browser console for error messages
- Make sure your Google Apps Script has permission to edit the sheet

