const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');

// Import routes
const customers = require('./routes/customers');
const accounts = require('./routes/accounts');
const transactions = require('./routes/transactions');
const tcl = require('./routes/tcl');                    
const customerPortal = require('./routes/customerPortal');

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
app.use('/api/customers', customers);
app.use('/api/accounts', accounts);
app.use('/api/transactions', transactions);
app.use('/api/tcl', tcl);                              
app.use('/api/customer', customerPortal); 

// Serve static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Core Banking System API',
    database: 'cbs_db'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(` CBS Server running on http://localhost:${PORT}`);
  console.log(` Health check: http://localhost:${PORT}/health`);
   console.log(` Database: cbs_db`);
  console.log(` Frontend: http://localhost:${PORT}`);
  console.log(` Customer Portal: http://localhost:${PORT}/customer_login.html`);
  console.log(` TCL Demos: http://localhost:${PORT}/tcl_complete.html`);
});