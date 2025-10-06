const mongoose = require('mongoose');

const libraryTourSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'User ID harus diisi']
  },
  groupName: {
    type: String,
    required: [true, 'Nama kelompok/instansi harus diisi'],
    trim: true,
    maxlength: [200, 'Nama kelompok tidak boleh lebih dari 200 karakter']
  },
  numberOfParticipants: {
    type: Number,
    required: [true, 'Jumlah peserta harus diisi'],
    min: [1, 'Jumlah peserta minimal 1 orang']
  },
  tourDate: {
    type: Date,
    required: [true, 'Tanggal tur harus diisi']
  },
  startTime: {
    type: Date,
    required: [true, 'Waktu mulai tur harus diisi']
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
  // Additional tour details
  tourType: {
    type: String,
    enum: {
      values: ['general', 'academic', 'research', 'special'],
      message: 'Jenis tur tidak valid'
    },
    default: 'general'
  },
  duration: {
    type: Number,
    default: 60, // Default 60 minutes
    min: [30, 'Durasi tur minimal 30 menit'],
    max: [180, 'Durasi tur maksimal 180 menit']
  },
  contactPerson: {
    name: {
      type: String,
      required: [true, 'Nama penanggung jawab harus diisi'],
      trim: true,
      maxlength: [100, 'Nama penanggung jawab tidak boleh lebih dari 100 karakter']
    },
    phone: {
      type: String,
      required: [true, 'Nomor telepon penanggung jawab harus diisi'],
      validate: {
        validator: function(v) {
          return /^(\+62|62|0)8[1-9][0-9]{6,9}$/.test(v);
        },
        message: 'Format nomor telepon tidak valid'
      }
    },
    email: {
      type: String,
      validate: {
        validator: function(v) {
          return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        },
        message: 'Format email tidak valid'
      }
    }
  },
  specialRequests: {
    type: String,
    trim: true,
    maxlength: [1000, 'Permintaan khusus tidak boleh lebih dari 1000 karakter']
  },
  // Age group for educational tours
  ageGroup: {
    type: String,
    enum: {
      values: ['children', 'teenagers', 'adults', 'seniors', 'mixed'],
      message: 'Kelompok usia tidak valid'
    },
    default: 'mixed'
  },
  // Language preference
  language: {
    type: String,
    enum: {
      values: ['indonesia', 'english', 'acehnese'],
      message: 'Pilihan bahasa tidak valid'
    },
    default: 'indonesia'
  },
  // Status history for tracking changes
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
  }],
  // Assigned guide
  assignedGuide: {
    type: String,
    trim: true,
    maxlength: [100, 'Nama pemandu tidak boleh lebih dari 100 karakter']
  }
}, {
  timestamps: true
});

// Indexes for better performance
libraryTourSchema.index({ userId: 1 });
libraryTourSchema.index({ status: 1 });
libraryTourSchema.index({ tourDate: 1, startTime: 1 });
libraryTourSchema.index({ tourDate: 1, startTime: 1, status: 1 }); // Compound index for conflict checking

// Virtual for end time calculation
libraryTourSchema.virtual('endTime').get(function() {
  if (this.startTime && this.duration) {
    return new Date(this.startTime.getTime() + (this.duration * 60 * 1000));
  }
  return null;
});

// Pre-save validation
libraryTourSchema.pre('save', function(next) {
  // Validate that tour date and time is not in the past (for new tours)
  if (this.isNew && this.startTime < new Date()) {
    return next(new Error('Tidak dapat membuat jadwal tur untuk waktu yang sudah lewat'));
  }
  
  // Validate that tour is within working hours (8 AM - 5 PM)
  const startHour = this.startTime.getHours();
  if (startHour < 8 || startHour >= 17) {
    return next(new Error('Tur hanya dapat dijadwalkan antara jam 08:00 - 17:00'));
  }
  
  // Validate that end time doesn't exceed working hours
  const endTime = new Date(this.startTime.getTime() + (this.duration * 60 * 1000));
  if (endTime.getHours() >= 17) {
    return next(new Error('Waktu tur tidak boleh melewati jam 17:00'));
  }
  
  next();
});

// Static method to check for conflicts
libraryTourSchema.statics.checkConflict = async function(tourDate, startTime, duration = 60, excludeId = null) {
  const endTime = new Date(startTime.getTime() + (duration * 60 * 1000));

  const query = {
    tourDate: {
      $gte: new Date(tourDate.getFullYear(), tourDate.getMonth(), tourDate.getDate()),
      $lt: new Date(tourDate.getFullYear(), tourDate.getMonth(), tourDate.getDate() + 1)
    },
    status: { $in: ['pending', 'approved'] },
    $or: [
      {
        startTime: { $lt: endTime },
        $expr: {
          $gt: [
            { $add: ['$startTime', { $multiply: ['$duration', 60000] }] },
            startTime
          ]
        }
      }
    ]
  };

  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  return this.findOne(query);
};

// Static method to get available slots for a date
libraryTourSchema.statics.getAvailableSlots = async function(targetDate) {
  try {
    // Create date range for the target date
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(8, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setHours(17, 0, 0, 0);

    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(0, 0, 0, 0);

    // Get all approved tours for the date
    const tours = await this.find({
      tourDate: {
        $gte: new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()),
        $lt: new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() + 1)
      },
      status: 'approved'
    }).sort({ startTime: 1 });

    const availableSlots = [];
    let currentTime = new Date(startOfDay);

    while (currentTime < endOfDay) {
      const slotEndTime = new Date(currentTime.getTime() + 60 * 60 * 1000); // 1 hour slots

      // Check if this slot conflicts with any approved tours
      const hasConflict = tours.some(tour => {
        const tourEndTime = new Date(tour.startTime.getTime() + tour.duration * 60 * 1000);
        return (
          (tour.startTime < slotEndTime && tourEndTime > currentTime)
        );
      });

      if (!hasConflict) {
        availableSlots.push({
          startTime: new Date(currentTime),
          endTime: new Date(slotEndTime),
          duration: 60
        });
      }

      currentTime = new Date(currentTime.getTime() + 60 * 60 * 1000); // Move to next hour
    }

    return availableSlots;
  } catch (error) {
    console.error('Error in getAvailableSlots:', error);
    throw error;
  }
};

// Static method to find tours by date range
libraryTourSchema.statics.findByDateRange = async function(startDate, endDate) {
  return this.find({
    tourDate: {
      $gte: startDate,
      $lte: endDate
    }
  }).populate('userId', 'name email originInstitution');
};

// Instance method to update status
libraryTourSchema.methods.updateStatus = async function(newStatus, adminNote = '', adminId = null) {
  this.status = newStatus;
  this.adminNote = adminNote;

  // Add to status history
  this.statusHistory.push({
    status: newStatus,
    changedBy: adminId,
    note: adminNote
  });

  return this.save();
};

module.exports = mongoose.model('LibraryTour', libraryTourSchema);