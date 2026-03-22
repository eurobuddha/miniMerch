/**
 * @file Database operations module for miniMerch
 * @version 1.0.0
 */

// @ts-check

/**
 * @typedef {Object} SqlResult
 * @property {boolean} status - Whether the query succeeded
 * @property {Array<Object>} [rows] - Result rows for SELECT queries
 * @property {string} [error] - Error message if status is false
 */

/**
 * @typedef {Object} MessageRecord
 * @property {string} randomid - Unique identifier
 * @property {string} ref - Order reference
 * @property {string} type - Message type (ORDER, REPLY, etc.)
 * @property {string} product - Product name
 * @property {string} size - Size/quantity info
 * @property {string} amount - Payment amount
 * @property {string} currency - Currency (USDT, Minima)
 * @property {string} delivery - Delivery address
 * @property {string} shipping - Shipping method
 * @property {string} message - Message content
 * @property {number} timestamp - Unix timestamp
 * @property {string} coinid - Transaction ID
 * @property {boolean} read - Read status
 * @property {string} direction - 'sent' or 'received'
 * @property {string} buyerPublicKey - Buyer's Maxima public key
 * @property {string} vendorPublicKey - Vendor's Maxima public key
 * @property {string} vendorAddress - Vendor's Minima address
 * @property {string} subject - Message subject
 * @property {string} originalOrder - Original order JSON
 * @property {string} status - Order status (PENDING, PAID, CONFIRMED, SHIPPED, DELIVERED)
 */

/** @type {boolean} */
let dbReady = false;

/**
 * Escape a value for SQL insertion
 * @param {any} val - Value to escape
 * @returns {string} Escaped SQL value
 */
