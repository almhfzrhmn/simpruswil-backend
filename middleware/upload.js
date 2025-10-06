const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create uploads directory if it doesn't exist
const createUploadDirs = () => {
  const dirs = ['uploads', 'uploads/documents', 'uploads/rooms', 'uploads/temp'];
  
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  });
};

// Initialize upload directories
createUploadDirs();

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = 'uploads/';
    
    // Determine upload path based on file type or route
    if (req.route.path.includes('document') || file.fieldname === 'document') {
      uploadPath += 'documents/';
    } else if (req.route.path.includes('room') || file.fieldname === 'image') {
      uploadPath += 'rooms/';
    } else {
      uploadPath += 'temp/';
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const basename = path.basename(file.originalname, ext);
    
    // Sanitize filename
    const sanitizedBasename = basename.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${sanitizedBasename}_${uniqueSuffix}${ext}`;
    
    cb(null, filename);
  }
});

// File filter function
const fileFilter = (req, file, cb) => {
  // Define allowed file types based on field name
  const allowedTypes = {
    document: {
      mimeTypes: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg',
        'image/png'
      ],
      extensions: ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png']
    },
    image: {
      mimeTypes: [
        'image/jpeg',
        'image/png',
        'image/webp'
      ],
      extensions: ['.jpg', '.jpeg', '.png', '.webp']
    }
  };

  const fieldType = file.fieldname === 'document' ? 'document' : 'image';
  const allowedMimes = allowedTypes[fieldType].mimeTypes;
  const allowedExts = allowedTypes[fieldType].extensions;
  
  const ext = path.extname(file.originalname).toLowerCase();
  
  // Check mime type and extension
  if (allowedMimes.includes(file.mimetype) && allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    const error = new Error(`File type tidak diizinkan. Hanya mendukung: ${allowedExts.join(', ')}`);
    error.code = 'INVALID_FILE_TYPE';
    cb(error, false);
  }
};

// Multer configuration
const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024, // 5MB default
    files: 1 // Only one file per request
  },
  fileFilter: fileFilter
});

// Middleware for handling upload errors
const handleUploadError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    let message = 'Upload error';
    
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        message = 'File terlalu besar. Maksimal 5MB.';
        break;
      case 'LIMIT_FILE_COUNT':
        message = 'Terlalu banyak file. Hanya boleh satu file.';
        break;
      case 'LIMIT_UNEXPECTED_FILE':
        message = 'Field name tidak valid untuk upload file.';
        break;
      default:
        message = `Upload error: ${error.message}`;
    }
    
    return res.status(400).json({
      success: false,
      message: message
    });
  }
  
  if (error && error.code === 'INVALID_FILE_TYPE') {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
  
  next(error);
};

// Middleware to clean up uploaded file on error
const cleanupOnError = (req, res, next) => {
  const originalSend = res.send;
  
  res.send = function(data) {
    // If response is an error and file was uploaded, clean it up
    if (res.statusCode >= 400 && req.file) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('Error deleting file:', err);
      });
    }
    
    originalSend.call(this, data);
  };
  
  next();
};

// Specific upload configurations
const uploadDocument = upload.single('document');
const uploadRoomImage = upload.single('image');

// Utility function to delete file
const deleteFile = (filepath) => {
  return new Promise((resolve, reject) => {
    if (!filepath) {
      return resolve();
    }
    
    fs.unlink(filepath, (err) => {
      if (err && err.code !== 'ENOENT') {
        console.error('Error deleting file:', err);
        return reject(err);
      }
      resolve();
    });
  });
};

// Middleware to validate file existence
const validateFileExists = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'File harus diupload'
    });
  }
  next();
};

// Middleware to generate file URL
const generateFileUrl = (req, res, next) => {
  if (req.file) {
    // Generate URL that can be accessed publicly
    req.file.url = `${req.protocol}://${req.get('host')}/${req.file.path}`;
  }
  next();
};

module.exports = {
  upload,
  uploadDocument,
  uploadRoomImage,
  handleUploadError,
  cleanupOnError,
  validateFileExists,
  generateFileUrl,
  deleteFile
};