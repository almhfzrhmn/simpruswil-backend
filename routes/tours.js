// routes/tours.js - Library tour management routes
const express = require('express');
const LibraryTour = require('../models/LibraryTour');
const { protect, authorize } = require('../middleware/auth');
const {
  uploadDocument,
  handleUploadError,
  generateFileUrl,
  deleteFile
} = require('../middleware/upload');
const { sendTourNotification } = require('../utils/email');

const router = express.Router();

// @desc    Create new tour request
// @route   POST /api/tours
// @access  Private
router.post('/', protect, uploadDocument, handleUploadError, generateFileUrl, async (req, res) => {
  try {
    const {
      groupName,
      numberOfParticipants,
      tourDate,
      startTime,
      tourType = 'general',
      duration = 60,
      contactPerson,
      specialRequests,
      ageGroup = 'mixed',
      language = 'indonesia'
    } = req.body;

    // Validate required fields
    if (!groupName || !numberOfParticipants || !tourDate || !startTime || !contactPerson) {
      return res.status(400).json({
        success: false,
        message: 'Semua field yang diperlukan harus diisi'
      });
    }

    // Parse and validate contact person
    let parsedContactPerson;
    try {
      parsedContactPerson = typeof contactPerson === 'string' ? JSON.parse(contactPerson) : contactPerson;
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Format data penanggung jawab tidak valid'
      });
    }

    if (!parsedContactPerson.name || !parsedContactPerson.phone) {
      return res.status(400).json({
        success: false,
        message: 'Nama dan nomor telepon penanggung jawab harus diisi'
      });
    }

    // Parse dates - ensure we handle timezone correctly
    // Create date in local timezone to avoid UTC conversion issues
    const [year, month, day] = tourDate.split('-').map(Number);
    const [hours, minutes] = startTime.split(':').map(Number);

    // Create date object in local timezone
    const tourDateTime = new Date(year, month - 1, day, hours, minutes);

    // Validate date
    if (isNaN(tourDateTime.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Format tanggal atau waktu tidak valid'
      });
    }

    // Check if tour date is in the future
    if (tourDateTime < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Tidak dapat membuat jadwal tur untuk waktu yang sudah lewat'
      });
    }

    // Validate participants count
    const participantsCount = parseInt(numberOfParticipants);
    if (participantsCount < 1) {
      return res.status(400).json({
        success: false,
        message: 'Jumlah peserta minimal 1 orang'
      });
    }

    // Validate duration
    const tourDuration = parseInt(duration);
    if (tourDuration < 30 || tourDuration > 180) {
      return res.status(400).json({
        success: false,
        message: 'Durasi tur harus antara 30-180 menit'
      });
    }

    // Check for conflicts
    const conflictingTour = await LibraryTour.checkConflict(
      new Date(tourDate),
      tourDateTime,
      tourDuration
    );

    if (conflictingTour) {
      return res.status(400).json({
        success: false,
        message: 'Jadwal tur bentrok dengan tur lain yang sudah dijadwalkan',
        conflict: {
          groupName: conflictingTour.groupName,
          tourDate: conflictingTour.tourDate,
          startTime: conflictingTour.startTime
        }
      });
    }

    // Create tour data - store tourDate as date-only (no time) to avoid timezone issues
    const tourDateOnly = new Date(year, month - 1, day); // Year, month (0-based), day

    const tourData = {
      userId: req.user._id,
      groupName: groupName.trim(),
      numberOfParticipants: participantsCount,
      tourDate: tourDateOnly,
      startTime: tourDateTime,
      tourType,
      duration: tourDuration,
      contactPerson: parsedContactPerson,
      specialRequests: specialRequests ? specialRequests.trim() : undefined,
      ageGroup,
      language,
      documentPath: req.file ? req.file.path : undefined
    };

    const tour = await LibraryTour.create(tourData);

    // Populate the tour for response
    await tour.populate('userId', 'name email originInstitution');

    res.status(201).json({
      success: true,
      message: 'Pengajuan tur perpustakaan berhasil diajukan. Menunggu persetujuan admin.',
      data: {
        ...tour.toObject(),
        documentUrl: req.file ? `${req.protocol}://${req.get('host')}/${tour.documentPath}` : null
      }
    });

  } catch (error) {
    console.error('Create tour error:', error);
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error saat membuat pengajuan tur'
    });
  }
});

