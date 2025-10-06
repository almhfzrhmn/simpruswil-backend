const express = require('express');
const Room = require('../models/Room');
const Booking = require('../models/Booking');
const { protect, authorize, optionalAuth } = require('../middleware/auth');
const { 
  uploadRoomImage, 
  handleUploadError, 
  generateFileUrl, 
  deleteFile 
} = require('../middleware/upload');

const router = express.Router();

// @desc    Get all rooms
// @route   GET /api/rooms
// @access  Public
router.get('/', optionalAuth, async (req, res) => {
  try {
    const {
      search,
      capacity,
      sortBy = 'roomName',
      sortOrder = 'asc',
      page = 1,
      limit = 10,
      includeInactive = false
    } = req.query;

    // Build query
    const query = {};
    
    // Only show active rooms for non-admin users
    if (!includeInactive || (req.user && req.user.role !== 'admin')) {
      query.isActive = true;
    }

    // Search by room name or description
    if (search) {
      query.$or = [
        { roomName: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { location: { $regex: search, $options: 'i' } }
      ];
    }

    // Filter by minimum capacity
    if (capacity) {
      query.capacity = { $gte: parseInt(capacity) };
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Pagination
    const pageNumber = parseInt(page);
    const pageSize = parseInt(limit);
    const skip = (pageNumber - 1) * pageSize;

    // Execute query
    const rooms = await Room.find(query)
      .sort(sort)
      .skip(skip)
      .limit(pageSize);

    // Get total count for pagination
    const total = await Room.countDocuments(query);

    // Add booking availability info for each room
    const roomsWithAvailability = await Promise.all(
      rooms.map(async (room) => {
        const roomObj = room.toObject();
        
        // Get upcoming bookings for this room
        const upcomingBookings = await Booking.find({
          roomId: room._id,
          status: { $in: ['pending', 'approved'] },
          startTime: { $gte: new Date() }
        })
        .select('startTime endTime activityName status')
        .sort({ startTime: 1 })
        .limit(5);

        roomObj.upcomingBookings = upcomingBookings;
        roomObj.imageUrl = room.image ? `${req.protocol}://${req.get('host')}/${room.image}` : null;
        
        return roomObj;
      })
    );

    res.status(200).json({
      success: true,
      count: rooms.length,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        pages: Math.ceil(total / pageSize)
      },
      data: roomsWithAvailability
    });

  } catch (error) {
    console.error('Get rooms error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat mengambil data ruangan'
    });
  }
});

// @desc    Get single room
// @route   GET /api/rooms/:id
// @access  Public
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Ruangan tidak ditemukan'
      });
    }

    // Check if room is active (unless user is admin)
    if (!room.isActive && (!req.user || req.user.role !== 'admin')) {
      return res.status(404).json({
        success: false,
        message: 'Ruangan tidak tersedia'
      });
    }

    // Get room bookings for the next 30 days
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const bookings = await Booking.find({
      roomId: room._id,
      status: { $in: ['pending', 'approved'] },
      startTime: {
        $gte: new Date(),
        $lte: thirtyDaysFromNow
      }
    })
    .select('startTime endTime activityName status userId')
    .populate('userId', 'name originInstitution')
    .sort({ startTime: 1 });

    const roomObj = room.toObject();
    roomObj.bookings = bookings;
    roomObj.imageUrl = room.image ? `${req.protocol}://${req.get('host')}/${room.image}` : null;

    res.status(200).json({
      success: true,
      data: roomObj
    });

  } catch (error) {
    console.error('Get room error:', error);
    
    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Ruangan tidak ditemukan'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error saat mengambil data ruangan'
    });
  }
});

// @desc    Check room availability
// @route   POST /api/rooms/:id/check-availability
// @access  Public
router.post('/:id/check-availability', async (req, res) => {
  try {
    const { startTime, endTime } = req.body;

    if (!startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: 'Waktu mulai dan selesai harus disediakan'
      });
    }

    const room = await Room.findById(req.params.id);
    if (!room || !room.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Ruangan tidak ditemukan atau tidak aktif'
      });
    }

    // Check for conflicting bookings
    const conflictingBooking = await Booking.checkConflict(
      req.params.id,
      new Date(startTime),
      new Date(endTime)
    );

    if (conflictingBooking) {
      return res.status(200).json({
        success: true,
        available: false,
        message: 'Ruangan tidak tersedia pada waktu tersebut',
        conflictingBooking: {
          activityName: conflictingBooking.activityName,
          startTime: conflictingBooking.startTime,
          endTime: conflictingBooking.endTime,
          status: conflictingBooking.status
        }
      });
    }

    res.status(200).json({
      success: true,
      available: true,
      message: 'Ruangan tersedia pada waktu tersebut'
    });

  } catch (error) {
    console.error('Check availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat mengecek ketersediaan'
    });
  }
});

