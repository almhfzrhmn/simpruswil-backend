// routes/admin.js - Admin dashboard and management routes
const express = require('express');
const User = require('../models/User');
const Room = require('../models/Room');
const Booking = require('../models/Booking');
const LibraryTour = require('../models/LibraryTour');
const { protect, authorize } = require('../middleware/auth');
const { sendBookingNotification, sendTourNotification } = require('../utils/email');

const router = express.Router();

// All routes in this file require admin authorization
router.use(protect, authorize('admin'));

// @desc    Get admin dashboard data
// @route   GET /api/admin/dashboard 
// @access  Private/Admin
router.get('/dashboard', async (req, res) => {
  try {
    // Get current date for filtering
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    // sevenDaysFromNow will be set after today is calculated

    // Get summary statistics
    const stats = {
      users: {
        total: await User.countDocuments(),
        verified: await User.countDocuments({ isVerified: true }),
        newThisMonth: await User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } })
      },
      rooms: {
        total: await Room.countDocuments(),
        active: await Room.countDocuments({ isActive: true }),
        inactive: await Room.countDocuments({ isActive: false })
      },
      bookings: {
        total: await Booking.countDocuments(),
        pending: await Booking.countDocuments({ status: 'pending' }),
        approved: await Booking.countDocuments({ status: 'approved' }),
        rejected: await Booking.countDocuments({ status: 'rejected' }),
        completed: await Booking.countDocuments({ status: 'completed' }),
        thisMonth: await Booking.countDocuments({ createdAt: { $gte: thirtyDaysAgo } })
      },
      tours: {
        total: await LibraryTour.countDocuments(),
        pending: await LibraryTour.countDocuments({ status: 'pending' }),
        approved: await LibraryTour.countDocuments({ status: 'approved' }),
        rejected: await LibraryTour.countDocuments({ status: 'rejected' }),
        completed: await LibraryTour.countDocuments({ status: 'completed' }),
        thisMonth: await LibraryTour.countDocuments({ createdAt: { $gte: thirtyDaysAgo } })
      }
    };

    // Get pending requests that need attention
    const pendingBookings = await Booking.find({ 
      status: 'pending' 
    })
    .populate('userId', 'name email originInstitution')
    .populate('roomId', 'roomName capacity')
    .sort({ createdAt: -1 })
    .limit(10);

    const pendingTours = await LibraryTour.find({ 
      status: 'pending' 
    })
    .populate('userId', 'name email originInstitution')
    .sort({ createdAt: -1 })
    .limit(10);

    // Get today's activities
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

    // Date strings for tour queries - adjust for Jakarta timezone
    const jakartaNow = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    const todayDateStr = jakartaNow.toISOString().split('T')[0];
    const tomorrowDateStr = new Date(jakartaNow.getTime() + (24 * 60 * 60 * 1000)).toISOString().split('T')[0];
    const dayAfterTomorrowDateStr = new Date(jakartaNow.getTime() + (48 * 60 * 60 * 1000)).toISOString().split('T')[0];

    // Update sevenDaysFromNow
    const sevenDaysFromNow = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));

    const todayBookings = await Booking.find({
      status: 'approved',
      startTime: {
        $gte: today,
        $lt: tomorrow
      }
    })
    .populate('userId', 'name email originInstitution')
    .populate('roomId', 'roomName capacity')
    .sort({ startTime: 1 });

    const todayTours = await LibraryTour.find({
      status: 'approved',
      $expr: {
        $and: [
          { $gte: [{ $dateToString: { format: '%Y-%m-%d', date: '$tourDate' } }, todayDateStr] },
          { $lt: [{ $dateToString: { format: '%Y-%m-%d', date: '$tourDate' } }, tomorrowDateStr] }
        ]
      }
    })
    .populate('userId', 'name email originInstitution')
    .sort({ tourDate: 1, startTime: 1 });

    // Get tomorrow's activities
    const tomorrowBookings = await Booking.find({
      status: 'approved',
      startTime: {
        $gte: tomorrow,
        $lt: dayAfterTomorrow
      }
    })
    .populate('userId', 'name email originInstitution')
    .populate('roomId', 'roomName capacity')
    .sort({ startTime: 1 });

    const tomorrowTours = await LibraryTour.find({
      status: 'approved',
      $expr: {
        $and: [
          { $gte: [{ $dateToString: { format: '%Y-%m-%d', date: '$tourDate' } }, tomorrowDateStr] },
          { $lt: [{ $dateToString: { format: '%Y-%m-%d', date: '$tourDate' } }, dayAfterTomorrowDateStr] }
        ]
      }
    })
    .populate('userId', 'name email originInstitution')
    .sort({ tourDate: 1, startTime: 1 });

    // Get upcoming approved activities (next 7 days, excluding today and tomorrow)
    const upcomingBookings = await Booking.find({
      status: 'approved',
      startTime: {
        $gte: dayAfterTomorrow,
        $lte: sevenDaysFromNow
      }
    })
    .populate('userId', 'name email originInstitution')
    .populate('roomId', 'roomName')
    .sort({ startTime: 1 })
    .limit(10);

    const upcomingTours = await LibraryTour.find({
      status: 'approved',
      $expr: {
        $and: [
          { $gte: [{ $dateToString: { format: '%Y-%m-%d', date: '$tourDate' } }, dayAfterTomorrowDateStr] },
          { $lte: [{ $dateToString: { format: '%Y-%m-%d', date: '$tourDate' } }, sevenDaysFromNow.toISOString().split('T')[0]] }
        ]
      }
    })
    .populate('userId', 'name email originInstitution')
    .sort({ tourDate: 1, startTime: 1 })
    .limit(10);

    // Get recent activity (last 7 days)
    const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    
    const recentBookings = await Booking.find({
      createdAt: { $gte: sevenDaysAgo }
    })
    .populate('userId', 'name originInstitution')
    .populate('roomId', 'roomName')
    .sort({ createdAt: -1 })
    .limit(5);

    const recentTours = await LibraryTour.find({
      createdAt: { $gte: sevenDaysAgo }
    })
    .populate('userId', 'name originInstitution')
    .sort({ createdAt: -1 })
    .limit(5);

    // Add document URLs to pending bookings
    const pendingBookingsWithUrls = pendingBookings.map(booking => ({
      ...booking.toObject(),
      documentUrl: `${req.protocol}://${req.get('host')}/${booking.documentPath}`
    }));

    res.status(200).json({
      success: true,
      data: {
        stats,
        pendingRequests: {
          bookings: pendingBookingsWithUrls,
          tours: pendingTours
        },
        todayActivities: {
          bookings: todayBookings,
          tours: todayTours
        },
        tomorrowActivities: {
          bookings: tomorrowBookings,
          tours: tomorrowTours
        },
        upcomingActivities: {
          bookings: upcomingBookings,
          tours: upcomingTours
        },
        recentActivity: {
          bookings: recentBookings,
          tours: recentTours
        }
      }
    });

  } catch (error) {
    console.error('Get admin dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat mengambil data dashboard'
    });
  }
});

