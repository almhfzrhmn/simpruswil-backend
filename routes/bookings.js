const express = require('express');
const Booking = require('../models/Booking');
const Room = require('../models/Room');
const { protect, authorize } = require('../middleware/auth');
const { 
  uploadDocument, 
  handleUploadError, 
  validateFileExists, 
  generateFileUrl, 
  deleteFile 
} = require('../middleware/upload');
const { sendBookingNotification } = require('../utils/email');

const router = express.Router();

// @desc    Create new booking
// @route   POST /api/bookings
// @access  Private
router.post('/', protect, uploadDocument, handleUploadError, generateFileUrl, async (req, res) => {
  try {
    const {
      roomId,
      activityName,
      startTime,
      purpose,
      endTime,
      participantsCount,
      contactPerson,
      equipment,
      notes
    } = req.body;

    // Validate required fields
    if (!roomId || !activityName || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: 'Room ID, nama kegiatan, waktu mulai, dan waktu selesai harus diisi'
      });
    }

    // Validate room exists and is active
    const room = await Room.findById(roomId);
    if (!room || !room.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Ruangan tidak ditemukan atau tidak aktif'
      });
    }

    // Parse dates
    const bookingStartTime = new Date(startTime);
    const bookingEndTime = new Date(endTime);

    // Validate dates
    if (isNaN(bookingStartTime.getTime()) || isNaN(bookingEndTime.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Format tanggal tidak valid'
      });
    }

    if (bookingEndTime <= bookingStartTime) {
      return res.status(400).json({
        success: false,
        message: 'Waktu selesai harus setelah waktu mulai'
      });
    }

    // Check if booking is in the past
    if (bookingStartTime < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Tidak dapat membuat booking untuk waktu yang sudah lewat'
      });
    }

    // Check for conflicts
    const conflictingBooking = await Booking.checkConflict(
      roomId,
      bookingStartTime,
      bookingEndTime
    );

    if (conflictingBooking) {
      return res.status(400).json({
        success: false,
        message: 'Ruangan sudah dibooking pada waktu tersebut',
        conflict: {
          activityName: conflictingBooking.activityName,
          startTime: conflictingBooking.startTime,
          endTime: conflictingBooking.endTime,
          bookedBy: conflictingBooking.userId.name
        }
      });
    }

    // Validate capacity
    if (participantsCount && participantsCount > room.capacity) {
      return res.status(400).json({
        success: false,
        message: `Jumlah peserta (${participantsCount}) melebihi kapasitas ruangan (${room.capacity})`
      });
    }

    // Check working hours
    const startHour = bookingStartTime.getHours();
    const endHour = bookingEndTime.getHours();
    const roomStartHour = room.operatingHours && room.operatingHours.start ? parseInt(room.operatingHours.start.split(':')[0]) : 8;
    const roomEndHour = room.operatingHours && room.operatingHours.end ? parseInt(room.operatingHours.end.split(':')[0]) : 17;

    if (startHour < roomStartHour || endHour > roomEndHour) {
      const startTimeStr = room.operatingHours && room.operatingHours.start ? room.operatingHours.start : '08:00';
      const endTimeStr = room.operatingHours && room.operatingHours.end ? room.operatingHours.end : '17:00';
      return res.status(400).json({
        success: false,
        message: `Ruangan hanya beroperasi dari ${startTimeStr} - ${endTimeStr}`
      });
    }

    // Create booking data
    const bookingData = {
      userId: req.user._id,
      roomId,
      purpose: purpose.trim(),
      activityName: activityName.trim(),
      startTime: bookingStartTime,
      endTime: bookingEndTime,
      documentPath: req.file ? req.file.path : undefined, // Optional document
      participantsCount: participantsCount ? parseInt(participantsCount) : 1,
      notes: notes ? notes.trim() : undefined
    };

    // Parse contact person if provided
    if (contactPerson) {
      try {
        bookingData.contactPerson = JSON.parse(contactPerson);
      } catch (error) {
        // Ignore parsing error for contact person
      }
    }

    // Parse equipment if provided
    if (equipment) {
      try {
        bookingData.equipment = JSON.parse(equipment);
      } catch (error) {
        bookingData.equipment = equipment.split(',').map(e => e.trim());
      }
    }

    const booking = await Booking.create(bookingData);

    // Populate the booking for response
    await booking.populate([
      { path: 'userId', select: 'name email originInstitution' },
      { path: 'roomId', select: 'roomName capacity location' }
    ]);

    res.status(201).json({
      success: true,
      message: 'Booking berhasil diajukan. Menunggu persetujuan admin.',
      data: {
        ...booking.toObject(),
        documentUrl: `${req.protocol}://${req.get('host')}/${booking.documentPath}`
      }
    });

  } catch (error) {
    console.error('Create booking error:', error);
    
    // Delete uploaded file if booking creation fails
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
      message: 'Server error saat membuat booking'
    });
  }
});