// @desc    Get user's tours
// @route   GET /api/tours/my-tours
// @access  Private
router.get('/my-tours', protect, async (req, res) => {
  try {
    const {
      status,
      page = 1,
      limit = 10,
      sortBy = 'tourDate',
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
    const tours = await LibraryTour.find(query)
      .sort(sort)
      .skip(skip)
      .limit(pageSize);

    // Get total count
    const total = await LibraryTour.countDocuments(query);

    res.status(200).json({
      success: true,
      count: tours.length,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        pages: Math.ceil(total / pageSize)
      },
      data: tours
    });

  } catch (error) {
    console.error('Get my tours error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat mengambil data tur'
    });
  }
});

// @desc    Get available tour slots for a date
// @route   GET /api/tours/available-slots
// @access  Public
router.get('/available-slots', async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Tanggal harus disediakan'
      });
    }

    const targetDate = new Date(date);

    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Format tanggal tidak valid'
      });
    }

    // Check if date is in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    targetDate.setHours(0, 0, 0, 0);

    if (targetDate < today) {
      return res.status(400).json({
        success: false,
        message: 'Tidak dapat mencari slot untuk tanggal yang sudah lewat'
      });
    }

    const availableSlots = await LibraryTour.getAvailableSlots(targetDate);

    res.status(200).json({
      success: true,
      data: {
        date: targetDate,
        availableSlots
      }
    });

  } catch (error) {
    console.error('Get available slots error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat mengambil slot tersedia'
    });
  }
});

// @desc    Get tour calendar
// @route   GET /api/tours/calendar
// @access  Public
router.get('/calendar', async (req, res) => {
  try {
    const { month, year } = req.query;

    // Default to current month if not provided
    const currentDate = new Date();
    const targetMonth = month ? parseInt(month) - 1 : currentDate.getMonth();
    const targetYear = year ? parseInt(year) : currentDate.getFullYear();

    // Get first and last day of the month
    const startDate = new Date(targetYear, targetMonth, 1);
    const endDate = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59);

    // Get all tours for the month
    const tours = await LibraryTour.findByDateRange(startDate, endDate);

    // Create calendar data
    const calendar = [];
    const daysInMonth = endDate.getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const dayDate = new Date(targetYear, targetMonth, day);
      const dayTours = tours.filter(tour => {
        const tourDate = new Date(tour.tourDate);
        return tourDate.getDate() === day;
      });

      // Count available slots for the day
      const bookedSlots = dayTours.length;
      const maxSlotsPerDay = 9; // 8 AM - 5 PM, 1-hour slots
      const availableSlots = Math.max(0, maxSlotsPerDay - bookedSlots);

      calendar.push({
        date: dayDate,
        day: day,
        hasTours: dayTours.length > 0,
        availableSlots,
        bookedSlots,
        isFullyBooked: availableSlots === 0,
        tours: dayTours.map(tour => ({
          id: tour._id,
          groupName: tour.groupName,
          startTime: tour.startTime,
          numberOfParticipants: tour.numberOfParticipants,
          status: tour.status
        }))
      });
    }

    res.status(200).json({
      success: true,
      data: {
        month: targetMonth + 1,
        year: targetYear,
        calendar
      }
    });

  } catch (error) {
    console.error('Get tour calendar error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat mengambil kalender tur'
    });
  }
});

// @desc    Get single tour
// @route   GET /api/tours/:id
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const tour = await LibraryTour.findById(req.params.id);

    if (!tour) {
      return res.status(404).json({
        success: false,
        message: 'Tur tidak ditemukan'
      });
    }

    // Check if user owns this tour or is admin
    if (tour.userId._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Tidak memiliki akses ke tur ini'
      });
    }

    res.status(200).json({
      success: true,
      data: tour
    });

  } catch (error) {
    console.error('Get tour error:', error);

    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Tur tidak ditemukan'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error saat mengambil data tur'
    });
  }
});