// @desc    Get system statistics
// @route   GET /api/admin/stats
// @access  Private/Admin
router.get('/stats', async (req, res) => {
  try {
    const { period = 'month' } = req.query;

    // Calculate date range based on period
    let startDate, endDate, groupFormat;
    const now = new Date();

    switch (period) {
      case 'week':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
        groupFormat = '%Y-%m-%d';
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        groupFormat = '%Y-%m-%d';
        break;
      case 'year':
        startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        groupFormat = '%Y-%m';
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        groupFormat = '%Y-%m-%d';
    }

    endDate = now;

    // User registration trends
    const userTrends = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: groupFormat, date: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id': 1 }
      }
    ]);

    // Booking trends - using startTime for actual room usage analytics
    const bookingTrends = await Booking.aggregate([
      {
        $match: {
          startTime: { $gte: startDate, $lte: endDate },
          status: { $in: ['approved', 'completed'] } // Only count actual usage
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: groupFormat, date: '$startTime' } },
            status: '$status'
          },
          count: { $sum: 1 },
          participants: { $sum: '$participantsCount' }
        }
      },
      {
        $group: {
          _id: '$_id.date',
          total: { $sum: '$count' },
          totalParticipants: { $sum: '$participants' },
          statuses: {
            $push: {
              status: '$_id.status',
              count: '$count',
              participants: '$participants'
            }
          }
        }
      },
      {
        $sort: { '_id': 1 }
      }
    ]);

    // Tour trends
    const tourTrends = await LibraryTour.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: groupFormat, date: '$createdAt' } },
            status: '$status'
          },
          count: { $sum: 1 },
          participants: { $sum: '$numberOfParticipants' }
        }
      },
      {
        $group: {
          _id: '$_id.date',
          total: { $sum: '$count' },
          totalParticipants: { $sum: '$participants' },
          statuses: {
            $push: {
              status: '$_id.status',
              count: '$count'
            }
          }
        }
      },
      {
        $sort: { '_id': 1 }
      }
    ]);

    // Most popular rooms - calculate utilization based on approval rate
    const popularRooms = await Booking.aggregate([
      {
        $match: {
          startTime: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$roomId',
          totalBookings: { $sum: 1 },
          approvedBookings: {
            $sum: {
              $cond: [
                { $in: ['$status', ['approved', 'completed']] },
                1,
                0
              ]
            }
          }
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
          capacity: '$room.capacity',
          bookingCount: '$approvedBookings', // Show only approved bookings count
          approvedCount: '$approvedBookings',
          utilizationRate: {
            $cond: {
              if: { $gt: ['$totalBookings', 0] },
              then: {
                $multiply: [
                  { $divide: ['$approvedBookings', '$totalBookings'] },
                  100
                ]
              },
              else: 0
            }
          }
        }
      },
      {
        $sort: { bookingCount: -1 }
      },
      {
        $limit: 10
      }
    ]);

    // Institution statistics
    const institutionStats = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$originInstitution',
          userCount: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'bookings',
          let: { institution: '$_id' },
          pipeline: [
            {
              $lookup: {
                from: 'users',
                localField: 'userId',
                foreignField: '_id',
                as: 'user'
              }
            },
            {
              $unwind: '$user'
            },
            {
              $match: {
                $expr: { $eq: ['$user.originInstitution', '$$institution'] },
                startTime: { $gte: startDate, $lte: endDate },
                status: { $in: ['approved', 'completed'] }
              }
            }
          ],
          as: 'bookings'
        }
      },
      {
        $lookup: {
          from: 'librarytours',
          let: { institution: '$_id' },
          pipeline: [
            {
              $lookup: {
                from: 'users',
                localField: 'userId',
                foreignField: '_id',
                as: 'user'
              }
            },
            {
              $unwind: '$user'
            },
            {
              $match: {
                $expr: { $eq: ['$user.originInstitution', '$$institution'] },
                createdAt: { $gte: startDate, $lte: endDate }
              }
            }
          ],
          as: 'tours'
        }
      },
      {
        $project: {
          institution: '$_id',
          userCount: 1,
          bookingCount: { $size: '$bookings' },
          tourCount: { $size: '$tours' },
          totalActivity: {
            $add: [{ $size: '$bookings' }, { $size: '$tours' }]
          }
        }
      },
      {
        $sort: { totalActivity: -1 }
      },
      {
        $limit: 10
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
        trends: {
          users: userTrends,
          bookings: bookingTrends,
          tours: tourTrends
        },
        popularRooms,
        institutionStats
      }
    });

  } catch (error) {
    console.error('Get admin stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat mengambil statistik admin'
    });
  }
});