// @desc    Get user's bookings
// @route   GET /api/bookings/my-bookings
// @access  Private
router.get('/my-bookings', protect, async (req, res) => {
  try {
    const {
      status,
      page = 1,
      limit = 10,
      sortBy = 'startTime',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    const query = { userId: req.user._id };
    
    if (status) {
      query.status = status;
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Pagination
    const pageNumber = parseInt(page);
    const pageSize = parseInt(limit);
    const skip = (pageNumber - 1) * pageSize;

    // Execute query
    const bookings = await Booking.find(query)
      .sort(sort)
      .skip(skip)
      .limit(pageSize)
      .populate('roomId', 'roomName capacity location image');

    // Get total count
    const total = await Booking.countDocuments(query);

    // Add document URL to each booking
    const bookingsWithUrls = bookings.map(booking => ({
      ...booking.toObject(),
      documentUrl: `${req.protocol}://${req.get('host')}/${booking.documentPath}`,
      roomImageUrl: booking.roomId && booking.roomId.image ? `${req.protocol}://${req.get('host')}/${booking.roomId.image}` : null
    }));

    res.status(200).json({
      success: true,
      count: bookings.length,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        pages: Math.ceil(total / pageSize)
      },
      data: bookingsWithUrls
    });

  } catch (error) {
    console.error('Get my bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat mengambil data booking'
    });
  }
});

// @desc    Get single booking
// @route   GET /api/bookings/:id
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking tidak ditemukan'
      });
    }

    // Check if user owns this booking or is admin
    if (booking.userId._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Tidak memiliki akses ke booking ini'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        ...booking.toObject(),
        documentUrl: `${req.protocol}://${req.get('host')}/${booking.documentPath}`,
        roomImageUrl: booking.roomId && booking.roomId.image ? `${req.protocol}://${req.get('host')}/${booking.roomId.image}` : null
      }
    });

  } catch (error) {
    console.error('Get booking error:', error);
    
    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Booking tidak ditemukan'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error saat mengambil data booking'
    });
  }
});