// @desc    Update tour (only before approval and by owner)
// @route   PUT /api/tours/:id
// @access  Private
router.put('/:id', protect, uploadDocument, handleUploadError, generateFileUrl, async (req, res) => {
  try {
    const tour = await LibraryTour.findById(req.params.id);

    if (!tour) {
      return res.status(404).json({
        success: false,
        message: 'Tur tidak ditemukan'
      });
    }

    // Check ownership
    if (tour.userId._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Tidak memiliki akses untuk mengedit tur ini'
      });
    }

    // Check if tour can be updated
    if (tour.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Hanya tur dengan status pending yang dapat diedit'
      });
    }

    // Check if tour time has passed
    if (tour.startTime < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Tidak dapat mengedit tur yang sudah lewat waktunya'
      });
    }

    const {
      groupName,
      numberOfParticipants,
      tourDate,
      startTime,
      tourType,
      duration,
      contactPerson,
      specialRequests,
      ageGroup,
      language
    } = req.body;

    // Build update data
    const updateData = {};

    if (groupName) updateData.groupName = groupName.trim();
    if (numberOfParticipants) updateData.numberOfParticipants = parseInt(numberOfParticipants);
    if (tourType) updateData.tourType = tourType;
    if (duration) updateData.duration = parseInt(duration);
    if (specialRequests !== undefined) updateData.specialRequests = specialRequests ? specialRequests.trim() : undefined;
    if (ageGroup) updateData.ageGroup = ageGroup;
    if (language) updateData.language = language;
    if (req.body.assignedGuide !== undefined) updateData.assignedGuide = req.body.assignedGuide ? req.body.assignedGuide.trim() : undefined;

    // Handle contact person update
    if (contactPerson !== undefined) {
      try {
        updateData.contactPerson = typeof contactPerson === 'string' ? JSON.parse(contactPerson) : contactPerson;
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: 'Format data penanggung jawab tidak valid'
        });
      }
    }

    // Handle document update
    if (req.file) {
      // Delete old document
      if (tour.documentPath) {
        deleteFile(tour.documentPath).catch(err =>
          console.error('Error deleting old document:', err)
        );
      }
      updateData.documentPath = req.file.path;
    }

    // Handle date/time updates
    if (tourDate || startTime) {
      // Parse dates - ensure we handle timezone correctly
      const [year, month, day] = (tourDate || tour.tourDate.toISOString().split('T')[0]).split('-').map(Number);
      const [hours, minutes] = (startTime || tour.startTime.toISOString().split('T')[1].substring(0, 5)).split(':').map(Number);

      // Create date object in local timezone
      const newTourDateTime = new Date(year, month - 1, day, hours, minutes);
      const newTourDateOnly = new Date(year, month - 1, day); // Date-only for tourDate

      // Validate dates
      if (isNaN(newTourDateTime.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Format tanggal atau waktu tidak valid'
        });
      }

      if (newTourDateTime < new Date()) {
        return res.status(400).json({
          success: false,
          message: 'Tidak dapat mengatur waktu untuk masa lalu'
        });
      }

      // Check for conflicts (excluding current tour)
      const conflictingTour = await LibraryTour.checkConflict(
        newTourDateOnly,
        newTourDateTime,
        updateData.duration || tour.duration,
        tour._id
      );

      if (conflictingTour) {
        return res.status(400).json({
          success: false,
          message: 'Jadwal tur bentrok dengan tur lain',
          conflict: {
            groupName: conflictingTour.groupName,
            tourDate: conflictingTour.tourDate,
            startTime: conflictingTour.startTime
          }
        });
      }

      updateData.tourDate = newTourDateOnly;
      updateData.startTime = newTourDateTime;
    }

    const updatedTour = await LibraryTour.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true,
        runValidators: true
      }
    );

    res.status(200).json({
      success: true,
      message: 'Tur berhasil diupdate',
      data: updatedTour
    });

  } catch (error) {
    console.error('Update tour error:', error);
    
    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Tur tidak ditemukan'
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
      message: 'Server error saat mengupdate tur'
    });
  }
});

