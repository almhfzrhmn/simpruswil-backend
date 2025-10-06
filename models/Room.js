  // models/room.js

  const mongoose = require('mongoose');

  const roomSchema = new mongoose.Schema({
    roomName: {
      type: String,
      required: [true, 'Nama ruangan harus diisi'],
      trim: true,
      unique: true,
      maxlength: [100, 'Nama   ruangan tidak boleh lebih dari 100 karakter']
    },
    description: {
      type: String,
      required: [true, 'Deskripsi ruangan harus diisi'],
      trim: true,
      maxlength: [500, 'Deskripsi tidak boleh lebih dari 500 karakter']
    },
    capacity: {
      type: Number,
      required: [true, 'Kapasitas ruangan harus diisi'],
      min: [1, 'Kapasitas minimal 1 orang'],
      max: [1000, 'Kapasitas maksimal 1000 orang']
    },
    image: {
      type: String,
      default: null // Path to uploaded image file
    },
    facilities: [{
      type: String,
      trim: true
    }],
    isActive: {
      type: Boolean,
      default: true
    },
    location: {
      type: String,
      trim: true,
      maxlength: [200, 'Lokasi tidak boleh lebih dari 200 karakter']
    },
    operatingHours: {
      start: {
        type: String,
        default: '08:00',
        validate: {
          validator: function(v) {
            return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
          },
          message: 'Format jam operasional tidak valid (HH:MM)'
        }
      },
      end: {
        type: String,
        default: '17:00',
        validate: {
          validator: function(v) {
            return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
          },
          message: 'Format jam operasional tidak valid (HH:MM)'
        }
      }
    }
  }, {
    timestamps: true
  });

  // Index for better performance
  roomSchema.index({ isActive: 1 });

  // Virtual for getting bookings count
  roomSchema.virtual('bookingsCount', {
    ref: 'Booking',
    localField: '_id',
    foreignField: 'roomId',
    count: true
  });

  // Static method to find available rooms
  roomSchema.statics.findAvailable = function() {
    return this.find({ isActive: true }).sort({ roomName: 1 });
  };

  // Instance method to check if room is available at specific time
  roomSchema.methods.isAvailableAt = async function(startTime, endTime, excludeBookingId = null) {
    const Booking = mongoose.model('Booking');
    
    const query = {
      roomId: this._id,
      status: { $in: ['pending', 'approved'] },
      $or: [
        {
          startTime: { $lt: endTime },
          endTime: { $gt: startTime }
        }
      ]
    };
    
    // Exclude specific booking (for updates)
    if (excludeBookingId) {
      query._id = { $ne: excludeBookingId };
    }
    
    const conflictingBooking = await Booking.findOne(query);
    return !conflictingBooking;
  };

  // Pre-save middleware to ensure end time is after start time
  roomSchema.pre('save', function(next) {
    if (this.operatingHours && this.operatingHours.start && this.operatingHours.end) {
      const startTime = this.operatingHours.start.split(':');
      const endTime = this.operatingHours.end.split(':');
      
      const startMinutes = parseInt(startTime[0]) * 60 + parseInt(startTime[1]);
      const endMinutes = parseInt(endTime[0]) * 60 + parseInt(endTime[1]);
      
      if (startMinutes >= endMinutes) {
        return next(new Error('Jam selesai operasional harus setelah jam mulai'));
      }
    }
    next();
  });

  module.exports = mongoose.model('Room', roomSchema);