// @desc    Update booking (only before approval and by owner)
// @route   PUT /api/bookings/:id
// @access  Private
router.put('/:id', protect, uploadDocument, handleUploadError, generateFileUrl, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking tidak ditemukan'
      });
    }

    // Check ownership
    if (booking.userId._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Tidak memiliki akses untuk mengedit booking ini'
      });
    }

    // Check if booking can be updated
    if (booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Hanya booking dengan status pending yang dapat diedit'
      });
    }

    // Check if booking time has passed
    if (booking.startTime < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Tidak dapat mengedit booking yang sudah lewat waktunya'
      });
    }

    const {
      activityName,
      purpose,
      startTime,
      endTime,
      participantsCount,
      contactPerson,
      equipment,
      notes
    } = req.body;

    // Build update data
    const updateData = {};
    
    if (activityName) updateData.activityName = activityName.trim();
    if (participantsCount) updateData.participantsCount = parseInt(participantsCount);
    if (notes !== undefined) updateData.notes = notes ? notes.trim() : undefined;

    // Handle document update
    if (req.file) {
      // Delete old document
      if (booking.documentPath) {
        deleteFile(booking.documentPath).catch(err => 
          console.error('Error deleting old document:', err)
        );
      }
      updateData.documentPath = req.file.path;
    }

    // Handle time updates
    if (startTime || endTime) {
      const newStartTime = startTime ? new Date(startTime) : booking.startTime;
      const newEndTime = endTime ? new Date(endTime) : booking.endTime;

      // Validate dates
      if (isNaN(newStartTime.getTime()) || isNaN(newEndTime.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Format tanggal tidak valid'
        });
      }

      if (newEndTime <= newStartTime) {
        return res.status(400).json({
          success: false,
          message: 'Waktu selesai harus setelah waktu mulai'
        });
      }

      if (newStartTime < new Date()) {
        return res.status(400).json({
          success: false,
          message: 'Tidak dapat mengatur waktu untuk masa lalu'
        });
      }

      // Check for conflicts (excluding current booking)
      const conflictingBooking = await Booking.checkConflict(
        booking.roomId,
        newStartTime,
        newEndTime,
        booking._id
      );

      if (conflictingBooking) {
        return res.status(400).json({
          success: false,
          message: 'Ruangan sudah dibooking pada waktu tersebut',
          conflict: {
            activityName: conflictingBooking.activityName,
            startTime: conflictingBooking.startTime,
            endTime: conflictingBooking.endTime
          }
        });
      }

      updateData.startTime = newStartTime;
      updateData.endTime = newEndTime;
    }

    // Parse contact person if provided
    if (contactPerson !== undefined) {
      try {
        updateData.contactPerson = JSON.parse(contactPerson);
      } catch (error) {
        // Ignore parsing error
      }
    }

    // Parse equipment if provided
    if (equipment !== undefined) {
      try {
        updateData.equipment = JSON.parse(equipment);
      } catch (error) {
        updateData.equipment = equipment.split(',').map(e => e.trim());
      }
    }

    const updatedBooking = await Booking.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true,
        runValidators: true
      }
    );

    res.status(200).json({
      success: true,
      message: 'Booking berhasil diupdate',
      data: {
        ...updatedBooking.toObject(),
        documentUrl: `${req.protocol}://${req.get('host')}/${updatedBooking.documentPath}`
      }
    });

  } catch (error) {
    console.error('Update booking error:', error);
    
    // Delete uploaded file if update fails
    if (req.file) {
      deleteFile(req.file.path).catch(err => 
        console.error('Error deleting file:', err)
      );
    }
    
    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Booking tidak ditemukan'
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
      message: 'Server error saat mengupdate booking'
    });
  }
});

// @desc    Cancel booking
// @route   PATCH /api/bookings/:id/cancel
// @access  Private
router.patch('/:id/cancel', protect, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking tidak ditemukan'
      });
    }

    // Check ownership
    if (booking.userId._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Tidak memiliki akses untuk membatalkan booking ini'
      });
    }

    // Check if booking can be cancelled
    if (booking.status === 'cancelled' || booking.status === 'rejected') {
      return res.status(400).json({
        success: false,
        message: 'Booking sudah dibatalkan atau ditolak'
      });
    }

    // Check if booking time has passed
    if (booking.startTime < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Tidak dapat membatalkan booking yang sudah dimulai'
      });
    }

    // Update status to cancelled
    await booking.updateStatus('cancelled', 'Dibatalkan oleh user', req.user._id);

    res.status(200).json({
      success: true,
      message: 'Booking berhasil dibatalkan',
      data: booking
    });

  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat membatalkan booking'
    });
  }
});

// @desc    Delete booking (only cancelled or rejected by owner)
// @route   DELETE /api/bookings/:id
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking tidak ditemukan'
      });
    }

    // Check ownership
    if (booking.userId._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Tidak memiliki akses untuk menghapus booking ini'
      });
    }

    // Check if booking can be deleted (cancelled, rejected, or completed)
    if (!['cancelled', 'rejected', 'completed'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: 'Hanya booking yang dibatalkan, ditolak, atau sudah selesai yang dapat dihapus'
      });
    }

    // Delete associated document file if exists
    if (booking.documentPath) {
      deleteFile(booking.documentPath).catch(err =>
        console.error('Error deleting document file:', err)
      );
    }

    // Delete the booking
    await Booking.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Booking berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat menghapus booking'
    });
  }
});