// @desc    Cancel tour
// @route   PATCH /api/tours/:id/cancel
// @access  Private
router.patch('/:id/cancel', protect, async (req, res) => {
  try {
    const tour = await LibraryTour.findById(req.params.id);

    if (!tour) {
      return res.status(404).json({
        success: false,
        message: 'Tur tidak ditemukan'
      });
    }

    // Check ownership
    if (tour.userId._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Tidak memiliki akses untuk membatalkan tur ini'
      });
    }

    // Check if tour can be cancelled
    if (tour.status === 'cancelled' || tour.status === 'rejected') {
      return res.status(400).json({
        success: false,
        message: 'Tur sudah dibatalkan atau ditolak'
      });
    }

    // Check if tour time has passed
    if (tour.startTime < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Tidak dapat membatalkan tur yang sudah dimulai'
      });
    }

    // Update status to cancelled
    await tour.updateStatus('cancelled', 'Dibatalkan oleh user', req.user._id);

    res.status(200).json({
      success: true,
      message: 'Tur berhasil dibatalkan',
      data: tour
    });

  } catch (error) {
    console.error('Cancel tour error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat membatalkan tur'
    });
  }
});


// Admin only routes below
// @desc    Get all tours (Admin only)
// @route   GET /api/tours
// @access  Private/Admin
router.get('/', protect, authorize('admin'), async (req, res) => {
  try {
    const {
      search,
      status,
      userId,
      startDate,
      endDate,
      tourType,
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

    if (userId) {
      matchConditions.userId = require('mongoose').Types.ObjectId(userId);
    }

    if (tourType) {
      matchConditions.tourType = tourType;
    }

    // Date range filter
    if (startDate || endDate) {
      matchConditions.tourDate = {};
      if (startDate) {
        matchConditions.tourDate.$gte = new Date(startDate);
      }
      if (endDate) {
        matchConditions.tourDate.$lte = new Date(endDate);
      }
    }

    // Add initial match if there are conditions
    if (Object.keys(matchConditions).length > 0) {
      pipeline.push({ $match: matchConditions });
    }

    // Lookup users
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
        $unwind: { path: '$userId', preserveNullAndEmptyArrays: true }
      }
    );

    // Search filter - applied after lookups
    if (search) {
      pipeline.push({
        $match: {
          $or: [
            { groupName: { $regex: search, $options: 'i' } },
            { 'userId.name': { $regex: search, $options: 'i' } },
            { 'userId.email': { $regex: search, $options: 'i' } },
            { 'contactPerson.name': { $regex: search, $options: 'i' } }
          ]
        }
      });
    }

    // Add projection to limit fields
    pipeline.push({
      $project: {
        groupName: 1,
        numberOfParticipants: 1,
        tourDate: 1,
        startTime: 1,
        tourType: 1,
        duration: 1,
        status: 1,
        contactPerson: 1,
        specialRequests: 1,
        ageGroup: 1,
        language: 1,
        assignedGuide: 1,
        documentPath: 1,
        createdAt: 1,
        updatedAt: 1,
        userId: {
          _id: 1,
          name: 1,
          email: 1,
          originInstitution: 1,
          phoneNumber: 1
        }
      }
    });

    // Get total count for pagination
    const countPipeline = [...pipeline, { $count: "total" }];
    const countResult = await LibraryTour.aggregate(countPipeline);
    const total = countResult.length > 0 ? countResult[0].total : 0;

    // Add sorting
    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'desc' ? -1 : 1;
    pipeline.push({ $sort: sortObj });

    // Add pagination
    pipeline.push({ $skip: skip }, { $limit: pageSize });

    // Execute aggregation
    const tours = await LibraryTour.aggregate(pipeline);

    console.log('Raw aggregation results count:', tours.length);
    if (tours.length > 0) {
      console.log('First tour documentPath:', tours[0].documentPath);
      console.log('First tour keys:', Object.keys(tours[0]));
    }

    // Add document URLs to tours
    const toursWithUrls = tours.map(tour => ({
      ...tour,
      documentUrl: tour.documentPath ? `${req.protocol}://${req.get('host')}/${tour.documentPath}` : null,
      // Ensure documentPath is preserved for download functionality
      documentPath: tour.documentPath || null
    }));

    console.log('Processed tours count:', toursWithUrls.length);
    const toursWithDocs = toursWithUrls.filter(t => t.documentUrl);
    console.log('Tours with documentUrl after processing:', toursWithDocs.length);
    if (toursWithDocs.length > 0) {
      console.log('Sample processed tour:', {
        id: toursWithDocs[0]._id,
        groupName: toursWithDocs[0].groupName,
        documentPath: toursWithDocs[0].documentPath,
        documentUrl: toursWithDocs[0].documentUrl
      });
    }

    res.status(200).json({
      success: true,
      count: toursWithUrls.length,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        pages: Math.ceil(total / pageSize)
      },
      data: toursWithUrls
    });

  } catch (error) {
    console.error('Get all tours error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat mengambil data tur'
    });
  }
});

