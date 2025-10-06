const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'User ID harus diisi']
  },
  roomId: {
    type: mongoose.Schema.ObjectId,
    ref: 'Room',
    required: [true, 'Room ID harus diisi']
  },
  activityName: {
    type: String,
    required: [true, 'Nama kegiatan harus diisi'],
    trim: true,
    maxlength: [200, 'Nama kegiatan tidak boleh lebih dari 200 karakter']
  },
  purpose: {
    type: String,
    required: [true, 'Tujuan Kegiatan Harus Diisi'],
    trim: true,
    maxlength: [500, 'Tujuan Kegiatan Max.500 Karakter'],
  },
  startTime: {
    type: Date,
    required: [true, 'Waktu mulai harus diisi']
  },
  endTime: {
    type: Date,
    required: [true, 'Waktu selesai harus diisi']
  },
  status: {
    type: String,
    required: true,
    enum: {
      values: ['pending', 'approved', 'rejected', 'cancelled', 'completed'],
      message: 'Status harus berupa pending, approved, rejected, cancelled, atau completed'
    },
    default: 'pending'
  },
  adminNote: {
    type: String,
    trim: true,
    maxlength: [500, 'Catatan admin tidak boleh lebih dari 500 karakter'],
    default: null
  },
  documentPath: {
    type: String,
    required: false,
    validate: {
      validator: function(v) {
        return !v || v.length > 0; // Allow empty/null values
      },
      message: 'Path dokumen tidak valid'
    }
  },
  // Additional fields for better tracking
  participantsCount: {
    type: Number,
    min: [1, 'Jumlah peserta minimal 1 orang'],
    default: 1
  },
  contactPerson: {
    name: {
      type: String,
      trim: true,
      maxlength: [100, 'Nama penanggung jawab tidak boleh lebih dari 100 karakter']
    },
    phone: {
      type: String,
      validate: {
        validator: function(v) {
          return !v || /^(\+62|62|0)8[1-9][0-9]{6,9}$/.test(v);
        },
        message: 'Format nomor telepon tidak valid'
      }
    }
  },
  equipment: [{
    type: String,
    trim: true
  }],
  notes: {
    type: String,
    trim: true,
    maxlength: [1000, 'Catatan tidak boleh lebih dari 1000 karakter']
  },
  // Timestamps for status changes
  statusHistory: [{
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled', 'completed']
    },
    changedAt: {
      type: Date,
      default: Date.now
    },
    changedBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    },
    note: {
      type: String,
      trim: true
    }
  }]
}, {
  timestamps: true
});

// Indexes for better performance
bookingSchema.index({ userId: 1 });
bookingSchema.index({ roomId: 1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ startTime: 1, endTime: 1 });
bookingSchema.index({ roomId: 1, startTime: 1, endTime: 1 }); // Compound index for conflict checking
bookingSchema.index({ createdAt: 1 }); // For date range queries
bookingSchema.index({ status: 1, createdAt: 1 }); // For status filtering with date ranges
bookingSchema.index({ userId: 1, status: 1 }); // For user bookings filtering
bookingSchema.index({ roomId: 1, status: 1, startTime: 1 }); // For room availability queries

// Virtual for duration in hours
bookingSchema.virtual('duration').get(function() {
  if (this.startTime && this.endTime) {
    return Math.ceil((this.endTime - this.startTime) / (1000 * 60 * 60));
  }
  return 0;
});

// Pre-save validation
bookingSchema.pre('save', function(next) {
  // Validate that endTime is after startTime
  if (this.startTime && this.endTime) {
    if (this.endTime <= this.startTime) {
      return next(new Error('Waktu selesai harus setelah waktu mulai'));
    }
    
    // Validate booking is not in the past (for new bookings)
    if (this.isNew && this.startTime < new Date()) {
      return next(new Error('Tidak dapat membuat booking untuk waktu yang sudah lewat'));
    }
    
    // Validate booking duration (max 12 hours for flexibility)
    const duration = (this.endTime - this.startTime) / (1000 * 60 * 60);
    if (duration > 12) {
      return next(new Error('Durasi peminjaman maksimal 12 jam'));
    }
  }
  
  next();
});

// Static method to check for conflicts
bookingSchema.statics.checkConflict = async function(roomId, startTime, endTime, excludeId = null) {
  const query = {
    roomId: roomId,
    status: { $in: ['pending', 'approved'] },
    $or: [
      {
        startTime: { $lt: endTime },
        endTime: { $gt: startTime }
      }
    ]
  };
  
  if (excludeId) {
    query._id = { $ne: excludeId };
  }
  
  const conflictingBooking = await this.findOne(query)
    .populate('userId', 'name email')
    .populate('roomId', 'roomName');
    
  return conflictingBooking;
};

// Static method to get bookings by date range
bookingSchema.statics.findByDateRange = function(startDate, endDate, roomId = null) {
  const query = {
    startTime: {
      $gte: startDate,
      $lte: endDate
    },
    status: { $in: ['pending', 'approved'] }
  };
  
  if (roomId) {
    query.roomId = roomId;
  }
  
  return this.find(query)
    .populate('userId', 'name email originInstitution')
    .populate('roomId', 'roomName capacity')
    .sort({ startTime: 1 });
};

// Instance method to update status with history
bookingSchema.methods.updateStatus = function(newStatus, adminNote = '', changedBy = null) {
  // Add to status history
  this.statusHistory.push({
    status: newStatus,
    changedAt: new Date(),
    changedBy: changedBy,
    note: adminNote
  });
  
  // Update current status
  this.status = newStatus;
  if (adminNote) {
    this.adminNote = adminNote;
  }
  
  return this.save();
};

// Pre-populate middleware removed to avoid conflicts
// Populate is done explicitly in routes

module.exports = mongoose.model('Booking', bookingSchema);