// @desc    Get room availability calendar
// @route   GET /api/rooms/:id/calendar
// @access  Public
router.get('/:id/calendar', async (req, res) => {
  try {
    const { month, year } = req.query;
    
    // Default to current month if not provided
    const currentDate = new Date();
    const targetMonth = month ? parseInt(month) - 1 : currentDate.getMonth(); // month is 0-indexed
    const targetYear = year ? parseInt(year) : currentDate.getFullYear();

    // Get first and last day of the month
    const startDate = new Date(targetYear, targetMonth, 1);
    const endDate = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59);

    const room = await Room.findById(req.params.id);
    if (!room || !room.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Ruangan tidak ditemukan atau tidak aktif'
      });
    }

    // Get all bookings for the month
    const bookings = await Booking.find({
      roomId: req.params.id,
      status: { $in: ['pending', 'approved'] },
      startTime: {
        $gte: startDate,
        $lte: endDate
      }
    })
    .select('startTime endTime activityName status')
    .sort({ startTime: 1 });

    // Create calendar data
    const calendar = [];
    const daysInMonth = endDate.getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const dayDate = new Date(targetYear, targetMonth, day);
      const dayBookings = bookings.filter(booking => {
        const bookingDate = new Date(booking.startTime);
        return bookingDate.getDate() === day;
      });

      calendar.push({
        date: dayDate,
        day: day,
        hasBookings: dayBookings.length > 0,
        bookings: dayBookings.map(booking => ({
          startTime: booking.startTime,
          endTime: booking.endTime,
          activityName: booking.activityName,
          status: booking.status
        }))
      });
    }

    res.status(200).json({
      success: true,
      data: {
        room: {
          id: room._id,
          name: room.roomName,
          capacity: room.capacity
        },
        month: targetMonth + 1,
        year: targetYear,
        calendar
      }
    });

  } catch (error) {
    console.error('Get calendar error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat mengambil kalender ruangan'
    });
  }
});

// Admin only routes below
// @desc    Create new room
// @route   POST /api/rooms
// @access  Private/Admin
router.post('/', protect, authorize('admin'), uploadRoomImage, handleUploadError, generateFileUrl, async (req, res) => {
  try {
    const {
      roomName,
      description,
      capacity,
      facilities,
      location,
      operatingHours
    } = req.body;

    // Validate required fields
    if (!roomName || !description || !capacity) {
      return res.status(400).json({
        success: false,
        message: 'Nama ruangan, deskripsi, dan kapasitas harus diisi'
      });
    }

    // Check if room name already exists
const existingRoom = await Room.findOne({ 
  roomName: { $regex: new RegExp(`^${roomName}$`, 'i') }
});

if (existingRoom) {
  return res.status(400).json({
    success: false,
    message: 'Nama ruangan sudah digunakan'
  });
}

    // Create room data
    const roomData = {
      roomName: roomName.trim(),
      description: description.trim(),
      capacity: parseInt(capacity),
      image: req.file ? req.file.path : null,
      location: location ? location.trim() : undefined
    };

    // Parse facilities if provided
    if (facilities) {
      try {
        roomData.facilities = JSON.parse(facilities);
      } catch (error) {
        roomData.facilities = facilities.split(',').map(f => f.trim());
      }
    }

    // Parse operating hours if provided
    if (operatingHours) {
      try {
        roomData.operatingHours = JSON.parse(operatingHours);
      } catch (error) {
        // Keep default operating hours
      }
    }

    const room = await Room.create(roomData);

    // Add image URL to response
    const roomObj = room.toObject();
    roomObj.imageUrl = room.image ? `${req.protocol}://${req.get('host')}/${room.image}` : null;

    res.status(201).json({
      success: true,
      message: 'Ruangan berhasil dibuat',
      data: roomObj
    });

  } catch (error) {
    console.error('Create room error:', error);
    
    // Delete uploaded file if room creation fails
    if (req.file) {
      deleteFile(req.file.path).catch(err => 
        console.error('Error deleting file:', err)
      );
    }
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error saat membuat ruangan'
    });
  }
});