// @desc    Update tour status (Admin only)
// @route   PATCH /api/tours/:id/status
// @access  Private/Admin
router.patch('/:id/status', protect, authorize('admin'), async (req, res) => {
  try {
    const { status, adminNote, assignedGuide } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status harus disediakan'
      });
    }

    if(!['approved', 'rejected','completed'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status harus berupa disetujui, ditolak atau selesai'
      });
    }

    const tour = await LibraryTour.findById(req.params.id);

    if (!tour) {
      return res.status(404).json({
        success: false,
        message: 'Tur tidak ditemukan'
      });
    }

    // Check if status update is valid based on current status
    if (status === 'completed' && tour.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Hanya tur dengan status disetujui yang dapat ditandai selesai'
      });
    } else if ((status === 'approved' || status === 'rejected') && tour.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Hanya tur dengan status pending yang dapat disetujui atau ditolak'
      });
    }

    // If approving, check for conflicts one more time
    if (status === 'approved') {
      const conflictingTour = await LibraryTour.checkConflict(
        tour.tourDate,
        tour.startTime,
        tour.duration,
        tour._id
      );

      if (conflictingTour) {
        return res.status(400).json({
          success: false,
          message: 'Tidak dapat menyetujui tur karena ada konflik jadwal',
          conflict: {
            groupName: conflictingTour.groupName,
            tourDate: conflictingTour.tourDate,
            startTime: conflictingTour.startTime
          }
        });
      }

      // Assign guide if provided
      if (assignedGuide) {
        tour.assignedGuide = assignedGuide.trim();
      }
    }

    // Update tour status
    await tour.updateStatus(status, adminNote || '', req.user._id);

    // Populate userId before sending email notification
    await tour.populate('userId', 'name email originInstitution');

    // Send notification email
    try {
      await sendTourNotification(tour, status);
    } catch (emailError) {
      console.error('Failed to send tour notification:', emailError);
      // Don't fail the request if email fails
    }

    res.status(200).json({
      success: true,
      message: `Tur berhasil ${status === 'approved' ? 'disetujui' : status === 'rejected' ? 'ditolak' : 'ditandai selesai'}`,
      data: tour
    });

  } catch (error) {
    console.error('Update tour status error:', error);
    
    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Tur tidak ditemukan'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error saat mengupdate status tur'
    });
  }
});