// @desc    Get all users
// @route   GET /api/admin/users
// @access  Private/Admin
router.get('/users', async (req, res) => {
  try {
    const {
      search,
      role,
      isVerified,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { originInstitution: { $regex: search, $options: 'i' } }
      ];
    }

    if (role) {
      query.role = role;
    }

    if (isVerified !== undefined) {
      query.isVerified = isVerified === 'true';
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Pagination
    const pageNumber = parseInt(page);
    const pageSize = parseInt(limit);
    const skip = (pageNumber - 1) * pageSize;

    // Execute query
    const users = await User.find(query)
      .select('-password')
      .sort(sort)
      .skip(skip)
      .limit(pageSize);

    // Get total count
    const total = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      count: users.length,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        pages: Math.ceil(total / pageSize)
      },
      data: users
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat mengambil data pengguna'
    });
  }
});

// @desc    Get single user
// @route   GET /api/admin/users/:id
// @access  Private/Admin
router.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Pengguna tidak ditemukan'
      });
    }

    res.status(200).json({
      success: true,
      data: user
    });

  } catch (error) {
    console.error('Get user error:', error);

    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Pengguna tidak ditemukan'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error saat mengambil data pengguna'
    });
  }
});

// @desc    Update user status
// @route   PATCH /api/admin/users/:id/status
// @access  Private/Admin
router.patch('/users/:id/status', async (req, res) => {
  try {
    const { isVerified, role, isActive } = req.body;

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Pengguna tidak ditemukan'
      });
    }

    // Update fields individually to avoid validation issues
    const updateData = {};
    if (isVerified !== undefined) {
      updateData.isVerified = isVerified;
    }
    if (role !== undefined) {
      updateData.role = role;
    }
    if (isActive !== undefined) {
      updateData.isActive = isActive;
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true,
        runValidators: false // Skip validation for status updates
      }
    );

    res.status(200).json({
      success: true,
      message: 'Status pengguna berhasil diupdate',
      data: updatedUser
    });

  } catch (error) {
    console.error('Update user status error:', error);

    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Pengguna tidak ditemukan'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error saat mengupdate status pengguna'
    });
  }
});

// @desc    Delete user
// @route   DELETE /api/admin/users/:id
// @access  Private/Admin
router.delete('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Pengguna tidak ditemukan'
      });
    }

    // Prevent deleting admin users
    if (user.role === 'admin') {
      return res.status(400).json({
        success: false,
        message: 'Tidak dapat menghapus pengguna admin'
      });
    }

    await User.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Pengguna berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete user error:', error);

    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Pengguna tidak ditemukan'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error saat menghapus pengguna'
    });
  }
});
module.exports = router;