function escapeSQL(val) {
    if (val == null) return 'NULL';
    return "'" + String(val).replace(/'/g, "''") + "'";
}

/**
 * Wrap MDS.sql in a Promise
 * @param {string} command - SQL command
 * @returns {Promise<SqlResult>} SQL result
 */
function sqlAsync(command) {
    return new Promise((resolve) => {
        MDS.sql(command, (result) => {
            resolve(result);
        });
    });
}

/**
 * Initialize the database tables
 * @returns {Promise<void>}
 */
async function initDB() {
    if (dbReady) return;
    try {
        // Create tables with all columns including new status field
        const createResult = await sqlAsync(
            `CREATE TABLE IF NOT EXISTS messages (` +
            `id INTEGER PRIMARY KEY AUTO_INCREMENT,` +
            `randomid VARCHAR(255) UNIQUE,` +
            `ref VARCHAR(255), type VARCHAR(50), product VARCHAR(500), size VARCHAR(100),` +
            `amount VARCHAR(50), currency VARCHAR(50), delivery VARCHAR(500), shipping VARCHAR(50),` +
            `message TEXT, timestamp BIGINT, coinid VARCHAR(255),` +
            `"read" INTEGER DEFAULT 0, direction VARCHAR(50) DEFAULT 'sent',` +
            `buyerPublicKey TEXT, vendorPublicKey TEXT, vendorAddress VARCHAR(255),` +
            `subject VARCHAR(500), originalOrder TEXT,` +
            `status VARCHAR(50) DEFAULT 'PENDING')`
        );
        console.log('CREATE messages table result:', JSON.stringify(createResult));

        const createSettingsResult = await sqlAsync(
            `CREATE TABLE IF NOT EXISTS settings ("key" VARCHAR(255) PRIMARY KEY, "value" TEXT)`
        );
        console.log('CREATE settings table result:', JSON.stringify(createSettingsResult));

        // Migration: Add columns if they don't exist (for existing installs)
        await sqlAsync(`ALTER TABLE messages ADD COLUMN subject TEXT`);
        await sqlAsync(`ALTER TABLE messages ADD COLUMN originalOrder TEXT`);
        await sqlAsync(`ALTER TABLE messages ADD COLUMN direction TEXT DEFAULT 'sent'`);
        await sqlAsync(`ALTER TABLE messages ADD COLUMN vendorPublicKey TEXT`);
        await sqlAsync(`ALTER TABLE messages ADD COLUMN vendorAddress TEXT`);
        await sqlAsync(`ALTER TABLE messages ADD COLUMN status TEXT DEFAULT 'PENDING'`);

        // Verify table exists
        const verifyResult = await sqlAsync(`SELECT COUNT(*) as cnt FROM messages`);
        console.log('Verify messages table:', JSON.stringify(verifyResult));

        if (verifyResult && verifyResult.status) {
            dbReady = true;
            console.log('Shop DB initialized successfully');
        } else {
            console.error('Shop DB verification failed:', verifyResult?.error);
        }
    } catch (err) {
        console.error('Shop DB init error:', err);
    }
}

/**
 * Save a setting to the database
 * @param {string} key - Setting key
 * @param {string} value - Setting value
 * @returns {Promise<void>}
 */
async function saveSetting(key, value) {
    try {
        await sqlAsync(`MERGE INTO settings ("key", "value") KEY ("key") VALUES (${escapeSQL(key)}, ${escapeSQL(value)})`);
    } catch (err) {
        console.error('saveSetting error:', err);
    }
}

/**
 * Load a setting from the database
 * @param {string} key - Setting key
 * @returns {Promise<string|null>} Setting value or null
 */
async function loadSetting(key) {
    try {
        const resp = await sqlAsync(`SELECT "value" FROM settings WHERE "key" = ${escapeSQL(key)}`);
        if (resp && resp.status && resp.rows && resp.rows.length > 0) {
            // H2 returns column names in UPPERCASE
            return resp.rows[0].VALUE || resp.rows[0].value;
        }
    } catch (err) {
        console.error('loadSetting error:', err);
    }
    return null;
}

/**
 * Save a message to the database
 * @param {MessageRecord} message - Message to save
 * @returns {Promise<boolean>} Success status
 */
async function saveMessageToDb(message) {
    try {
        // Generate randomid if not present
        if (!message.randomid) {
            message.randomid = generateRandomId();
        }

        // Check if already exists
        const existsResp = await sqlAsync(`SELECT id FROM messages WHERE randomid = ${escapeSQL(message.randomid)}`);
        if (existsResp && existsResp.status && existsResp.rows && existsResp.rows.length > 0) {
            console.log('saveMessageToDb: message already exists, randomid:', message.randomid);
            return true;
        }

        const sql = `INSERT INTO messages ` +
            `(randomid, ref, type, product, size, amount, currency, delivery, shipping, message, ` +
            `timestamp, coinid, "read", direction, buyerPublicKey, vendorPublicKey, vendorAddress, ` +
            `subject, originalOrder, status) ` +
            `VALUES (` +
            `${escapeSQL(message.randomid)}, ` +
            `${escapeSQL(message.ref || '')}, ${escapeSQL(message.type || 'ORDER')}, ` +
            `${escapeSQL(message.product || '')}, ${escapeSQL(message.size || '')}, ` +
            `${escapeSQL(message.amount || '')}, ${escapeSQL(message.currency || '')}, ` +
            `${escapeSQL(message.delivery || '')}, ${escapeSQL(message.shipping || '')}, ` +
            `${escapeSQL(message.message || '')}, ${message.timestamp || Date.now()}, ` +
            `${escapeSQL(message.coinid || '')}, ${message.read ? 1 : 0}, ` +
            `${escapeSQL(message.direction || 'sent')}, ` +
            `${escapeSQL(message.buyerPublicKey || '')}, ` +
            `${escapeSQL(message.vendorPublicKey || '')}, ${escapeSQL(message.vendorAddress || '')}, ` +
            `${escapeSQL(message.subject || '')}, ${escapeSQL(message.originalOrder || '')}, ` +
            `${escapeSQL(message.status || 'PENDING')})`;

        console.log('saveMessageToDb SQL:', sql.substring(0, 200) + '...');

        const result = await sqlAsync(sql);

        if (result && result.status) {
            console.log('saveMessageToDb SUCCESS: randomid:', message.randomid, 'direction:', message.direction);
            return true;
        } else {
            console.error('saveMessageToDb FAILED:', result?.error || JSON.stringify(result), 'randomid:', message.randomid);
            return false;
        }
    } catch (err) {
        console.error('saveMessageToDb error:', err, 'randomid:', message.randomid);
        return false;
    }
}

/**
 * Update message read status
 * @param {string} randomid - Message randomid
 * @param {boolean} read - New read status
 * @returns {Promise<boolean>} Success status
 */
async function updateMessageReadStatus(randomid, read) {
    try {
        const result = await sqlAsync(`UPDATE messages SET "read" = ${read ? 1 : 0} WHERE randomid = ${escapeSQL(randomid)}`);
        console.log('updateMessageReadStatus:', randomid, 'read:', read, 'result:', result?.status);
        return result && result.status;
    } catch (err) {
        console.error('updateMessageReadStatus error:', err);
        return false;
    }
}

/**
 * Update message status
 * @param {string} randomid - Message randomid
 * @param {string} status - New status (PENDING, PAID, CONFIRMED, SHIPPED, DELIVERED)
 * @returns {Promise<boolean>} Success status
 */
async function updateMessageStatus(randomid, status) {
    try {
        const result = await sqlAsync(`UPDATE messages SET status = ${escapeSQL(status)} WHERE randomid = ${escapeSQL(randomid)}`);
        console.log('updateMessageStatus:', randomid, 'status:', status, 'result:', result?.status);
        return result && result.status;
    } catch (err) {
        console.error('updateMessageStatus error:', err);
        return false;
    }
}

/**
 * Load all messages from the database
 * @returns {Promise<Array<MessageRecord>>} Array of messages
 */
async function loadMessagesFromDb() {
    try {
        const resp = await sqlAsync(`SELECT * FROM messages ORDER BY timestamp DESC`);
        console.log('loadMessagesFromDb: found', resp?.rows?.length || 0, 'messages');
        if (resp && resp.status && resp.rows) {
            // H2 database returns column names in UPPERCASE and numbers as strings
            return resp.rows.map(row => {
                const ts = row.TIMESTAMP || row.timestamp;
                const dir = row.DIRECTION || row.direction || 'sent';
                const rd = row.READ || row.read;
                const st = row.STATUS || row.status || 'PENDING';
                console.log('loadMessagesFromDb row:', row.RANDOMID || row.randomid, 'direction:', dir, 'read:', rd, 'status:', st);
                return {
                    id: row.ID || row.id,
                    randomid: row.RANDOMID || row.randomid,
                    ref: row.REF || row.ref,
                    type: row.TYPE || row.type,
                    product: row.PRODUCT || row.product,
                    size: row.SIZE || row.size,
                    amount: row.AMOUNT || row.amount,
                    currency: row.CURRENCY || row.currency,
                    delivery: row.DELIVERY || row.delivery,
                    shipping: row.SHIPPING || row.shipping,
                    message: row.MESSAGE || row.message,
                    timestamp: ts ? parseInt(ts, 10) : Date.now(),
                    coinid: row.COINID || row.coinid,
                    read: !!(rd && rd !== '0' && rd !== 0),
                    direction: dir,
                    status: st,
                    buyerPublicKey: row.BUYERPUBLICKEY || row.buyerPublicKey,
                    vendorPublicKey: row.VENDORPUBLICKEY || row.vendorPublicKey,
                    vendorAddress: row.VENDORADDRESS || row.vendorAddress,
                    subject: row.SUBJECT || row.subject,
                    originalOrder: row.ORIGINALORDER || row.originalOrder
                };
            });
        }
    } catch (err) {
        console.error('loadMessagesFromDb error:', err);
    }
    return [];
}

/**
 * Check if a message is already stored
 * @param {string} randomid - Message randomid
 * @returns {Promise<boolean>} True if stored
 */
async function isMessageStored(randomid) {
    if (!randomid) return false;
    try {
        const resp = await sqlAsync(`SELECT randomid FROM messages WHERE randomid = ${escapeSQL(randomid)}`);
        return resp && resp.status && resp.rows && resp.rows.length > 0;
    } catch (err) {
        return false;
    }
}

/**
 * Generate a random ID
 * @returns {string} Random ID
 */
function generateRandomId() {
    return Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Export messages to JSON format
 * @param {string} [status] - Optional status filter
 * @param {number} [startDate] - Optional start timestamp
 * @param {number} [endDate] - Optional end timestamp
 * @returns {Promise<string>} JSON string
 */
async function exportMessagesToJson(status, startDate, endDate) {
    try {
        let query = `SELECT * FROM messages WHERE 1=1`;
        if (status) query += ` AND status = ${escapeSQL(status)}`;
        if (startDate) query += ` AND timestamp >= ${startDate}`;
        if (endDate) query += ` AND timestamp <= ${endDate}`;
        query += ` ORDER BY timestamp DESC`;

        const resp = await sqlAsync(query);
        return JSON.stringify(resp.rows || [], null, 2);
    } catch (err) {
        console.error('exportMessagesToJson error:', err);
        return '[]';
    }
}

/**
 * Convert array to CSV
 * @param {Array<Object>} rows - Data rows
 * @returns {string} CSV string
 */
function convertToCsv(rows) {
    if (!rows || rows.length === 0) return '';
    const headers = Object.keys(rows[0]);
    const csvRows = [
        headers.join(','),
        ...rows.map(row => headers.map(h => {
            const val = row[h];
            // Escape values containing commas or quotes
            const str = val === null || val === undefined ? '' : String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        }).join(','))
    ];
    return csvRows.join('\n');
}

/**
 * Export messages to CSV format
 * @param {string} [status] - Optional status filter
 * @param {number} [startDate] - Optional start timestamp
 * @param {number} [endDate] - Optional end timestamp
 * @returns {Promise<string>} CSV string
 */
async function exportMessagesToCsv(status, startDate, endDate) {
    try {
        let query = `SELECT * FROM messages WHERE 1=1`;
        if (status) query += ` AND status = ${escapeSQL(status)}`;
        if (startDate) query += ` AND timestamp >= ${startDate}`;
        if (endDate) query += ` AND timestamp <= ${endDate}`;
        query += ` ORDER BY timestamp DESC`;

        const resp = await sqlAsync(query);
        return convertToCsv(resp.rows || []);
    } catch (err) {
        console.error('exportMessagesToCsv error:', err);
        return '';
    }
}