// @desc    Get all bookings (Admin only)
// @route   GET /api/bookings
// @access  Private/Admin
router.get('/', protect, authorize('admin'), async (req, res) => {
  try {
    const {
      search,
      status,
      roomId,
      userId,
      startDate,
      endDate,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Pagination
    const pageNumber = parseInt(page);
    const pageSize = parseInt(limit);
    const skip = (pageNumber - 1) * pageSize;

    // Build aggregation pipeline
    const pipeline = [];

    // Initial match conditions
    const matchConditions = {};

    if (status) {
      matchConditions.status = status;
    }

    if (roomId) {
      matchConditions.roomId = require('mongoose').Types.ObjectId(roomId);
    }

    if (userId) {
      matchConditions.userId = require('mongoose').Types.ObjectId(userId);
    }

    // Date range filter
    if (startDate || endDate) {
      matchConditions.startTime = {};
      if (startDate) {
        matchConditions.startTime.$gte = new Date(startDate);
      }
      if (endDate) {
        matchConditions.startTime.$lte = new Date(endDate);
      }
    }

    // Add initial match if there are conditions
    if (Object.keys(matchConditions).length > 0) {
      pipeline.push({ $match: matchConditions });
    }

    // Lookup users and rooms
    pipeline.push(
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'userId'
        }
      },
      {
        $lookup: {
          from: 'rooms',
          localField: 'roomId',
          foreignField: '_id',
          as: 'roomId'
        }
      },
      {
        $unwind: { path: '$userId', preserveNullAndEmptyArrays: true }
      },
      {
        $unwind: { path: '$roomId', preserveNullAndEmptyArrays: true }
      }
    );

    // Search filter - applied after lookups
    if (search) {
      pipeline.push({
        $match: {
          $or: [
            { activityName: { $regex: search, $options: 'i' } },
            { 'userId.name': { $regex: search, $options: 'i' } },
            { 'userId.email': { $regex: search, $options: 'i' } },
            { 'roomId.roomName': { $regex: search, $options: 'i' } },
            { purpose: { $regex: search, $options: 'i' } }
          ]
        }
      });
    }

    // Add projection to limit fields
    pipeline.push({
      $project: {
        activityName: 1,
        purpose: 1,
        startTime: 1,
        endTime: 1,
        status: 1,
        participantsCount: 1,
        notes: 1,
        documentPath: 1,
        createdAt: 1,
        updatedAt: 1,
        userId: {
          _id: 1,
          name: 1,
          email: 1,
          originInstitution: 1,
          phoneNumber: 1
        },
        roomId: {
          _id: 1,
          roomName: 1,
          capacity: 1,
          location: 1,
          image: 1
        }
      }
    });

    // Get total count for pagination
    const countPipeline = [...pipeline, { $count: "total" }];
    const countResult = await Booking.aggregate(countPipeline);
    const total = countResult.length > 0 ? countResult[0].total : 0;

    // Add sorting
    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'desc' ? -1 : 1;
    pipeline.push({ $sort: sortObj });

    // Add pagination
    pipeline.push({ $skip: skip }, { $limit: pageSize });

    // Execute aggregation
    const bookings = await Booking.aggregate(pipeline);

    // Add URLs to response
    const bookingsWithUrls = bookings.map(booking => ({
      ...booking,
      documentUrl: booking.documentPath ? `${req.protocol}://${req.get('host')}/${booking.documentPath}` : null,
      roomImageUrl: booking.roomId && booking.roomId.image ? `${req.protocol}://${req.get('host')}/${booking.roomId.image}` : null
    }));

    res.status(200).json({
      success: true,
      count: bookings.length,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        pages: Math.ceil(total / pageSize)
      },
      data: bookingsWithUrls
    });

  } catch (error) {
    console.error('Get all bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat mengambil data booking'
    });
  }
});

// @desc    Update booking status (Admin only)
// @route   PATCH /api/bookings/:id/status
// @access  Private/Admin
router.patch('/:id/status', protect, authorize('admin'), async (req, res) => {
  try {
    const { status, adminNote } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status harus disediakan'
      });
    }

    if (!['approved', 'rejected', 'completed'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status harus berupa approved, rejected, atau completed'
      });
    }

    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking tidak ditemukan'
      });
    }

    // Check if status update is valid based on current status
    if (status === 'completed' && booking.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Hanya booking dengan status approved yang dapat ditandai selesai'
      });
    } else if ((status === 'approved' || status === 'rejected') && booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Hanya booking dengan status pending yang dapat disetujui atau ditolak'
      });
    }

    // If approving, check for conflicts one more time
    if (status === 'approved') {
      const conflictingBooking = await Booking.checkConflict(
        booking.roomId,
        booking.startTime,
        booking.endTime,
        booking._id
      );

      if (conflictingBooking) {
        return res.status(400).json({
          success: false,
          message: 'Tidak dapat menyetujui booking karena ada konflik jadwal',
          conflict: {
            activityName: conflictingBooking.activityName,
            startTime: conflictingBooking.startTime,
            endTime: conflictingBooking.endTime
          }
        });
      }
    }

    // Update booking status
    await booking.updateStatus(status, adminNote || '', req.user._id);

    // Populate booking with user and room data for email notification
    await booking.populate([
      { path: 'userId', select: 'name email' },
      { path: 'roomId', select: 'roomName' }
    ]);

    // Send notification email
    try {
      await sendBookingNotification(booking, status);
    } catch (emailError) {
      console.error('Failed to send booking notification:', emailError);
      // Don't fail the request if email fails
    }

    res.status(200).json({
      success: true,
      message: `Booking berhasil ${status === 'approved' ? 'disetujui' : 'ditolak'}`,
      data: booking
    });

  } catch (error) {
    console.error('Update booking status error:', error);
    
    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Booking tidak ditemukan'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error saat mengupdate status booking'
    });
  }
});

