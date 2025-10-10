const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

// Import routes
const authRoutes = require('./routes/auth');
const roomRoutes = require('./routes/rooms');
const bookingRoutes = require('./routes/bookings');
const tourRoutes = require('./routes/tours');
const adminRoutes = require('./routes/admin');

// Import upload middleware
const { uploadDocument, handleUploadError, generateFileUrl } = require('./middleware/upload');

// Load environment variables
dotenv.config();

const app = express();

// Trust proxy for Railway
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiting for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 auth requests per windowMs
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.'
  },
});

// CORS configuration - Allow all origins for now to fix the issue
const corsOptions = {
  origin: true, // Allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With']
};

// Middleware
app.use(compression()); // Enable gzip compression
app.use(cors(corsOptions));

// Add explicit CORS headers for all routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }

  next();
});

app.use(express.json({ limit: '10mb' })); // Limit payload size
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Apply rate limiting
app.use('/', limiter);
app.use('/auth/', authLimiter);

// Serve uploaded files statically with caching
const uploadsPath = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(uploadsPath, {
  maxAge: '1d', // Cache for 1 day
  etag: true
}));

// Routes
app.use('/auth', authRoutes);
app.use('/rooms', roomRoutes);
app.use('/bookings', bookingRoutes);
app.use('/tours', tourRoutes);
app.use('/admin', adminRoutes);

// Upload route
app.post('/upload', uploadDocument, handleUploadError, generateFileUrl, (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No file uploaded'
    });
  }

  res.json({
    success: true,
    message: 'File uploaded successfully',
    file: {
      filename: req.file.filename,
      originalname: req.file.originalname,
      path: req.file.path,
      url: req.file.url,
      size: req.file.size
    }
  });
});

// Test route
app.get('/test', (req, res) => {
  res.json({ message: 'PerpusBooking API is working!' });
});
app.get('/', (req, res)=> {
  res.json({success: true, message: 'welcome to the API'});
});

// Test email route
app.get('/test-email', async (req, res) => {
  try {
    const { testEmailConnection } = require('./utils/email');
    const isConnected = await testEmailConnection();

    if (isConnected) {
      res.json({
        success: true,
        message: 'Email connection successful',
        config: {
          host: process.env.EMAIL_HOST,
          port: process.env.EMAIL_PORT,
          user: process.env.EMAIL_USER ? '***configured***' : 'not set',
          from: process.env.EMAIL_FROM,
          clientUrl: process.env.CLIENT_URL
        }
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Email connection failed',
        config: {
          host: process.env.EMAIL_HOST,
          port: process.env.EMAIL_PORT,
          user: process.env.EMAIL_USER ? '***configured***' : 'not set',
          from: process.env.EMAIL_FROM,
          clientUrl: process.env.CLIENT_URL
        }
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Email test error',
      error: error.message
    });
  }
});

// Download/View document route
app.get('/download/uploads/documents/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(__dirname, 'uploads', 'documents', filename);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      message: 'File not found'
    });
  }

  // Determine content type based on file extension
  const ext = filename.split('.').pop().toLowerCase();
  let contentType = 'application/octet-stream';
  let disposition = 'attachment';

  switch (ext) {
    case 'pdf':
      contentType = 'application/pdf';
      disposition = 'inline'; // Allow inline viewing for PDFs
      break;
    case 'jpg':
    case 'jpeg':
      contentType = 'image/jpeg';
      disposition = 'inline';
      break;
    case 'png':
      contentType = 'image/png';
      disposition = 'inline';
      break;
    case 'doc':
      contentType = 'application/msword';
      break;
    case 'docx':
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      break;
  }

  // Set headers
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);

  // Stream the file
  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);

  fileStream.on('error', (error) => {
    console.error('Error streaming file:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Error downloading file'
      });
    }
  });
});


// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/perpusbooking', {
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
})
.then(() => {
  console.log('Connected to MongoDB');
})
.catch((error) => {
  console.error('MongoDB connection error:', error);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    success: false, 
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Handle 404
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.originalUrl
  });
});

const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