// @desc    Update room
// @route   PUT /api/rooms/:id
// @access  Private/Admin
router.put('/:id', protect, authorize('admin'), uploadRoomImage, handleUploadError, generateFileUrl, async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Ruangan tidak ditemukan'
      });
    }

    const {
      roomName,
      description,
      capacity,
      facilities,
      location,
      operatingHours,
      isActive
    } = req.body;

    // Build update object
    const updateData = {};
    
    if (roomName) updateData.roomName = roomName.trim();
    if (description) updateData.description = description.trim();
    if (capacity) updateData.capacity = parseInt(capacity);
    if (location !== undefined) updateData.location = location ? location.trim() : '';
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);

    // Handle image update
    if (req.file) {
      // Delete old image if exists
      if (room.image) {
        deleteFile(room.image).catch(err => 
          console.error('Error deleting old image:', err)
        );
      }
      updateData.image = req.file.path;
    }

    // Parse facilities if provided
    if (facilities !== undefined) {
      try {
        updateData.facilities = JSON.parse(facilities);
      } catch (error) {
        updateData.facilities = facilities.split(',').map(f => f.trim());
      }
    }

    // Parse operating hours if provided
    if (operatingHours !== undefined) {
      try {
        updateData.operatingHours = JSON.parse(operatingHours);
      } catch (error) {
    // Keep existing operating hours
  }
}

// Check if room name is unique (excluding current room)
if (roomName && roomName !== room.roomName) {
  const existingRoom = await Room.findOne({ 
    roomName: { $regex: new RegExp(`^${roomName}$`, 'i') },
    _id: { $ne: req.params.id }
  });

  if (existingRoom) {
    return res.status(400).json({
      success: false,
      message: 'Nama ruangan sudah digunakan'
    });
  }
}

const updatedRoom = await Room.findByIdAndUpdate(
  req.params.id,
  updateData,
  {
    new: true,
    runValidators: true
  }
);

    // Add image URL to response
    const roomObj = updatedRoom.toObject();
    roomObj.imageUrl = updatedRoom.image ? `${req.protocol}://${req.get('host')}/${updatedRoom.image}` : null;

    res.status(200).json({
      success: true,
      message: 'Ruangan berhasil diupdate',
      data: roomObj
    });

  } catch (error) {
    console.error('Update room error:', error);
    
    // Delete uploaded file if update fails
    if (req.file) {
      deleteFile(req.file.path).catch(err => 
        console.error('Error deleting file:', err)
      );
    }
    
    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Ruangan tidak ditemukan'
      });
    }
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error saat mengupdate ruangan'
    });
  }
});

// @desc    Delete room
// @route   DELETE /api/rooms/:id
// @access  Private/Admin
router.delete('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Ruangan tidak ditemukan'
      });
    }

    // Cancel all future bookings for this room
    await Booking.updateMany(
      {
        roomId: req.params.id,
        status: { $in: ['pending', 'approved'] },
        startTime: { $gte: new Date() }
      },
      {
        $set: { status: 'cancelled' },
        $push: {
          statusHistory: {
            status: 'cancelled',
            changedAt: new Date(),
            changedBy: req.user._id,
            note: 'Ruangan dihapus oleh admin'
          }
        }
      }
    );

    // Delete room image if exists
    if (room.image) {
      deleteFile(room.image).catch(err =>
        console.error('Error deleting room image:', err)
      );
    }

    await Room.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Ruangan berhasil dihapus dan semua booking terkait dibatalkan'
    });

  } catch (error) {
    console.error('Delete room error:', error);

    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Ruangan tidak ditemukan'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error saat menghapus ruangan'
    });
  }
});

// @desc    Toggle room status (activate/deactivate)
// @route   PATCH /api/rooms/:id/toggle-status
// @access  Private/Admin
router.patch('/:id/toggle-status', protect, authorize('admin'), async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Ruangan tidak ditemukan'
      });
    }

    room.isActive = !room.isActive;
    await room.save();

    res.status(200).json({
      success: true,
      message: `Ruangan berhasil ${room.isActive ? 'diaktifkan' : 'dinonaktifkan'}`,
      data: {
        id: room._id,
        roomName: room.roomName,
        isActive: room.isActive
      }
    });

  } catch (error) {
    console.error('Toggle room status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat mengubah status ruangan'
    });
  }
});


module.exports = router;