// @desc    Get booking statistics (Admin only)
// @route   GET /api/bookings/stats
// @access  Private/Admin
router.get('/admin/stats', protect, authorize('admin'), async (req, res) => {
  try {
    const { period = 'month' } = req.query;

    // Calculate date range based on period
    let startDate, endDate;
    const now = new Date();

    switch (period) {
      case 'week':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        break;
      case 'year':
        startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    }

    endDate = now;

    // Optimized: Get all booking statistics in a single aggregation query
    const statsResult = await Booking.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Convert aggregation result to status counts
    const statusCounts = {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      cancelled: 0
    };

    statsResult.forEach(stat => {
      statusCounts[stat._id] = stat.count;
      statusCounts.total += stat.count;
    });

    // Get most booked rooms
    const mostBookedRooms = await Booking.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$roomId',
          count: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'rooms',
          localField: '_id',
          foreignField: '_id',
          as: 'room'
        }
      },
      {
        $unwind: '$room'
      },
      {
        $project: {
          roomName: '$room.roomName',
          count: 1
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 5
      }
    ]);

    // Get booking trends by day
    const bookingTrends = await Booking.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id': 1 }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        period,
        dateRange: {
          startDate,
          endDate
        },
        summary: {
          total: statusCounts.total,
          pending: statusCounts.pending,
          approved: statusCounts.approved,
          rejected: statusCounts.rejected,
          cancelled: statusCounts.cancelled,
          approvalRate: statusCounts.total > 0 ? ((statusCounts.approved / statusCounts.total) * 100).toFixed(1) : 0
        },
        mostBookedRooms,
        bookingTrends
      }
    });

  } catch (error) {
    console.error('Get booking stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat mengambil statistik booking'
    });
  }
});

// @desc    Delete booking (Admin only - can delete any booking)
// @route   DELETE /api/bookings/admin/:id
// @access  Private/Admin
router.delete('/admin/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking tidak ditemukan'
      });
    }

    // Delete associated document file if exists
    if (booking.documentPath) {
      deleteFile(booking.documentPath).catch(err =>
        console.error('Error deleting document file:', err)
      );
    }

    // Delete the booking
    await Booking.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Booking berhasil dihapus oleh admin'
    });

  } catch (error) {
    console.error('Admin delete booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat menghapus booking'
    });
  }
});

// @desc    Get upcoming bookings (Admin only)
// @route   GET /api/bookings/upcoming
// @access  Private/Admin
router.get('/admin/upcoming', protect, authorize('admin'), async (req, res) => {
  try {
    const { days = 7 } = req.query;

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + parseInt(days));

    const upcomingBookings = await Booking.find({
      status: 'approved',
      startTime: {
        $gte: startDate,
        $lte: endDate
      }
    })
    .populate('userId', 'name email originInstitution phoneNumber')
    .populate('roomId', 'roomName capacity location')
    .sort({ startTime: 1 });

    const bookingsWithUrls = upcomingBookings.map(booking => ({
      ...booking.toObject(),
      documentUrl: `${req.protocol}://${req.get('host')}/${booking.documentPath}`
    }));

    res.status(200).json({
      success: true,
      count: upcomingBookings.length,
      data: bookingsWithUrls
    });

  } catch (error) {
    console.error('Get upcoming bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat mengambil booking mendatang'
    });
  }
});

module.exports = router;