// @desc    Get tour statistics (Admin only)
// @route   GET /api/tours/stats
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

    // Get tour statistics (all-time for summary)
    const totalTours = await LibraryTour.countDocuments();

    const pendingTours = await LibraryTour.countDocuments({
      status: 'pending'
    });

    const approvedTours = await LibraryTour.countDocuments({
      status: 'approved'
    });

    const rejectedTours = await LibraryTour.countDocuments({
      status: 'rejected'
    });

    const cancelledTours = await LibraryTour.countDocuments({
      status: 'cancelled'
    });

    const completedTours = await LibraryTour.countDocuments({
      status: 'completed'
    });

    // Get total participants
    const participantStats = await LibraryTour.aggregate([
      {
        $match: {
          status: { $in: ['approved', 'completed'] },
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalParticipants: { $sum: '$numberOfParticipants' },
          avgParticipants: { $avg: '$numberOfParticipants' }
        }
      }
    ]);

    // Get most popular tour types
    const tourTypeStats = await LibraryTour.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$tourType',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    // Get tour trends by day
    const tourTrends = await LibraryTour.aggregate([
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
          count: { $sum: 1 },
          participants: { $sum: '$numberOfParticipants' }
        }
      },
      {
        $sort: { '_id': 1 }
      }
    ]);

    const totalParticipants = participantStats.length > 0 ? participantStats[0].totalParticipants : 0;
    const avgParticipants = participantStats.length > 0 ? Math.round(participantStats[0].avgParticipants) : 0;

    res.status(200).json({
      success: true,
      data: {
        period,
        dateRange: {
          startDate,
          endDate
        },
        summary: {
          total: totalTours,
          pending: pendingTours,
          approved: approvedTours,
          rejected: rejectedTours,
          cancelled: cancelledTours,
          completed: completedTours,
          approvalRate: totalTours > 0 ? ((approvedTours / totalTours) * 100).toFixed(1) : 0,
          totalParticipants,
          avgParticipants
        },
        tourTypeStats,
        tourTrends
      }
    });

  } catch (error) {
    console.error('Get tour stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat mengambil statistik tur'
    });
  }
});

// @desc    Get upcoming tours (Admin only)
// @route   GET /api/tours/upcoming
// @access  Private/Admin
router.get('/admin/upcoming', protect, authorize('admin'), async (req, res) => {
  try {
    const { days = 7 } = req.query;

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + parseInt(days));

    const upcomingTours = await LibraryTour.find({
      status: 'approved',
      tourDate: {
        $gte: startDate,
        $lte: endDate
      }
    })
    .populate('userId', 'name email originInstitution phoneNumber')
    .sort({ tourDate: 1, startTime: 1 });

    res.status(200).json({
      success: true,
      count: upcomingTours.length,
      data: upcomingTours
    });

  } catch (error) {
    console.error('Get upcoming tours error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat mengambil tur mendatang'
    });
  }
});

// @desc    Delete tour (only cancelled or rejected by owner)
// @route   DELETE /api/tours/:id
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const tour = await LibraryTour.findById(req.params.id);

    if (!tour) {
      return res.status(404).json({
        success: false,
        message: 'Tur tidak ditemukan'
      });
    }

    // Check ownership
    if (tour.userId._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Tidak memiliki akses untuk menghapus tur ini'
      });
    }

    // Check if tour can be deleted (only cancelled, rejected, or completed)
    if (!['cancelled', 'rejected', 'completed'].includes(tour.status)) {
      return res.status(400).json({
        success: false,
        message: 'Hanya tur yang dibatalkan, ditolak, atau sudah selesai yang dapat dihapus'
      });
    }

    // Delete associated document file if exists
    if (tour.documentPath) {
      deleteFile(tour.documentPath).catch(err =>
        console.error('Error deleting document file:', err)
      );
    }

    // Delete the tour
    await LibraryTour.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Tur berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete tour error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat menghapus tur'
    });
  }
});

// @desc Delete Tour
// (Admin Only - can delete any tour)
// @route DELETE
// /api/tours/admin/:id
// @access Private/Admin
router.delete('/admin/:id',protect, authorize('admin'),async (req, res) => {
  try{
    const tour = await LibraryTour.findById(req.params.id);
    if (!tour) {
      return res.status(404).json({
        success: false,
        message: 'Tur tidak ditemukan'
      });
    }

    // Delete the tour
    await LibraryTour.findByIdAndDelete(req.params.id);
      res.status(200).json({
        success: true,
        message: "Tur berhsil dihapus oleh admin"
      });
  } catch(error) {
    console.error('Admin delete tour error :', error);
    res.status(500).json({
      success: false,
      message: "Server error saat menghapus tur"
    });
  }
});

module.exports = router;